import { z } from "zod";
import {
	CODEBASE_CLI_MIN_VERSION,
	CODEBASE_MAX_CHUNK_BYTES,
	CODEBASE_MAX_ERROR_MESSAGE_CHARS,
	CODEBASE_MAX_FILE_BYTES,
	CODEBASE_MAX_SNAPSHOT_BYTES,
} from "./constants";

// === Project mode ===
// NOTE: `projects.mode` ("ai_auto" | "manual") is the generation mode and is
// unrelated. `projectMode` below distinguishes greenfield from
// existing-codebase projects; existing projects default to greenfield.

export const EXISTING_CODEBASE_PROJECT_MODES = [
	"greenfield",
	"existing_codebase",
] as const;

export type ExistingCodebaseProjectMode =
	(typeof EXISTING_CODEBASE_PROJECT_MODES)[number];

export const existingCodebaseProjectModeSchema = z.enum(
	EXISTING_CODEBASE_PROJECT_MODES,
);

// === Sync status state machine ===
// Linear chain: waiting_for_cli → connected → scanning → filtering →
// uploading → uploaded → analyzing → ready. Any active state may move to
// failed or expired (session expiry is time-based, not CLI-reported).
// Terminal states (ready, failed, expired) have no outgoing transitions; a
// sync retry creates a new session/attempt instead of mutating a terminal
// record. One documented exception: analyzing → uploaded. An analysis attempt
// is not an upload — when the model call fails, the snapshot underneath is
// still uploaded and valid, so the session returns to `uploaded` where a
// fresh analysis record (never an in-place update) may be requested. Sync
// transport failures still move to `failed` and require a new session.

export const CODEBASE_SYNC_STATUSES = [
	"waiting_for_cli",
	"connected",
	"scanning",
	"filtering",
	"uploading",
	"uploaded",
	"analyzing",
	"ready",
	"failed",
	"expired",
] as const;

export type CodebaseSyncStatus = (typeof CODEBASE_SYNC_STATUSES)[number];

export const codebaseSyncStatusSchema = z.enum(CODEBASE_SYNC_STATUSES);

export const CODEBASE_SYNC_TERMINAL_STATUSES: readonly CodebaseSyncStatus[] = [
	"ready",
	"failed",
	"expired",
] as const;

// === Persisted row vocabularies ===
// `codebase_snapshots.status` mirrors the sync flow from upload onward;
// `codebase_analyses.status` is a separate small lifecycle. Both are
// documented here so schema defaults never drift into unlisted literals.

export const CODEBASE_SNAPSHOT_STATUSES = [
	"uploading",
	"uploaded",
	"analyzing",
	"ready",
	"failed",
	"expired",
] as const;

export type CodebaseSnapshotStatus =
	(typeof CODEBASE_SNAPSHOT_STATUSES)[number];

export const CODEBASE_ANALYSIS_STATUSES = [
	"pending",
	"ready",
	"failed",
] as const;

export type CodebaseAnalysisStatus =
	(typeof CODEBASE_ANALYSIS_STATUSES)[number];

export const codebaseAnalysisStatusSchema = z.enum(CODEBASE_ANALYSIS_STATUSES);

type SyncTransitionMap = Record<
	CodebaseSyncStatus,
	readonly CodebaseSyncStatus[]
>;

const SYNC_TRANSITIONS: SyncTransitionMap = {
	waiting_for_cli: ["connected", "failed", "expired"],
	connected: ["scanning", "failed", "expired"],
	scanning: ["filtering", "failed", "expired"],
	filtering: ["uploading", "failed", "expired"],
	uploading: ["uploaded", "failed", "expired"],
	uploaded: ["analyzing", "failed", "expired"],
	// analyzing → uploaded is the analysis-retry rollback only (Task 6): the
	// snapshot stays `uploaded`, and the next attempt writes a fresh analysis
	// record. Terminal states below keep zero outgoing transitions.
	analyzing: ["uploaded", "ready", "failed", "expired"],
	ready: [],
	failed: [],
	expired: [],
};

export class SyncTransitionError extends Error {
	readonly code = "INVALID_SYNC_TRANSITION" as const;
	readonly from: CodebaseSyncStatus;
	readonly to: CodebaseSyncStatus;

	constructor(from: CodebaseSyncStatus, to: CodebaseSyncStatus) {
		super(`Invalid sync transition: ${from} -> ${to}`);
		this.name = "SyncTransitionError";
		this.from = from;
		this.to = to;
	}
}

export function isTerminalSyncStatus(status: CodebaseSyncStatus): boolean {
	return (CODEBASE_SYNC_TERMINAL_STATUSES as readonly string[]).includes(
		status,
	);
}

export function canTransitionSyncStatus(
	from: CodebaseSyncStatus,
	to: CodebaseSyncStatus,
): boolean {
	return SYNC_TRANSITIONS[from].includes(to);
}

export function assertSyncTransition(
	from: CodebaseSyncStatus,
	to: CodebaseSyncStatus,
): void {
	if (!canTransitionSyncStatus(from, to)) {
		throw new SyncTransitionError(from, to);
	}
}

