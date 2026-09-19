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
