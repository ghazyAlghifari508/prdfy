// Task-progress reset (status only). No regeneration, no credit burn: the task
// set the user already approved is preserved and only its progress is cleared.

export const TASK_STATUS_PENDING = "pending" as const;

export interface ResetableSubtask {
	name: string;
	status: string;
	[key: string]: unknown;
}

function isWellFormedSubtask(entry: unknown): entry is Record<string, unknown> {
	return (
		entry !== null &&
		typeof entry === "object" &&
		!Array.isArray(entry) &&
		typeof (entry as Record<string, unknown>).name === "string"
	);
}

/**
 * Rebuild a subtask array for reset: every element must be an object carrying a
 * string `name`, its other own fields are preserved verbatim, and `status` is
 * forced to "pending". Malformed elements are dropped rather than trusted —
 * the same structural filter `getTaskTree` and `getKanbanData` already apply.
 */
export function normalizeSubtasksForReset(raw: unknown): ResetableSubtask[] {
	if (!Array.isArray(raw)) return [];
	const out: ResetableSubtask[] = [];
	for (const entry of raw) {
		if (!isWellFormedSubtask(entry)) continue;
		out.push({
			...entry,
			name: entry.name as string,
			status: TASK_STATUS_PENDING,
		});
	}
	return out;
}

/**
 * Whether the RAW subtask value holds work that is not pending. This reads the
 * input, never `normalizeSubtasksForReset`'s output: normalization always writes
 * "pending", so inspecting its result could never report a change. A well-formed
 * entry with a missing status counts as non-pending — it is not a value this
 * codebase writes, so it is treated as needing a reset rather than trusted.
 */
export function hasNonPendingSubtask(raw: unknown): boolean {
	if (!Array.isArray(raw)) return false;
	return raw.some(
		(entry) =>
			isWellFormedSubtask(entry) &&
			(entry as Record<string, unknown>).status !== TASK_STATUS_PENDING,
	);
}

/**
 * Whether a reset would change anything. Drives both the endpoint's no-op
 * response and the UI's disabled state, so the user is never told a reset
 * happened when nothing was reset.
 */
export function needsProgressReset(
	tasks: readonly { status: string | null; subtasks: unknown }[],
): boolean {
	return tasks.some(
		(task) =>
			task.status !== TASK_STATUS_PENDING ||
			hasNonPendingSubtask(task.subtasks),
	);
}
