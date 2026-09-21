/**
 * Codebase sync transport for `prdfy codebase sync`.
 *
 * Talks to the CLI-facing sync boundary (`/api/v1/projects/:id/codebase/*`,
 * implemented server-side in Tasks 4-5; tests use mocked responses):
 *
 * - `POST .../sync` — session handshake, returns the bound session/attempt.
 * - `POST .../manifest` — bounded manifest batches.
 * - `POST .../files` — bounded base64 text file chunks (binaries excluded,
 *   never uploaded).
 * - `POST .../complete` — idempotent atomic snapshot completion.
 *
 * Every retry reuses the same session/attempt/chunk identity and the same
 * idempotency key, so a retry never creates duplicate records. The sync
 * token travels in memory only and is never written to global config.
 * Transport bounds mirror `src/lib/constants.ts` (duplicated so this
 * standalone package never imports from the web app).
 */

import { ApiError, apiRequest } from "./api-client.js";
import { CLI_VERSION } from "./version.js";

/** Maximum serialized JSON per upload request (locked MVP bound). */
export const CODEBASE_MAX_CHUNK_BYTES = 256 * 1024;
/** Minimum CLI version the server accepts for sync. */
export const CODEBASE_CLI_MIN_VERSION = "2.0.0";
/** This CLI's version (single-sourced from `packages/cli/package.json`). */
export const CODEBASE_CLI_VERSION = CLI_VERSION;
/** Bounded retry budget for retryable transport failures. */
export const SYNC_MAX_ATTEMPTS = 3;
/** Reserved bytes for the request envelope (ids/keys) on top of payloads. */
export const SYNC_ENVELOPE_RESERVE_BYTES = 1024;

export interface SyncClientOptions {
	apiUrl: string;
	syncToken: string;
	timeoutMs: number;
}

export interface SyncSession {
	sessionId: string;
	attemptId: string;
}

export interface HandshakeResponse extends SyncSession {
	status: string;
	/** Snapshot bound by the server handshake (Task 4+); ignored when absent. */
	snapshotId?: string;
	cliMinVersion?: string;
	expiresAt?: string;
}

/** Manifest entry as sent to the server (subset of the Task 1 DTO). */
export interface SyncManifestEntry {
	path: string;
	size: number;
	hash: string;
	language?: string;
}

export interface ManifestUploadResponse {
	status: string;
}

export interface FileChunkInput {
	path: string;
	/** Base64-encoded UTF-8 text content (binaries are never uploaded). */
	base64: string;
	/** SHA-256 hex of the raw file bytes. */
	hash: string;
}

export interface FileChunkPayload {
	path: string;
	chunkIndex: number;
	chunkTotal: number;
	encoding: "base64";
	data: string;
	contentHash: string;
}

export interface FileChunkUploadResponse {
	status: string;
}

export interface CompletionInput extends SyncSession {
	fileCount: number;
	excludedCount: number;
}

export interface CompletionResponse {
	status: string;
	fileCount?: number;
	excludedCount?: number;
	snapshotId?: string;
	errorCode?: string;
	errorMessage?: string;
}

export interface RetryOptions {
	maxAttempts?: number;
}

/**
 * Deterministic idempotency key for a sync request. Derived from the
 * server-issued attempt identity plus the request kind/index, so retries of
 * the same logical request carry the same key. Contains no credentials.
 */
export function makeIdempotencyKey(
	attemptId: string,
	kind: "manifest" | "file" | "complete",
	index: number,
): string {
	return `${attemptId}:${kind}:${index}`;
}

/** Retry `operation` on retryable `ApiError`s, up to the attempt budget. */
export async function withSyncRetry<T>(
	operation: () => Promise<T>,
	options: RetryOptions = {},
): Promise<T> {
	const maxAttempts = options.maxAttempts ?? SYNC_MAX_ATTEMPTS;
	if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
		throw new Error("maxAttempts must be a positive integer");
	}
	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			return await operation();
		} catch (err) {
			lastError = err;
			if (!(err instanceof ApiError) || !err.retryable) throw err;
			if (attempt === maxAttempts) throw err;
		}
	}
	throw lastError;
}

