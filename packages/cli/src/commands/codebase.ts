/**
 * `prdfy codebase sync` — sync a filtered repository snapshot to PrdFy.
 *
 * Pipeline (all local filtering first, then chunked upload):
 * scan → manifest → blocked-content refusal → handshake → manifest batches
 * → base64 text chunks (binaries excluded, never uploaded) → completion.
 *
 * Status lines echo real server-persisted statuses; no percentages are
 * invented. The sync token travels in memory only and is never written to
 * the global config. This module never calls `process.exit` — the Commander
 * action wrapper in `index.ts` owns the exit code.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiError, DEFAULT_REQUEST_TIMEOUT_MS } from "../lib/api-client.js";
import { resolveApiUrl } from "../lib/config.js";
import { ensurePrdfyIgnore, readPrdfyIgnore } from "../lib/ignore.js";
import {
	buildManifest,
	ManifestTooLargeError,
	type RepositoryManifest,
} from "../lib/manifest.js";
import { resolveRepositoryRoot, scanRepository } from "../lib/repository.js";
import {
	CODEBASE_CLI_MIN_VERSION,
	CODEBASE_CLI_VERSION,
	compareCliVersions,
	createSyncClient,
	type FileChunkUploadResponse,
	planFileChunks,
	type SyncClient,
	type SyncManifestEntry,
} from "../lib/sync-client.js";

export type SyncOutputMode = "human" | "json";

export interface SyncCodebaseOptions {
	projectId: string;
	syncToken: string;
	root?: string;
	output?: SyncOutputMode;
	apiUrl?: string;
}

export interface SyncResult {
	ok: boolean;
	projectId: string;
	sessionId: string | null;
	/** Last persisted server status (or a local failure marker). */
	status: string;
	/** Eligible manifest entries (snapshot content). */
	fileCount: number;
	/** All exclusions (scan + manifest stage). */
	excludedCount: number;
	uploadedFiles: number;
	uploadedBytes: number;
	/** Resolved repository root; human output only, never in JSON payloads. */
	root?: string;
	/** True when this run created `.prdfyignore` from the default template. */
	ignoreCreated?: boolean;
	/** `.prdfyignore` negation lines ignored because built-ins cannot be lifted. */
	droppedNegations?: string[];
	/** Set when the server requires a newer CLI than this one. */
	cliUpdate?: { current: string; minimum: string };
	snapshotId?: string;
	errorCode?: string;
	errorMessage?: string;
}

/**
 * Thrown when the manifest contains secret-matched content. The sync refuses
 * to continue: redacting or excluding the file (via `.prdfyignore`) and
 * re-running is required. Paths are safe metadata; matched values never
 * surface.
 */
export class SyncBlockedError extends Error {
	readonly code = "BLOCKED_CONTENT" as const;
	readonly blockedPaths: string[];

	constructor(blockedPaths: string[]) {
		super(
			`Sync blocked: ${blockedPaths.length} file(s) match secret-content protection (${blockedPaths.join(", ")}). Redact or exclude them, then retry.`,
		);
		this.name = "SyncBlockedError";
		this.blockedPaths = blockedPaths;
	}
}

/** Pure helper: list secret-blocked manifest paths (no IO, no exit). */
export function findBlockedPaths(manifest: RepositoryManifest): string[] {
	return manifest.entries
		.filter((entry) => entry.exclusionReason?.startsWith("secret:"))
		.map((entry) => entry.path);
}

export function assertNoBlockedContent(manifest: RepositoryManifest): void {
	const blocked = findBlockedPaths(manifest);
	if (blocked.length > 0) throw new SyncBlockedError(blocked);
}

function toSyncManifestEntry(entry: {
	path: string;
	size: number;
	hash: string;
	language?: string;
}): SyncManifestEntry {
	return {
		path: entry.path,
		size: entry.size,
		hash: entry.hash,
		...(entry.language ? { language: entry.language } : {}),
	};
}

function failure(
	projectId: string,
	status: string,
	errorCode: string,
	errorMessage: string,
	counts?: { fileCount: number; excludedCount: number },
): SyncResult {
	return {
		ok: false,
		projectId,
		sessionId: null,
		status,
		fileCount: counts?.fileCount ?? 0,
		excludedCount: counts?.excludedCount ?? 0,
		uploadedFiles: 0,
		uploadedBytes: 0,
		errorCode,
		errorMessage,
	};
}

