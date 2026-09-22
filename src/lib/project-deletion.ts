/**
 * Project deletion semantics.
 *
 * Two concerns are separated deliberately:
 *
 * 1. USER-FACING deletion: the project disappears from the user's workspace.
 *    Every product artifact (PRD, AC, tasks, conversations, existing-codebase
 *    snapshots/analysis) is destroyed, because those are the user's content.
 *
 * 2. ACCOUNTING/AUDIT retention: `credit_operations` and the append-only
 *    `credit_ledger_entries` record what was charged. The ledger is protected
 *    by a database trigger and `credit_ledger_entries` references
 *    `credit_operations`, which in turn references `projects`. Destroying the
 *    project row would therefore require destroying accounting history.
 *
 * The project row is kept as a tombstone (`deleted_at`) so accounting stays
 * internally valid, and every read path treats a tombstoned project as absent.
 */

/** Stable machine-readable codes returned by the delete endpoint. */
export type ProjectDeleteErrorCode =
	| "PROJECT_NOT_FOUND"
	| "PROJECT_DELETE_FAILED";

export interface ProjectDeleteErrorBody {
	error: string;
	code: ProjectDeleteErrorCode;
}

/** Response body for a successful (or already-completed) deletion. */
export interface ProjectDeleteSuccessBody {
	success: true;
	/** True when this request performed the deletion; false when already deleted. */
	deleted: boolean;
}

/**
 * Whether a project row counts as visible. A tombstoned row is invisible to
 * every user-facing surface: History, project routes, CLI, and public APIs.
 */
export function isProjectActive(
	project: { deletedAt?: Date | string | null } | null | undefined,
): boolean {
	if (!project) return false;
	return !project.deletedAt;
}

/** Timestamp to write for a tombstone. Kept explicit so tests can pin it. */
export function deletionTimestamp(now: Date = new Date()): Date {
	return now;
}