/**
 * Split base64 text contents into chunks whose `data` payload stays within
 * the chunk byte bound. Pure helper: deterministic, no IO.
 */
export function planFileChunks(
	files: readonly FileChunkInput[],
	maxChunkBytes: number = CODEBASE_MAX_CHUNK_BYTES,
): FileChunkPayload[] {
	const dataBudget = Math.max(1, maxChunkBytes - SYNC_ENVELOPE_RESERVE_BYTES);
	const chunks: FileChunkPayload[] = [];
	for (const file of files) {
		// Zero-byte files carry no content; the strict per-chunk transport
		// contract rejects empty payloads, and the manifest builder marks them
		// ineligible so this skip matches what the server expects.
		if (file.base64.length === 0) continue;
		const total = Math.max(
			1,
			Math.ceil(new TextEncoder().encode(file.base64).length / dataBudget),
		);
		// Slices must fall on 4-char base64 boundaries: a chunk cut anywhere
		// else is not standalone-valid base64 and fails the server's strict
		// per-chunk validation. floor-to-multiple-of-4 keeps each interior
		// slice within the byte budget and the remainder is a multiple of 4
		// because canonical base64 text length always is.
		const chunkChars = Math.max(
			4,
			Math.floor(file.base64.length / total / 4) * 4,
		);
		const chunkTotal = Math.ceil(file.base64.length / chunkChars);
		for (let index = 0; index < chunkTotal; index += 1) {
			const start = index * chunkChars;
			chunks.push({
				path: file.path,
				chunkIndex: index,
				chunkTotal,
				encoding: "base64",
				data: file.base64.slice(
					start,
					index === chunkTotal - 1 ? undefined : start + chunkChars,
				),
				contentHash: file.hash,
			});
		}
	}
	return chunks;
}

/** Split manifest entries into batches bounded by serialized JSON size. */
export function planManifestBatches(
	entries: readonly SyncManifestEntry[],
	maxBatchBytes: number = CODEBASE_MAX_CHUNK_BYTES,
): SyncManifestEntry[][] {
	const batches: SyncManifestEntry[][] = [];
	const packingBudget = Math.max(
		1,
		maxBatchBytes - SYNC_ENVELOPE_RESERVE_BYTES,
	);
	let current: SyncManifestEntry[] = [];
	let currentBytes = 2; // "[]"
	for (const entry of entries) {
		const entryBytes =
			new TextEncoder().encode(JSON.stringify(entry)).length + 1; // + comma
		if (current.length > 0 && currentBytes + entryBytes > packingBudget) {
			batches.push(current);
			current = [];
			currentBytes = 2;
		}
		current.push(entry);
		currentBytes += entryBytes;
	}
	if (current.length > 0) batches.push(current);
	return batches;
}