function printResult(result: SyncResult, output: SyncOutputMode): void {
	if (output === "json") {
		// Local filesystem paths stay out of the JSON contract; `manifest.ts`
		// keeps every payload path repository-relative and JSON output must
		// not reintroduce an absolute path.
		const { root: _root, ...machineReadable } = result;
		console.log(JSON.stringify(machineReadable, null, 2));
		return;
	}
	const lines: string[] = [];
	if (result.root) lines.push(`Repository   : ${result.root}`);
	if (result.ignoreCreated !== undefined) {
		lines.push(
			`Ignore file  : ${
				result.ignoreCreated
					? ".prdfyignore dibuat dari template PrdFy (lokal, jangan di-commit)"
					: ".prdfyignore sudah ada (tidak diubah)"
			}`,
		);
	}
	for (const negation of result.droppedNegations ?? []) {
		lines.push(
			`Peringatan   : pola negasi "${negation}" diabaikan; aturan bawaan tidak bisa dibatalkan`,
		);
	}
	if (result.cliUpdate) {
		lines.push(
			`Update CLI   : versi ${result.cliUpdate.current} di bawah minimum ${result.cliUpdate.minimum}. Jalankan: npm i -g @ghazynabiel/prdfy`,
		);
	}
	if (result.ok) {
		lines.push(
			`Sync ${result.status}: ${result.uploadedFiles} file(s), ${result.uploadedBytes} byte(s)`,
			`Session      : ${result.sessionId} · project ${result.projectId}`,
			`Manifest     : ${result.fileCount} included, ${result.excludedCount} excluded`,
		);
		if (result.snapshotId) lines.push(`Snapshot     : ${result.snapshotId}`);
		console.log(lines.join("\n"));
		return;
	}
	lines.push(
		`Sync ${result.status} [${result.errorCode}]: ${result.errorMessage}`,
	);
	console.log(lines.join("\n"));
}

