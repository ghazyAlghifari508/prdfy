/**
 * Task tree types + JSON parsing + DB ops.
 *
 * Schema fork: old normalized `features`/`tasks`/`subtasks` tables collapsed
 * into flat `tasks` (project_id, title, description, subtasks jsonb, order).
 * The TaskTree shape (features→tasks→subtasks) is reconstructed from rows:
 * each feature = grouping by convention; here we store one task row per feature
 * with its subtasks as jsonb, since the flat schema has no feature grouping.
 *
 * ponytail: single-row-per-feature is a lossy mapping of the old 3-table model.
 * If feature-level grouping matters, add a `feature` text col to tasks and
 * group by it on read. Sufficient for export (JSON) today.
 */
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { acVersions, projects, tasks } from "@/db/schema";
import { advanceStep } from "@/lib/flow-progress";

export interface TaskTree {
	features: Array<{
		name: string;
		tasks: Array<{
			name: string;
			description: string;
			subtasks: Array<{ name: string; description: string; details: string[] }>;
		}>;
	}>;
}

const MAX_TASK_NAME_CHARS = 500;
const MAX_TASK_DESC_CHARS = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, max: number): value is string {
	return typeof value === "string" && !!value.trim() && value.length <= max;
}

export function parseTaskJson(jsonString: string): TaskTree | null {
	try {
		const parsed: unknown = JSON.parse(jsonString);
		if (!isRecord(parsed)) return null;
		const { features } = parsed;
		if (!Array.isArray(features) || features.length === 0) return null;
		// Rebuild a validated tree instead of trusting + casting the raw
		// payload: every persisted string field is verified here.
		const out: TaskTree = { features: [] };
		for (const feature of features) {
			if (!isRecord(feature)) return null;
			if (!isNonEmptyString(feature.name, MAX_TASK_NAME_CHARS)) return null;
			if (!Array.isArray(feature.tasks)) return null;
			const outFeature: TaskTree["features"][number] = {
				name: feature.name.trim(),
				tasks: [],
			};
			for (const task of feature.tasks) {
				if (!isRecord(task)) return null;
				if (!isNonEmptyString(task.name, MAX_TASK_NAME_CHARS)) return null;
				if (
					task.description !== undefined &&
					(typeof task.description !== "string" ||
						task.description.length > MAX_TASK_DESC_CHARS)
				)
					return null;
				if (!Array.isArray(task.subtasks)) return null;
				const outTask: TaskTree["features"][number]["tasks"][number] = {
					name: task.name.trim(),
					description:
						typeof task.description === "string" ? task.description : "",
					subtasks: [],
				};
				for (const subtask of task.subtasks) {
					if (!isRecord(subtask)) return null;
					if (!isNonEmptyString(subtask.name, MAX_TASK_NAME_CHARS)) return null;
					if (
						subtask.description !== undefined &&
						(typeof subtask.description !== "string" ||
							subtask.description.length > MAX_TASK_DESC_CHARS)
					)
						return null;
					const details = subtask.details === undefined ? [] : subtask.details;
					if (
						!Array.isArray(details) ||
						!details.every(
							(d): d is string =>
								typeof d === "string" && d.length <= MAX_TASK_DESC_CHARS,
						)
					)
						return null;
					outTask.subtasks.push({
						name: subtask.name.trim(),
						description:
							typeof subtask.description === "string"
								? subtask.description
								: "",
						details: [...details],
					});
				}
				outFeature.tasks.push(outTask);
			}
			out.features.push(outFeature);
		}
		return out;
	} catch {
		return null;
	}
}

/**
 * Save task tree. One `tasks` row per task (not per feature).
 * featureName preserves feature grouping. Each subtask gets status: "pending".
 */
export async function saveTaskTree(
	projectId: string,
	taskTree: TaskTree,
): Promise<
	| { success: true; artifactId: string; taskCount: number }
	| { success: false; error: string }