// === Path safety ===
// Manifest/source payloads must carry repository-relative paths only: no
// absolute paths, no `..` escapes, no empty values, no null bytes.
// Backslashes are normalized to `/` first so Windows absolute (`\abs`,
// `C:\...`), UNC (`\\share`), drive-relative (`C:foo`), and
// backslash-traversal (`foo\..\evil`) payloads cannot bypass the check.

export function isSafeRelativePath(path: string): boolean {
	if (!path || path.length === 0) return false;
	if (path.includes("\0")) return false;
	const normalized = path.replace(/\\/g, "/");
	if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return false;
	const segments = normalized.split("/");
	for (const segment of segments) {
		if (segment === "" || segment === "." || segment === "..") return false;
	}
	return true;
}

// === DTOs (Zod boundary validation) ===

export const manifestEntrySchema = z.object({
	path: z.string().refine(isSafeRelativePath, {
		message: "Manifest path must be a safe repository-relative path",
	}),
	size: z.number().int().nonnegative().max(CODEBASE_MAX_FILE_BYTES),
	hash: z.string().regex(/^[0-9a-f]{64}$/i, {
		message: "Manifest hash must be SHA-256 hex",
	}),
	language: z.string().min(1).optional(),
});

export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

export const syncPromptPayloadSchema = z.object({
	projectId: z.string().min(1),
	apiBaseUrl: z.string().url(),
	// Raw credential transferred once to the local agent. Never persisted.
	syncToken: z.string().min(1),
	cliMinVersion: z.string().min(1).default(CODEBASE_CLI_MIN_VERSION),
	syncCommand: z.string().min(1),
	expiresAt: z.string().datetime(),
});

export type SyncPromptPayload = z.infer<typeof syncPromptPayloadSchema>;

export const syncStatusResponseSchema = z.object({
	projectId: z.string().min(1),
	sessionId: z.string().min(1),
	status: codebaseSyncStatusSchema,
	fileCount: z.number().int().nonnegative().optional(),
	excludedCount: z.number().int().nonnegative().optional(),
	errorCode: z.string().min(1).nullable().optional(),
	errorMessage: z.string().min(1).nullable().optional(),
	// Latest snapshot bound to the polled session, when one exists. Lets the
	// review page scope its analysis read to the current attempt so a
	// retry-sync never renders a stale review from a previous session.
	snapshotId: z.string().min(1).nullable().optional(),
	// Snapshot creation timestamp ("Waktu sync" in the review page).
	snapshotCreatedAt: z.string().datetime().optional(),
	analysisId: z.string().min(1).nullable().optional(),
	// Latest analysis status for the snapshot (pending while the model runs,
	// ready on success, failed when retryable). Drives the review/retry UI;
	// absent when no analysis has been requested yet.
	analysisStatus: codebaseAnalysisStatusSchema.optional(),
	createdAt: z.string().datetime().optional(),
	updatedAt: z.string().datetime().optional(),
	expiresAt: z.string().datetime().optional(),
});

export type SyncStatusResponse = z.infer<typeof syncStatusResponseSchema>;

export const snapshotContextSchema = z.object({
	snapshotId: z.string().min(1),
	projectId: z.string().min(1),
	branch: z.string().min(1).nullable().optional(),
	commitSha: z.string().min(1).nullable().optional(),
	fileCount: z.number().int().nonnegative(),
	excludedCount: z.number().int().nonnegative().optional(),
	relevantPaths: z.array(z.string().min(1)).optional(),
	createdAt: z.string().datetime().optional(),
});

export type SnapshotContext = z.infer<typeof snapshotContextSchema>;

// === Generation-context selection ===
// The first successful snapshot becomes the active generation context. A
// later snapshot never silently rewrites output; new generation requests use
// the latest user-selected ready snapshot when one is chosen.
//
// First-ready default + selection follow-up (Task 9): per-snapshot selection
// UI does not exist in MVP, so `selectedId` is currently always unset and
// the earliest ready snapshot wins deterministically. The Ask handoff stores
// an advisory `snapshotId` (write-through at submit) for traceability, but
// generation resolves via this function at call time and ignores it — when
// selection UI lands, it must pass the chosen id here AND stop ignoring the
// handoff stamp.

export interface SelectableSnapshot {
	id: string;
	status: string;
	createdAt: string;
}

export function selectActiveSnapshot<T extends SelectableSnapshot>(
	snapshots: readonly T[],
	selectedId?: string,
): T | null {
	const ready = [...snapshots]
		.filter((snapshot) => snapshot.status === "ready")
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	if (ready.length === 0) return null;
	if (selectedId) {
		const selected = ready.find((snapshot) => snapshot.id === selectedId);
		if (selected) return selected;
	}
	return ready[0];
}

// === Sync capability scope (Task 4) ===
// Dedicated narrow scope for codebase sync uploads. A sync credential must
// not grant task mutation or unrelated project access, and ordinary auto-CLI
// keys (`read:project`, `write:task:status`, …) must never satisfy a sync
// capability check. Auto-key scopes in
// `src/routes/api/settings/api-keys/auto.ts` stay unchanged.