function compareVersions(a: string, b: string): number {
	const parts = (v: string) => v.split(".").map((n) => Number(n) || 0);
	const [aParts, bParts] = [parts(a), parts(b)];
	for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
		const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

export interface SyncClient {
	handshake(projectId: string): Promise<HandshakeResponse>;
	handshakeWithRetry(projectId: string): Promise<HandshakeResponse>;
	uploadManifestWithRetry(
		projectId: string,
		session: SyncSession,
		entries: readonly SyncManifestEntry[],
	): Promise<ManifestUploadResponse>;
	uploadFileChunksWithRetry(
		projectId: string,
		session: SyncSession,
		chunks: readonly FileChunkPayload[],
		startIndex?: number,
	): Promise<FileChunkUploadResponse>;
	completeWithRetry(
		projectId: string,
		input: CompletionInput,
	): Promise<CompletionResponse>;
}

export function createSyncClient(options: SyncClientOptions): SyncClient {
	const { apiUrl, syncToken, timeoutMs } = options;

	function post<T>(
		projectId: string,
		suffix: "sync" | "manifest" | "files" | "complete",
		body: unknown,
	): Promise<T> {
		return apiRequest<T>(`/api/v1/projects/${projectId}/codebase/${suffix}`, {
			method: "POST",
			body,
			authToken: syncToken,
			baseUrl: apiUrl,
			timeoutMs,
			maxBodyBytes: CODEBASE_MAX_CHUNK_BYTES,
		});
	}

	async function handshake(projectId: string): Promise<HandshakeResponse> {
		const res = await post<HandshakeResponse>(projectId, "sync", {
			cliVersion: CODEBASE_CLI_VERSION,
		});
		const minVersion = res.cliMinVersion ?? CODEBASE_CLI_MIN_VERSION;
		if (compareVersions(CODEBASE_CLI_VERSION, minVersion) < 0) {
			throw new ApiError(
				`prdfy CLI ${CODEBASE_CLI_VERSION} is below the required version ${minVersion}. Update with: npm i -g @ghazynabiel/prdfy`,
				{ code: "CLI_UPDATE_REQUIRED", retryable: false },
			);
		}
		return res;
	}

	async function uploadManifest(
		projectId: string,
		session: SyncSession,
		entries: readonly SyncManifestEntry[],
	): Promise<ManifestUploadResponse> {
		const batches = planManifestBatches(entries);
		let last: ManifestUploadResponse = { status: "uploading" };
		const total = Math.max(batches.length, 1);
		const sendBatch = async (
			batch: readonly SyncManifestEntry[],
			batchIndex: number,
		): Promise<ManifestUploadResponse> =>
			post<ManifestUploadResponse>(projectId, "manifest", {
				sessionId: session.sessionId,
				attemptId: session.attemptId,
				batchIndex,
				batchTotal: total,
				entries: batch,
				idempotencyKey: makeIdempotencyKey(
					session.attemptId,
					"manifest",
					batchIndex,
				),
			});
		if (batches.length === 0) {
			return sendBatch([], 0);
		}
		for (let i = 0; i < batches.length; i += 1) {
			last = await sendBatch(batches[i], i);
		}
		return last;
	}

	async function uploadFileChunks(
		projectId: string,
		session: SyncSession,
		chunks: readonly FileChunkPayload[],
		startIndex = 0,
	): Promise<FileChunkUploadResponse> {
		let last: FileChunkUploadResponse = { status: "uploading" };
		for (let i = 0; i < chunks.length; i += 1) {
			const chunk = chunks[i];
			last = await post<FileChunkUploadResponse>(projectId, "files", {
				sessionId: session.sessionId,
				attemptId: session.attemptId,
				path: chunk.path,
				chunkIndex: chunk.chunkIndex,
				chunkTotal: chunk.chunkTotal,
				encoding: chunk.encoding,
				data: chunk.data,
				contentHash: chunk.contentHash,
				idempotencyKey: makeIdempotencyKey(
					session.attemptId,
					"file",
					startIndex + i,
				),
			});
		}
		return last;
	}

	async function complete(
		projectId: string,
		input: CompletionInput,
	): Promise<CompletionResponse> {
		return post<CompletionResponse>(projectId, "complete", {
			sessionId: input.sessionId,
			attemptId: input.attemptId,
			fileCount: input.fileCount,
			excludedCount: input.excludedCount,
			idempotencyKey: makeIdempotencyKey(input.attemptId, "complete", 0),
		});
	}

	return {
		handshake,
		handshakeWithRetry: (projectId) =>
			withSyncRetry(() => handshake(projectId)),
		uploadManifestWithRetry: (projectId, session, entries) =>
			withSyncRetry(() => uploadManifest(projectId, session, entries)),
		uploadFileChunksWithRetry: (projectId, session, chunks, startIndex = 0) =>
			withSyncRetry(() =>
				uploadFileChunks(projectId, session, chunks, startIndex),
			),
		completeWithRetry: (projectId, input) =>
			withSyncRetry(() => complete(projectId, input)),
	};
}
