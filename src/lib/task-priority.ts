/**
 * Task priority domain values.
 *
 * Priority is a product-impact classification produced by Task generation and
 * persisted per task. The stored value is a machine-readable level; the
 * user-facing Indonesian label (Utama/Penting/Pendukung) is a presentation
 * concern owned by `kanban-utils`.
 *
 * Kept dependency-free so the parser, the persistence layer, the REST API, and
 * the Kanban mapper all validate against one list instead of re-declaring it.
 */

export type TaskPriority = "high" | "medium" | "low";

/** Allowed values, most important first. */
export const TASK_PRIORITIES: readonly TaskPriority[] = [
	"high",
	"medium",
	"low",
];

/**
 * Legacy fallback. Rows persisted before priority was part of the generation
 * contract carry the column default, and old trees have no value at all — both
 * read as `medium` so historical projects stay valid. New generations must
 * carry an explicit, validated level instead of relying on this.
 */
export const DEFAULT_TASK_PRIORITY: TaskPriority = "medium";

/**
 * Normalize a model- or database-supplied priority.
 *
 * Casing and surrounding whitespace are tolerated because models routinely
 * vary them; anything else is not a known level and yields `null` so callers
 * can reject it instead of silently accepting an arbitrary string.
 */
export function normalizeTaskPriority(value: unknown): TaskPriority | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase();
	return (TASK_PRIORITIES as readonly string[]).includes(normalized)
		? (normalized as TaskPriority)
		: null;
}

/**
 * Priority as read from storage. Legacy rows (null) and values written outside
 * the contract fall back to the documented default rather than leaking an
 * unknown level into the API or the board.
 */
export function storedTaskPriority(value: unknown): TaskPriority {
	return normalizeTaskPriority(value) ?? DEFAULT_TASK_PRIORITY;
}