export const CODEBASE_SYNC_SCOPE = "codebase:sync" as const;

export function hasSyncCapability(
	scopes: readonly string[] | null | undefined,
): boolean {
	if (!scopes) return false;
	return (
		scopes.includes(CODEBASE_SYNC_SCOPE) ||
		scopes.includes("admin") ||
		scopes.includes("*")
	);
}

// === Sync rate-limit convention (Task 4) ===
// Sync endpoints reuse the neighboring `api_call` action from
// `src/lib/rate-limit.ts` (same convention as `/api/ask/options`).

export const CODEBASE_SYNC_RATE_LIMIT_ACTION = "api_call" as const;

// === Sync session lifecycle (Task 4; pure, DB-agnostic) ===
// Row shapes are structural so these helpers stay unit-testable without a
// database and importable from isomorphic code (no node:crypto here —
// credential generation/hashing lives in `codebase-sync.server.ts`).

export interface SyncSessionLike {
	id: string;
	projectId: string;
	userId: string;
	status: string;
	expiresAt: Date | string;
	consumedAt?: Date | string | null;
	updatedAt?: Date | string | null;
}

export type SessionUsability =
	| { usable: true }
	| {
			usable: false;
			code:
				| "SYNC_SESSION_EXPIRED"
				| "SYNC_CREDENTIAL_REVOKED"
				| "SYNC_SESSION_TERMINAL";
			httpStatus: 401 | 410;
	  };

export function getSessionUsability(
	session: SyncSessionLike,
	now: Date = new Date(),
): SessionUsability {
	if (session.consumedAt) {
		return {
			usable: false,
			code: "SYNC_CREDENTIAL_REVOKED",
			httpStatus: 401,
		};
	}
	if (new Date(session.expiresAt).getTime() <= now.getTime()) {
		return {
			usable: false,
			code: "SYNC_SESSION_EXPIRED",
			httpStatus: 410,
		};
	}
	if (!codebaseSyncStatusSchema.safeParse(session.status).success) {
		return {
			usable: false,
			code: "SYNC_SESSION_TERMINAL",
			httpStatus: 401,
		};
	}
	if (
		(CODEBASE_SYNC_TERMINAL_STATUSES as readonly string[]).includes(
			session.status,
		)
	) {
		return {
			usable: false,
			code: "SYNC_SESSION_TERMINAL",
			httpStatus: 401,
		};
	}
	return { usable: true };
}

export function canAccessSyncSession(
	session: Pick<SyncSessionLike, "projectId" | "userId">,
	userId: string,
	projectId: string,
): boolean {
	return session.userId === userId && session.projectId === projectId;
}

export function isSyncCapableProject(project: {
	projectMode?: string | null;
}): boolean {
	return project?.projectMode === "existing_codebase";
}

// Browser handoff for Home-created existing-codebase projects: the creation
// response carries the one-time sync payload, the Home composer stashes it
// under this per-project sessionStorage key, and the /codebase/$id page
// consumes it once to open the agent modal. The key carries only the project
// id — never credential material.
export function getPendingSyncPayloadKey(projectId: string): string {
	return `prdfy:sync-payload:${projectId}`;
}

// One usable credential per project: this predicate is advisory only; session
// creation must re-check under a per-project transaction/advisory lock
// (`pg_advisory_xact_lock(hashtext(projectId))` in `/api/codebase/$projectId/session`)
// so concurrent mints cannot race to issue multiple usable credentials.
// Terminal or expired rows never block a retry — the retry mints a new
// session instead of mutating them.
export function shouldCreateSyncSession(
	existing: readonly SyncSessionLike[],
	now: Date = new Date(),
): boolean {
	return !existing.some((session) => getSessionUsability(session, now).usable);
}

// Revocation is explicit: the row moves to `expired` and records consumption
// so the credential is rejected after completion, expiry, or manual revoke.
// The credential hash is preserved (audit); no raw credential is introduced.
export function applySessionRevocation<T extends SyncSessionLike>(
	session: T,
	now: Date = new Date(),
): T {
	return { ...session, status: "expired", consumedAt: now, updatedAt: now };
}

export interface SyncSessionMetadata {
	sessionId: string;
	projectId: string;
	status: string;
	expiresAt: string;
	createdAt?: string;
	updatedAt?: string;
}

// Browser reads (session GET, status polling) expose metadata only — never
// the credential hash or a raw credential after initial creation.
export function toSessionMetadata(
	session: SyncSessionLike & {
		credentialHash?: string;
		createdAt?: Date | string | null;
	},
): SyncSessionMetadata {
	const toIso = (
		value: Date | string | null | undefined,
	): string | undefined => {
		if (!value) return undefined;
		return value instanceof Date ? value.toISOString() : value;
	};
	return {
		sessionId: session.id,
		projectId: session.projectId,
		status: session.status,
		expiresAt: toIso(session.expiresAt) ?? "",
		createdAt: toIso(session.createdAt),
		updatedAt: toIso(session.updatedAt),
	};
}