> {
	try {
		const artifactId = crypto.randomUUID();
		// Build all rows first, then one bulk insert: per-task round trips
		// held the transaction (and its locks) open for large trees.
		let order = 0;
		const rows = taskTree.features.flatMap((feature) =>
			feature.tasks.map((task) => ({
				id: crypto.randomUUID(),
				projectId,
				title: task.name,
				description: task.description || null,
				featureName: feature.name,
				status: "pending",
				subtasks: task.subtasks.map((s) => ({
					name: s.name,
					description: s.description,
					details: s.details ?? [],
					status: "pending" as const,
				})),
				order: order++,
			})),
		);
		const totalTasks = rows.length;
		await db.transaction(async (tx) => {
			await tx.delete(tasks).where(eq(tasks.projectId, projectId));
			if (rows.length > 0) await tx.insert(tasks).values(rows);

			// Row lock serializes concurrent savers so a stale step read
			// can never rewind a newer value (mirrors saveAcVersion).
			const [proj] = await tx
				.select({ step: projects.step })
				.from(projects)
				.where(eq(projects.id, projectId))
				.for("update")
				.limit(1);
			const updateData: Record<string, unknown> = {
				taskStatus: "completed",
				updatedAt: new Date(),
			};
			const next = advanceStep(proj?.step, "task");
			if (next) updateData.step = next;
			await tx
				.update(projects)
				.set(updateData)
				.where(eq(projects.id, projectId));
		});
		return { success: true, artifactId, taskCount: totalTasks };
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error("saveTaskTree error:", msg);
		return { success: false, error: msg };
	}
}

/**
 * Fetch task tree. DB rows are one-per-task with featureName for grouping.
 * Reconstruct features → tasks → subtasks from the flat rows.
 */
export async function getTaskTree(projectId: string): Promise<TaskTree | null> {
	try {
		const rows = await db
			.select({
				title: tasks.title,
				description: tasks.description,
				featureName: tasks.featureName,
				subtasks: tasks.subtasks,
			})
			.from(tasks)
			.where(eq(tasks.projectId, projectId))
			.orderBy(asc(tasks.order));

		if (rows.length === 0) return null;

		const featureMap = new Map<string, TaskTree["features"][number]>();
		for (const row of rows) {
			const fname =
				typeof row.featureName === "string" && row.featureName
					? row.featureName
					: "Umum";
			const feature =
				featureMap.get(fname) ??
				(() => {
					const f = {
						name: fname,
						tasks: [] as TaskTree["features"][number]["tasks"],
					};
					featureMap.set(fname, f);
					return f;
				})();

			// Same normalization as getKanbanData: drop malformed subtask
			// entries instead of trusting jsonb casts.
			const subtasks = (Array.isArray(row.subtasks) ? row.subtasks : [])
				.filter(
					(s): s is Record<string, unknown> =>
						s !== null &&
						typeof s === "object" &&
						typeof (s as Record<string, unknown>).name === "string",
				)
				.map((s) => ({
					name: s.name as string,
					description: typeof s.description === "string" ? s.description : "",
					details: Array.isArray(s.details)
						? s.details.filter((d): d is string => typeof d === "string")
						: [],
				}));

			// ponytail: feature guaranteed present via lazy-init above; push onto it
			feature.tasks.push({
				name: row.title,
				description: row.description || "",
				subtasks,
			});
		}

		return { features: Array.from(featureMap.values()) };
	} catch (error) {
		console.error("getTaskTree error:", error);
		throw error;
	}
}

/**
 * Kanban board data — shared between polling GET (`/api/kanban/$pid`)
 * and SSE push (`/api/kanban/stream`). Single DB source so both transports
 * stay in sync. Returns the same shape the hook expects.
 */