export async function syncCodebase(
	options: SyncCodebaseOptions,
	deps: { createClient?: (token: string, apiUrl: string) => SyncClient } = {},
): Promise<SyncResult> {
	const output: SyncOutputMode = options.output ?? "human";
	const syncToken = options.syncToken || process.env.PRDFY_SYNC_TOKEN;
	if (
		!options.projectId ||
		!syncToken ||
		(output !== "human" && output !== "json")
	) {
		const res = failure(
			options.projectId || "",
			"failed",
			"INVALID_OPTIONS",
			"projectId, syncToken, and output (human|json) are required",
		);
		printResult(res, output === "json" ? "json" : "human");
		return res;
	}

	const { projectId } = options;

	// Preparation is the CLI's job, not the agent prompt's: resolve the real
	// repository root, then bootstrap the local ignore file so the user never
	// has to create it by hand.
	let root: string;
	try {
		root = await resolveRepositoryRoot(process.cwd(), options.root);
	} catch (err) {
		const res = failure(
			projectId,
			"failed",
			"ROOT_RESOLUTION_FAILED",
			err instanceof Error ? err.message : String(err),
		);
		printResult({ ...res, root: options.root }, output);
		return res;
	}

	let ignoreCreated: boolean;
	let rules: Awaited<ReturnType<typeof readPrdfyIgnore>>;
	let manifest: RepositoryManifest;
	try {
		({ created: ignoreCreated } = await ensurePrdfyIgnore(root));
		rules = await readPrdfyIgnore(root);
		const scan = await scanRepository(root, rules);
		manifest = await buildManifest(scan);
	} catch (err) {
		const res =
			err instanceof ManifestTooLargeError
				? failure(projectId, "failed", err.code, err.message)
				: failure(
						projectId,
						"failed",
						"SCAN_FAILED",
						err instanceof Error ? err.message : String(err),
					);
		printResult({ ...res, root }, output);
		return res;
	}

	// Non-fatal preparation context, present on every subsequent exit path.
	// The root is carried in the result (never in JSON output) so warnings
	// survive both the failure and success printers below.
	const preparation = {
		root,
		ignoreCreated,
		droppedNegations: rules.droppedNegations,
	};

	try {
		assertNoBlockedContent(manifest);
	} catch (err) {
		const blocked = err as SyncBlockedError;
		const res: SyncResult = {
			...failure(projectId, "failed", blocked.code, blocked.message, {
				fileCount: manifest.fileCount,
				excludedCount: manifest.excludedCount,
			}),
			...preparation,
		};
		printResult(res, output);
		return res;
	}

	const createClient =
		deps.createClient ??
		((token: string, apiUrl: string) =>
			createSyncClient({
				apiUrl,
				syncToken: token,
				timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
			}));

	try {
		const client = createClient(syncToken, options.apiUrl ?? resolveApiUrl());
		const handshake = await client.handshakeWithRetry(projectId);
		// Update notice comes from the server's advertised minimum only: no
		// registry lookup, no invented urgency. The handshake already fails
		// closed for an unsupported version, so this is purely informational
		// and rides along with whatever result the run produces.
		const minimum = handshake.cliMinVersion ?? CODEBASE_CLI_MIN_VERSION;
		const cliUpdate =
			compareCliVersions(CODEBASE_CLI_VERSION, minimum) < 0
				? { current: CODEBASE_CLI_VERSION, minimum }
				: undefined;
		if (output === "human") {
			console.log(`Session ${handshake.sessionId}: ${handshake.status}`);
		}

		// The server's manifest is the upload contract: every stored entry must
		// have matching chunks at completion. Keep ineligible metadata local in
		// `manifest.excluded`; sending it as a manifest entry would make a valid
		// text-only snapshot impossible to complete.
		const eligible = manifest.entries.filter((entry) => entry.contentEligible);
		const manifestStatus = await client.uploadManifestWithRetry(
			projectId,
			{ sessionId: handshake.sessionId, attemptId: handshake.attemptId },
			eligible.map(toSyncManifestEntry),
		);
		if (output === "human") {
			console.log(
				`Manifest: ${manifest.fileCount} file(s) (${manifestStatus.status})`,
			);
		}

		let contentStatus: FileChunkUploadResponse = { status: "uploading" };
		let chunkOffset = 0;
		if (eligible.length === 0) {
			contentStatus = await client.uploadFileChunksWithRetry(
				projectId,
				{ sessionId: handshake.sessionId, attemptId: handshake.attemptId },
				[],
				0,
			);
		} else {
			for (const entry of eligible) {
				const bytes = await readFile(join(root, ...entry.path.split("/")));
				const chunks = planFileChunks([
					{
						path: entry.path,
						base64: bytes.toString("base64"),
						hash: entry.hash,
					},
				]);
				if (chunks.length > 0) {
					contentStatus = await client.uploadFileChunksWithRetry(
						projectId,
						{ sessionId: handshake.sessionId, attemptId: handshake.attemptId },
						chunks,
						chunkOffset,
					);
					chunkOffset += chunks.length;
				}
			}
		}
		const uploadedBytes = eligible.reduce(
			(total, entry) => total + entry.size,
			0,
		);
		if (output === "human") {
			console.log(
				`Content: ${eligible.length} file(s), ${uploadedBytes} byte(s) (${contentStatus.status})`,
			);
		}

		const completion = await client.completeWithRetry(projectId, {
			sessionId: handshake.sessionId,
			attemptId: handshake.attemptId,
			fileCount: manifest.fileCount,
			excludedCount: manifest.excludedCount,
		});
		const ok = completion.status === "uploaded";
		const res: SyncResult = {
			ok,
			projectId,
			sessionId: handshake.sessionId,
			status: completion.status,
			fileCount: completion.fileCount ?? manifest.fileCount,
			excludedCount: completion.excludedCount ?? manifest.excludedCount,
			uploadedFiles: ok ? eligible.length : 0,
			uploadedBytes: ok ? uploadedBytes : 0,
			...preparation,
			...(cliUpdate ? { cliUpdate } : {}),
			...(completion.snapshotId ? { snapshotId: completion.snapshotId } : {}),
			...(!ok
				? {
						errorCode: completion.errorCode ?? "SYNC_INCOMPLETE",
						errorMessage:
							completion.errorMessage ??
							`Sync did not complete (status: ${completion.status})`,
					}
				: {}),
		};
		printResult(res, output);
		return res;
	} catch (err) {
		const res =
			err instanceof ApiError
				? {
						...failure(
							projectId,
							"failed",
							err.code ?? `HTTP_${err.status ?? "UNKNOWN"}`,
							err.message,
							{
								fileCount: manifest.fileCount,
								excludedCount: manifest.excludedCount,
							},
						),
						...preparation,
					}
				: {
						...failure(
							projectId,
							"failed",
							"SYNC_FAILED",
							err instanceof Error ? err.message : String(err),
							{
								fileCount: manifest.fileCount,
								excludedCount: manifest.excludedCount,
							},
						),
						...preparation,
					};
		printResult(res, output);
		return res;
	}
}

/**
 * Commander action for `prdfy codebase sync`. Commander v12 camelCases
 * dashed flags (`--project-id` → `opts.projectId`), so this reads camelCase
 * fields — matching the `login.ts` precedent (`options.apiKey`). Owns the
 * nonzero exit on incomplete sync; `syncCodebase` itself never exits.
 */
export async function codebaseSyncAction(opts: {
	projectId?: string;
	syncToken?: string;
	root?: string;
	output?: string;
	apiUrl?: string;
}): Promise<void> {
	const result = await syncCodebase({
		projectId: opts.projectId ?? "",
		syncToken: opts.syncToken ?? "",
		root: opts.root,
		output: opts.output as "human" | "json",
		apiUrl: opts.apiUrl,
	});
	if (!result.ok) process.exit(1);
}