// === Safe sync errors (Task 4) ===
// Only whitelisted codes reach clients. Unknown/detail errors collapse to
// SYNC_FAILED so tokens, source data, and internals never leak into errors.

export const SYNC_SAFE_ERROR_CODES = [
	"SYNC_FAILED",
	"SYNC_SESSION_ACTIVE",
	"SYNC_SESSION_EXPIRED",
	"SYNC_SESSION_TERMINAL",
	"SYNC_CREDENTIAL_REVOKED",
	"INVALID_SYNC_CREDENTIAL",
	"NO_SYNC_SESSION",
	"CLI_UPDATE_REQUIRED",
	"PROJECT_MODE_MISMATCH",
	"SNAPSHOT_TOO_LARGE",
	"SNAPSHOT_INCOMPLETE",
	"SNAPSHOT_CONFLICT",
	"SNAPSHOT_HASH_MISMATCH",
	"ANALYSIS_FAILED",
] as const;

export type SyncSafeErrorCode = (typeof SYNC_SAFE_ERROR_CODES)[number];

export function sanitizeSyncErrorCode(code: unknown): SyncSafeErrorCode {
	if (
		typeof code === "string" &&
		(SYNC_SAFE_ERROR_CODES as readonly string[]).includes(code)
	) {
		return code as SyncSafeErrorCode;
	}
	return "SYNC_FAILED";
}

// === CLI handshake DTOs (Task 4) ===
// Mirrors `packages/cli/src/lib/sync-client.ts`: the CLI POSTs `{cliVersion}`
// with the sync token as Bearer auth and expects the bound session/attempt/
// snapshot identity plus the minimum CLI version (the CLI enforces the gate
// client-side via `CLI_UPDATE_REQUIRED`).

export const cliHandshakeRequestSchema = z.object({
	cliVersion: z.string().min(1).max(64),
});

export type CliHandshakeRequest = z.infer<typeof cliHandshakeRequestSchema>;

export const cliHandshakeResponseSchema = z.object({
	sessionId: z.string().min(1),
	attemptId: z.string().min(1),
	snapshotId: z.string().min(1),
	status: codebaseSyncStatusSchema,
	cliMinVersion: z.string().min(1),
	expiresAt: z.string().datetime(),
});

export type CliHandshakeResponse = z.infer<typeof cliHandshakeResponseSchema>;

// Numeric semver comparison for the server-side version hint. Malformed
// input is treated as unsupported (fail closed).
export function isSupportedCliVersion(
	cliVersion: string,
	minVersion: string = CODEBASE_CLI_MIN_VERSION,
): boolean {
	const parse = (value: string): number[] | null => {
		const parts = value.split(".");
		if (parts.length === 0) return null;
		const numbers: number[] = [];
		for (const part of parts) {
			if (!/^\d+$/.test(part)) return null;
			numbers.push(Number(part));
		}
		return numbers;
	};
	const current = parse(cliVersion);
	const minimum = parse(minVersion);
	if (!current || !minimum) return false;
	for (let i = 0; i < Math.max(current.length, minimum.length); i += 1) {
		const diff = (current[i] ?? 0) - (minimum[i] ?? 0);
		if (diff !== 0) return diff > 0;
	}
	return true;
}

const SAFE_PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

// Locked CLI invocation. The raw credential travels in `SyncPromptPayload`
// (`syncToken` field, exposed once); the command embeds only a placeholder so
// the credential never appears in a copyable string by accident. The project id
// must be a safe identifier (alphanumeric, dashes, underscores) to prevent shell
// metacharacter injection when copied into a terminal.
export function buildSyncCommand(projectId: string): string {
	if (!SAFE_PROJECT_ID_PATTERN.test(projectId)) {
		throw new Error(`Invalid project ID format: "${projectId}"`);
	}
	return `prdfy codebase sync --project-id ${projectId} --sync-token <token>`;
}

