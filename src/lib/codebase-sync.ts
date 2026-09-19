import { z } from "zod";
import { CODEBASE_CLI_MIN_VERSION, CODEBASE_MAX_FILE_BYTES } from "./constants";

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
// retry creates a new session/attempt instead of mutating a terminal record.

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
	analyzing: ["ready", "failed", "expired"],
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
	analysisId: z.string().min(1).nullable().optional(),
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

// One usable credential per project: a create/retry request is honored only
// when no usable session remains. Terminal or expired rows never block a
// retry — the retry mints a new session instead of mutating them.
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

// Locked CLI invocation. The raw credential travels in `SyncPromptPayload`
// (`syncToken` field, exposed once); the command embeds only a placeholder so
// the credential never appears in a copyable string by accident.
export function buildSyncCommand(projectId: string): string {
	return `prdfy codebase sync --project-id ${projectId} --sync-token <token>`;
}
