/**
 * Pure utility functions for Kanban board.
 * Extracted for testability - route handlers import these.
 */

export type TaskCardStatus = "pending" | "in_progress" | "completed" | "failed";

export interface TaskCard {
	id: string;
	type: "task" | "subtask";
	parentId?: string;
	featureName: string;
	name: string;
	description: string;
	status: TaskCardStatus;
	subtaskCount?: number;
	subtaskCompleted?: number;
	subtasks?: Array<{ id?: string; name: string; status: string }>;
	dependencies: string[];
	startedAt: string | null;
	completedAt: string | null;
}

/**
 * Group a flat array of TaskCards into columns by status.
 */
export function groupCardsByStatus(
	cards: TaskCard[],
): Record<TaskCardStatus, TaskCard[]> {
	const columns: Record<TaskCardStatus, TaskCard[]> = {
		pending: [],
		in_progress: [],
		completed: [],
		failed: [],
	};

	for (const card of cards) {
		const key = card.status;
		if (columns[key]) {
			columns[key].push(card);
		} else {
			columns.pending.push(card);
		}
	}

	return columns;
}

/**
 * Group cards by feature name within a column.
 */
export function groupCardsByFeature(
	cards: TaskCard[],
): Record<string, TaskCard[]> {
	// Null-prototype map: feature names are data-controlled, so inherited
	// keys such as __proto__ must resolve as own groups, never the prototype.
	const groups: Record<string, TaskCard[]> = Object.create(null);
	for (const card of cards) {
		const name = card.featureName || "Umum";
		if (!groups[name]) groups[name] = [];
		groups[name].push(card);
	}
	return groups;
}

/**
 * Compute task counts per status from a flat list of task cards.
 */
export function computeStatusCounts(
	cards: TaskCard[],
): Record<TaskCardStatus, number> {
	return {
		pending: cards.filter((c) => c.status === "pending").length,
		in_progress: cards.filter((c) => c.status === "in_progress").length,
		completed: cards.filter((c) => c.status === "completed").length,
		failed: cards.filter((c) => c.status === "failed").length,
	};
}

/**
 * Check if AC was updated after task tree generation.
 */
export function detectAcChanged(
	latestAcAt: string | null | undefined,
	tasksCreatedAt: string | null | undefined,
): boolean {
	if (!latestAcAt || !tasksCreatedAt) return false;
	return new Date(latestAcAt) > new Date(tasksCreatedAt);
}

export interface KanbanPhase {
	id: string;
	name: string;
	phaseNumber: number;
	label: string;
}

/**
 * Extract all distinct project phases (feature groups) from columns or flat card list.
 * Preserves initial appearance order and numbers them 1-based (Fase 1, Fase 2, etc.).
 */
export function extractPhases(
	source: Record<string, TaskCard[]> | TaskCard[],
): KanbanPhase[] {
	const allCards = Array.isArray(source)
		? source
		: [
				...(source.pending || []),
				...(source.in_progress || []),
				...(source.completed || []),
				...(source.failed || []),
			];

	const seen = new Set<string>();
	const phases: KanbanPhase[] = [];

	for (const card of allCards) {
		const name = card.featureName?.trim() || "Umum";
		if (!seen.has(name)) {
			seen.add(name);
			const phaseNumber = phases.length + 1;
			phases.push({
				id: name,
				name,
				phaseNumber,
				label: `Fase ${phaseNumber}: ${name}`,
			});
		}
	}

	return phases;
}

/**
 * Filter columns by selected phase id (featureName).
 * If phaseId is null, undefined, or "all", returns all columns unchanged.
 */
export function filterColumnsByPhase(
	columns: Record<TaskCardStatus, TaskCard[]>,
	selectedPhaseId: string | null | undefined,
): Record<TaskCardStatus, TaskCard[]> {
	if (!selectedPhaseId || selectedPhaseId === "all") {
		return columns;
	}

	return {
		pending: columns.pending.filter(
			(c) => (c.featureName?.trim() || "Umum") === selectedPhaseId,
		),
		in_progress: columns.in_progress.filter(
			(c) => (c.featureName?.trim() || "Umum") === selectedPhaseId,
		),
		completed: columns.completed.filter(
			(c) => (c.featureName?.trim() || "Umum") === selectedPhaseId,
		),
		failed: columns.failed.filter(
			(c) => (c.featureName?.trim() || "Umum") === selectedPhaseId,
		),
	};
}

/**
 * Compute progress metrics (total, done, percentage) from columns.
 */
export function computeKanbanProgress(
	columns: Record<TaskCardStatus, TaskCard[]>,
): { total: number; done: number; pct: number } {
	const total =
		(columns.pending?.length || 0) +
		(columns.in_progress?.length || 0) +
		(columns.completed?.length || 0) +
		(columns.failed?.length || 0);
	const done = (columns.completed?.length || 0) + (columns.failed?.length || 0);
	const pct = total > 0 ? Math.round((done / total) * 100) : 0;

	return { total, done, pct };
}