// === External-agent prompt ===
// Self-contained execution document for a local AI coding agent (Claude Code,
// Codex CLI, Gemini CLI, OpenCode, …). The agent must not have to guess where
// it runs, when to install, whether to create `.prdfyignore`, what the CLI
// already handles, what is forbidden, or how to report. Sections follow a fixed
// order: tujuan → project info → prasyarat → command → CLI-otomatis → aturan →
// kegagalan → format laporan.
//
// Boundaries kept deliberately:
// - One command, inline flags, no environment variable, no alternative. The
//   command stays on a single line: a backslash continuation is valid in
//   bash/zsh but is a parse error in PowerShell and cmd.exe, so a multi-line
//   form would break on Windows for no benefit.
// - No minimum-version number: the CLI validates it and prints the update
//   notice. The prompt only states that the CLI does it.
// - The exclusions section names categories with `.env` as the one concrete
//   example (it is a stable, universally understood name) but never enumerates
//   path patterns, which would rot and could contradict the CLI's built-ins.
// - The raw credential appears inline because a single copy-pasteable command
//   is the whole point; every other surface renders `<token>` instead (see
//   `buildSyncCommand`).
export function buildAgentPrompt(
	payload: SyncPromptPayload,
	context?: { projectName?: string },
): string {
	const command = `prdfy codebase sync --project-id ${payload.projectId} --sync-token ${payload.syncToken}`;
	const infoLines = [
		`Project ID   : ${payload.projectId}`,
		`Server       : ${payload.apiBaseUrl}`,
		`Sync Token   : ${payload.syncToken}`,
		`Expired At   : ${payload.expiresAt}`,
	];
	// "Nama Fitur" is only rendered when the name is actually known; an empty
	// placeholder would read as a missing value the agent might try to fill in.
	if (context?.projectName) {
		infoLines.unshift(`Nama Fitur   : ${context.projectName}`);
	}

	return [
		"Sinkronkan codebase repositori lokal ini ke project PrdFy menggunakan CLI resmi.",
		"Fokus hanya pada proses sinkronisasi; jangan melakukan perubahan terhadap source code.",
		"",
		"## Informasi Project",
		...infoLines,
		"",
		"## Prasyarat Eksekusi",
		"1. Pastikan kamu berada di root repositori Git.",
		"2. Gunakan PrdFy CLI untuk menjalankan sinkronisasi.",
		"3. Jika command `prdfy` tidak tersedia, install dulu:",
		"   npm i -g @ghazynabiel/prdfy",
		"",
		"## Perintah Yang Harus Dieksekusi",
		command,
		"",
		"## Yang Dilakukan CLI Otomatis",
		"Bagian ini bersifat informasi. Jangan kerjakan ulang secara manual.",
		"- Deteksi root repository.",
		"- Validasi versi minimum CLI.",
		"- Pembuatan `.prdfyignore` jika belum ada.",
		"- Penggunaan ignore bawaan.",
		"- Pengecualian file rahasia (termasuk `.env`), secret, dependency, build, dan cache.",
		"- Hashing dan upload hanya file yang diizinkan.",
		"",
		"## Aturan Yang Wajib Dipatuhi",
		"- [ ] Jangan mengubah source code.",
		"- [ ] Jangan membuat commit.",
		"- [ ] Jangan push.",
		"- [ ] Jangan mengedit `.gitignore`.",
		"- [ ] Jangan menulis Sync Token ke file proyek.",
		"- [ ] Jangan menyimpan token ke konfigurasi permanen.",
		"- [ ] Jangan memodifikasi `.prdfyignore` kecuali diminta user.",
		"- [ ] Jangan mengklaim sinkronisasi berhasil tanpa output CLI.",
		"",
		"## Penanganan Kegagalan",
		"Jika sinkronisasi gagal:",
		"- Tampilkan error CLI asli tanpa diringkas.",
		"- Jangan perbaiki sendiri.",
		"- Jangan retry dengan command berbeda.",
		"- Jangan mengarang penyebab.",
		"Laporkan hanya hasil nyata.",
		"",
		"## Format Laporan Akhir",
		"Kembalikan laporan dengan format berikut tanpa menambah bagian lain:",
		"",
		"Status:",
		"Berhasil / Gagal",
		"",
		"Project:",
		payload.projectId,
		"",
		"Server:",
		payload.apiBaseUrl,
		"",
		"CLI Version:",
		"<x.x.x dari output CLI, atau - jika tidak tersedia>",
		"",
		"Hasil CLI:",
		"<output CLI asli>",
		"",
		"Catatan:",
		"Kosong jika tidak ada.",
	].join("\n");
}

// === Upload transport DTOs (Task 5) ===
// These schemas mirror `packages/cli/src/lib/sync-client.ts` request shapes
// EXACTLY. The CLI POSTs manifest batches as
// `{ sessionId, attemptId, batchIndex, batchTotal, entries, idempotencyKey }`,
// file chunks as
// `{ sessionId, attemptId, path, chunkIndex, chunkTotal, encoding, data,
// contentHash, idempotencyKey }`, and completion as
// `{ sessionId, attemptId, fileCount, excludedCount, idempotencyKey }`.
// Unknown extra fields are stripped (never rejected) so a newer CLI that
// attaches advisory metadata keeps working against this server.

const idempotencyKeySchema = z.string().min(1).max(128);

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/i, {
	message: "Hash must be SHA-256 hex",
});

export const manifestBatchRequestSchema = z
	.object({
		sessionId: z.string().min(1),
		attemptId: z.string().min(1),
		batchIndex: z.number().int().nonnegative(),
		batchTotal: z.number().int().positive(),
		// Empty batches are legal: the CLI sends one empty batch when the
		// repository has zero eligible files.
		entries: z.array(manifestEntrySchema),
		idempotencyKey: idempotencyKeySchema,
	})
	.refine((body) => body.batchIndex < body.batchTotal, {
		message: "batchIndex must be within batchTotal",
	});

export type ManifestBatchRequest = z.infer<typeof manifestBatchRequestSchema>;