export async function getKanbanData(projectId: string): Promise<{
	columns: Record<
		string,
		Array<{
			id: string;
			type: "task";
			featureName: string;
			name: string;
			description: string;
			status: "pending" | "in_progress" | "completed" | "failed";
			subtaskCount: number;
			subtaskCompleted: number;
			dependencies: string[];
			startedAt: string | null;
			completedAt: string | null;
			subtasks: Array<{ name: string; status: string }>;
		}>
	>;
	staleness: "live";
	lastUpdateAt: string;
	acChanged: boolean;
	taskStatus: string | null;
}> {
	const [project] = await db
		.select({ taskStatus: projects.taskStatus })
		.from(projects)
		.where(eq(projects.id, projectId))
		.limit(1);

	const taskRows = await db
		.select({
			id: tasks.id,
			title: tasks.title,
			description: tasks.description,
			status: tasks.status,
			priority: tasks.priority,
			featureName: tasks.featureName,
			dependencies: tasks.dependencies,
			subtasks: tasks.subtasks,
			startedAt: tasks.startedAt,
			completedAt: tasks.completedAt,
			createdAt: tasks.createdAt,
		})
		.from(tasks)
		.where(eq(tasks.projectId, projectId))
		.orderBy(asc(tasks.order));

	// acChanged: whether an AC version is newer than the oldest task creation.
	// Mirrors /api/v1/projects/$id/kanban.ts logic; polling route currently
	// returned false statically but SSE deserves the real signal.
	const [acRow] = await db
		.select({ createdAt: acVersions.createdAt })
		.from(acVersions)
		.where(eq(acVersions.projectId, projectId))
		.orderBy(desc(acVersions.version))
		.limit(1);

	const columns: Record<
		string,
		Array<{
			id: string;
			type: "task";
			featureName: string;
			name: string;
			description: string;
			status: "pending" | "in_progress" | "completed" | "failed";
			priority?: string | null;
			subtaskCount: number;
			subtaskCompleted: number;
			dependencies: string[];
			startedAt: string | null;
			completedAt: string | null;
			subtasks: Array<{ name: string; status: string }>;
		}>
	> = {
		pending: [],
		in_progress: [],
		completed: [],
		failed: [],
	};

	const VALID_CARD_STATUSES = new Set([
		"pending",
		"in_progress",
		"completed",
		"failed",
	] as const);
	type CardStatus = "pending" | "in_progress" | "completed" | "failed";
	const toIso = (d: unknown): string | null => {
		if (!d) return null;
		if (d instanceof Date)
			return Number.isFinite(d.getTime()) ? d.toISOString() : null;
		const parsed = new Date(d as string);
		return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
	};

	for (const t of taskRows) {
		// Normalize DB values into the declared card shape instead of
		// casting: invalid statuses fall back to pending, malformed subtask
		// entries are dropped, non-string dependencies are filtered out.
		const sub = Array.isArray(t.subtasks) ? t.subtasks : [];
		const validSubs = sub.filter(
			(s): s is Record<string, unknown> =>
				s !== null &&
				typeof s === "object" &&
				typeof (s as Record<string, unknown>).name === "string",
		);
		const rawStatus = t.status ?? "pending";
		const status: CardStatus = VALID_CARD_STATUSES.has(rawStatus as CardStatus)
			? (rawStatus as CardStatus)
			: "pending";
		const card = {
			id: t.id,
			type: "task" as const,
			featureName: t.featureName || "Umum",
			name: t.title,
			description: t.description ?? "",
			status,
			priority: t.priority ?? "medium",
			subtaskCount: validSubs.length,
			subtaskCompleted: validSubs.filter((s) => s.status === "completed")
				.length,
			dependencies: Array.isArray(t.dependencies)
				? t.dependencies.filter((d): d is string => typeof d === "string")
				: [],
			startedAt: toIso(t.startedAt),
			completedAt: toIso(t.completedAt),
			subtasks: validSubs.map((s) => ({
				name: s.name as string,
				status:
					typeof s.status === "string" &&
					VALID_CARD_STATUSES.has(s.status as CardStatus)
						? (s.status as string)
						: "pending",
			})),
		};
		(columns[card.status] ?? columns.pending).push(card);
	}

	const latestAcAt = acRow?.createdAt ?? null;
	// Minimum creation timestamp across rows — display order is by `order`,
	// so row[0] is not necessarily the oldest task.
	let oldestTaskAt: Date | null = null;
	for (const t of taskRows) {
		if (!t.createdAt) continue;
		const d = t.createdAt instanceof Date ? t.createdAt : new Date(t.createdAt);
		if (!Number.isFinite(d.getTime())) continue;
		if (!oldestTaskAt || d < oldestTaskAt) oldestTaskAt = d;
	}
	const acChanged = Boolean(
		latestAcAt &&
			oldestTaskAt &&
			new Date(latestAcAt).getTime() > oldestTaskAt.getTime(),
	);

	return {
		columns,
		staleness: "live",
		lastUpdateAt: new Date().toISOString(),
		acChanged,
		taskStatus: project?.taskStatus ?? null,
	};
}