// Strict base64 shape (canonical alphabet, correct padding). Full byte-level
// verification happens server-side in `verifyFileContentHash`.
export function isStrictBase64(value: string): boolean {
	if (!value || value.length % 4 !== 0) return false;
	return /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

export const fileChunkRequestSchema = z
	.object({
		sessionId: z.string().min(1),
		attemptId: z.string().min(1),
		path: z.string().refine(isSafeRelativePath, {
			message: "Chunk path must be a safe repository-relative path",
		}),
		chunkIndex: z.number().int().nonnegative(),
		chunkTotal: z.number().int().positive(),
		encoding: z.literal("base64"),
		// Base64 text only (binaries are excluded client-side, never uploaded).
		// Char length is capped at the transport bound; decoded bytes are
		// strictly smaller, so this conservatively enforces the 256 KiB limit.
		data: z
			.string()
			.min(1)
			.max(CODEBASE_MAX_CHUNK_BYTES)
			.refine(isStrictBase64, { message: "Chunk data must be base64" }),
		contentHash: sha256HexSchema,
		idempotencyKey: idempotencyKeySchema,
	})
	.refine((body) => body.chunkIndex < body.chunkTotal, {
		message: "chunkIndex must be within chunkTotal",
	});

export type FileChunkRequest = z.infer<typeof fileChunkRequestSchema>;

export const snapshotCompleteRequestSchema = z.object({
	sessionId: z.string().min(1),
	attemptId: z.string().min(1),
	// Locked count definition: fileCount = eligible manifest entries,
	// excludedCount = ALL exclusions (built-in + secret + .prdfyignore +
	// unreadable + binary). The server verifies fileCount against the stored
	// manifest; excludedCount is CLI-reported and stored as-is.
	fileCount: z.number().int().nonnegative(),
	excludedCount: z.number().int().nonnegative(),
	idempotencyKey: idempotencyKeySchema,
});

export type SnapshotCompleteRequest = z.infer<
	typeof snapshotCompleteRequestSchema
>;

// === Idempotency key binding (Task 5) ===
// Keys mirror the CLI `makeIdempotencyKey` format
// (`${attemptId}:${kind}:${index}`) and carry no credentials. A retry reuses
// the same key for the same slot, so replay returns the stored response
// without duplicating records. Key reuse across slots is rejected fail-closed.

export type SyncIdempotencyKind = "manifest" | "file" | "complete";

export function buildIdempotencyKey(
	attemptId: string,
	kind: SyncIdempotencyKind,
	index: number,
): string {
	return `${attemptId}:${kind}:${index}`;
}

export function isExpectedIdempotencyKey(
	key: unknown,
	attemptId: string,
	kind: SyncIdempotencyKind,
	index: number,
): boolean {
	return (
		typeof key === "string" &&
		key.length > 0 &&
		key === buildIdempotencyKey(attemptId, kind, index)
	);
}

// Slot-shape binding for file chunks. The CLI numbers file keys by its own
// flat chunk sequence (`makeIdempotencyKey(attemptId, "file", i)` over the
// whole chunk list), which the server cannot reconstruct — so the files
// endpoint binds the `${attemptId}:file:<n>` shape: exact replay still hits
// the stored key byte-for-byte, while cross-attempt and cross-kind key reuse
// is rejected fail-closed.
export function isSlotIdempotencyKey(
	key: unknown,
	attemptId: string,
	kind: SyncIdempotencyKind,
): boolean {
	if (typeof key !== "string" || !attemptId) return false;
	const prefix = `${attemptId}:${kind}:`;
	if (!key.startsWith(prefix)) return false;
	return /^\d+$/.test(key.slice(prefix.length));
}

// === Idempotent replay identity (Task 9 hardening) ===
// On an idempotency-key hit the route returns the stored response WITHOUT
// re-applying the payload. These pure checks verify the replayed payload's
// identity agrees with stored state first; a divergent retry fails closed
// (409 SNAPSHOT_CONFLICT) instead of silently returning success. The CLI
// always resends byte-identical payloads on retry, so true retries pass.

function sameManifestIdentity(
	stored: ManifestEntry,
	replayed: ManifestEntry,
): boolean {
	return (
		stored.size === replayed.size &&
		stored.hash.toLowerCase() === replayed.hash.toLowerCase() &&
		(stored.language ?? undefined) === (replayed.language ?? undefined)
	);
}

/** Containment identity: the stored manifest accumulates every merged batch,
 *  so a legitimate retry of one earlier batch always sees a superset (the CLI
 *  retries the WHOLE batch loop with the same keys after any transient
 *  failure). Every replayed entry must exist in stored with the same
 *  identity; a forged/unknown path, divergent entry, or a batch larger than
 *  the stored manifest fails closed. */
export function isManifestReplayCompatible(
	stored: readonly ManifestEntry[],
	replayed: readonly ManifestEntry[],
): boolean {
	if (replayed.length === 0) return stored.length === 0;
	if (replayed.length > stored.length) return false;
	const byPath = new Map(stored.map((entry) => [entry.path, entry]));
	for (const entry of replayed) {
		const previous = byPath.get(entry.path);
		if (!previous || !sameManifestIdentity(previous, entry)) return false;
	}
	return true;
}

export interface StoredFileChunkLike {
	path: string;
	chunkIndex: number;
	chunkTotal: number;
	contentHash: string;
	data: string;
}

export interface ReplayedFileChunkLike {
	path: string;
	chunkIndex: number;
	chunkTotal: number;
	contentHash: string;
	data: string;
}

/** The replayed chunk must match the stored (path, chunkIndex) row
 *  byte-for-byte. A missing row means stored state desynced from the
 *  idempotency record — fail closed rather than report success. */
export function isFileReplayCompatible(
	storedRows: readonly StoredFileChunkLike[],
	replayed: ReplayedFileChunkLike,
): boolean {
	const row = storedRows.find(
		(candidate) =>
			candidate.path === replayed.path &&
			candidate.chunkIndex === replayed.chunkIndex,
	);
	if (!row) return false;
	return (
		row.chunkTotal === replayed.chunkTotal &&
		row.contentHash.toLowerCase() === replayed.contentHash.toLowerCase() &&
		row.data === replayed.data
	);
}

/** Completion replay must carry the same counts that produced the stored
 *  result; divergent counts mean the client is completing a different
 *  snapshot view. */
export function isCompleteReplayCompatible(
	stored: { fileCount: number; excludedCount: number },
	replayed: { fileCount: number; excludedCount: number },
): boolean {
	return (
		stored.fileCount === replayed.fileCount &&
		stored.excludedCount === replayed.excludedCount
	);
}
// One session is one attempt: attemptId MUST equal the bound session id.
// Anything else is a foreign/wrong-project credential use — rejected with the
// uniform credential error (no oracle, no id echo).

// === Attempt binding (Task 5) ===
export class SyncBindingError extends Error {
	readonly code = "INVALID_SYNC_CREDENTIAL" as const;

	constructor() {
		super("Invalid sync credential");
		this.name = "SyncBindingError";
	}
}

export function assertAttemptBinding(
	sessionId: string,
	attemptId: string,
): void {
	if (!sessionId || !attemptId || sessionId !== attemptId) {
		throw new SyncBindingError();
	}
}

// === Upload session advancement (Task 5) ===
// The CLI reports no scanning/filtering states itself — it handshakes
// (waiting_for_cli -> connected) then uploads. Upload endpoints walk the
// session through the remaining valid chain steps so the persisted history
// never skips a transition. Uploads before handshake or after completion are
// rejected; completion has its own uploaded transition.

export function uploadTransitionSteps(
	from: CodebaseSyncStatus,
): Array<[CodebaseSyncStatus, CodebaseSyncStatus]> {
	switch (from) {
		case "connected":
			return [
				["connected", "scanning"],
				["scanning", "filtering"],
				["filtering", "uploading"],
			];
		case "scanning":
			return [
				["scanning", "filtering"],
				["filtering", "uploading"],
			];
		case "filtering":
			return [["filtering", "uploading"]];
		case "uploading":
			return [];
		default:
			throw new SyncTransitionError(from, "uploading");
	}
}

// === Snapshot completion verification (Task 5; pure, DB-agnostic) ===
// Runs on stored manifest + chunk bookkeeping BEFORE any status transition.
// Only a fully verified snapshot may become `uploaded`; partial/failed
// snapshots stay unusable (analysis and generation context select `ready`
// snapshots only, which are produced downstream from `uploaded`).

export type SnapshotCompletionCode =
	| "SNAPSHOT_INCOMPLETE"
	| "SNAPSHOT_CONFLICT"
	| "SNAPSHOT_TOO_LARGE";

export class SnapshotCompletionError extends Error {
	readonly code: SnapshotCompletionCode;

	constructor(code: SnapshotCompletionCode, message: string) {
		super(message);
		this.name = "SnapshotCompletionError";
		this.code = code;
	}
}

export interface CompletionManifestEntry {
	path: string;
	size: number;
	hash: string;
}

export interface CompletionChunkInfo {
	path: string;
	chunkIndex: number;
	chunkTotal: number;
	dataBase64Length: number;
	decodedBytes: number;
}

export interface CompletionCheckResult {
	files: Array<{ path: string; chunkTotal: number; totalBytes: number }>;
	contentSize: number;
}

export function checkSnapshotCompletion(input: {
	manifest: readonly CompletionManifestEntry[];
	chunks: readonly CompletionChunkInfo[];
	fileCount: number;
	excludedCount: number;
}): CompletionCheckResult {
	const { manifest, chunks, fileCount } = input;
	// Locked definition: fileCount MUST equal the eligible manifest entries.
	if (fileCount !== manifest.length) {
		throw new SnapshotCompletionError(
			"SNAPSHOT_INCOMPLETE",
			`fileCount ${fileCount} does not match ${manifest.length} manifest entries`,
		);
	}

	const manifestByPath = new Map<string, CompletionManifestEntry>();
	for (const entry of manifest) {
		if (manifestByPath.has(entry.path)) {
			throw new SnapshotCompletionError(
				"SNAPSHOT_CONFLICT",
				"Manifest contains duplicate paths",
			);
		}
		manifestByPath.set(entry.path, entry);
	}
	const chunksByPath = new Map<string, CompletionChunkInfo[]>();
	for (const chunk of chunks) {
		const group = chunksByPath.get(chunk.path) ?? [];
		group.push(chunk);
		chunksByPath.set(chunk.path, group);
	}

	// Orphan chunks (paths absent from the manifest) indicate a desynced
	// client — fail closed rather than silently dropping or adopting them.
	for (const path of chunksByPath.keys()) {
		if (!manifestByPath.has(path)) {
			throw new SnapshotCompletionError(
				"SNAPSHOT_CONFLICT",
				"Uploaded chunks reference a path absent from the manifest",
			);
		}
	}

	const files: CompletionCheckResult["files"] = [];
	let contentSize = 0;
	for (const entry of manifest) {
		if (entry.size > CODEBASE_MAX_FILE_BYTES) {
			throw new SnapshotCompletionError(
				"SNAPSHOT_TOO_LARGE",
				"Manifest entry exceeds the per-file limit",
			);
		}
		const group = chunksByPath.get(entry.path) ?? [];
		const totals = new Set(group.map((chunk) => chunk.chunkTotal));
		if (
			group.length === 0 ||
			totals.size !== 1 ||
			group.length !== (group[0]?.chunkTotal ?? 0)
		) {
			throw new SnapshotCompletionError(
				group.length > 0 && totals.size !== 1
					? "SNAPSHOT_CONFLICT"
					: "SNAPSHOT_INCOMPLETE",
				"Missing or inconsistent chunks for a manifest entry",
			);
		}
		const indexes = new Set(group.map((chunk) => chunk.chunkIndex));
		const total = group[0]?.chunkTotal ?? 0;
		for (let index = 0; index < total; index += 1) {
			if (!indexes.has(index)) {
				throw new SnapshotCompletionError(
					"SNAPSHOT_INCOMPLETE",
					"Missing or inconsistent chunks for a manifest entry",
				);
			}
		}
		const totalBytes = group.reduce(
			(sum, chunk) => sum + chunk.decodedBytes,
			0,
		);
		if (totalBytes > CODEBASE_MAX_FILE_BYTES) {
			throw new SnapshotCompletionError(
				"SNAPSHOT_TOO_LARGE",
				"Uploaded file exceeds the per-file limit",
			);
		}
		if (totalBytes !== entry.size) {
			throw new SnapshotCompletionError(
				"SNAPSHOT_CONFLICT",
				`Uploaded content size (${totalBytes}) does not match manifest entry size (${entry.size})`,
			);
		}
		files.push({ path: entry.path, chunkTotal: total, totalBytes });
		contentSize += totalBytes;
		if (contentSize > CODEBASE_MAX_SNAPSHOT_BYTES) {
			throw new SnapshotCompletionError(
				"SNAPSHOT_TOO_LARGE",
				"Snapshot exceeds the maximum snapshot size",
			);
		}
	}
	return { files, contentSize };
}

// === Fail-closed CLI version gate (Task 5 carry-over) ===
// Task 4 left the minimum-version check client-only. Upload and handshake
// paths now reject unsupported CLIs server-side: the handshake validates the
// reported version, and upload/complete endpoints validate the version stored
// on the session at handshake time. Malformed versions are rejected (never
// treated as new-enough). The CLI treats 426 as non-retryable and surfaces
// the update guidance.

export class CliVersionError extends Error {
	readonly code = "CLI_UPDATE_REQUIRED" as const;

	constructor() {
		super(
			`This CLI version is below the required minimum ${CODEBASE_CLI_MIN_VERSION}. Update with: npm i -g @ghazynabiel/prdfy`,
		);
		this.name = "CliVersionError";
	}
}

export function requireSupportedCliVersion(
	cliVersion: unknown,
	minVersion: string = CODEBASE_CLI_MIN_VERSION,
): void {
	if (
		typeof cliVersion !== "string" ||
		!isSupportedCliVersion(cliVersion, minVersion)
	) {
		throw new CliVersionError();
	}
}

// === Safe sync error messages (Task 5 carry-over) ===
// Analysis writers (Task 6) must store only safe user-facing strings in
// `errorMessage`. As defense-in-depth, the status read boundary passes stored
// messages through this sanitizer: control characters are stripped, length is
// capped, and empty/non-string values collapse to null. Tokens and source
// content must never reach this field.

export function sanitizeSyncErrorMessage(message: unknown): string | null {
	if (typeof message !== "string") return null;
	const stripped = [...message]
		.filter((ch) => {
			const code = ch.codePointAt(0) ?? 0;
			return code >= 0x20 && code !== 0x7f;
		})
		.join("")
		.trim();
	if (!stripped) return null;
	return stripped.length > CODEBASE_MAX_ERROR_MESSAGE_CHARS
		? stripped.slice(0, CODEBASE_MAX_ERROR_MESSAGE_CHARS)
		: stripped;
}
