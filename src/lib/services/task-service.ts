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

export function parseTaskJson(jsonString: string): TaskTree | null {
	try {
		const parsed = JSON.parse(jsonString);
		if (
			!parsed.features ||
			!Array.isArray(parsed.features) ||
			parsed.features.length === 0
		)
			return null;
		for (const feature of parsed.features) {
			if (!feature.name || !Array.isArray(feature.tasks)) return null;
			for (const task of feature.tasks) {
				if (!task.name || !Array.isArray(task.subtasks)) return null;
				for (const subtask of task.subtasks) {
					if (!subtask.name) return null;
					if (subtask.details !== undefined && !Array.isArray(subtask.details))
						return null;
					subtask.details = Array.isArray(subtask.details)
						? subtask.details
						: [];
				}
			}
		}
		return parsed as TaskTree;
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
		let totalTasks = 0;
		await db.transaction(async (tx) => {
			await tx.delete(tasks).where(eq(tasks.projectId, projectId));

			let order = 0;
			for (const feature of taskTree.features) {
				for (const task of feature.tasks) {
					totalTasks++;
					const subtaskRows = task.subtasks.map((s) => ({
						name: s.name,
						description: s.description,
						details: s.details ?? [],
						status: "pending" as const,
					}));
					await tx.insert(tasks).values({
						id: crypto.randomUUID(),
						projectId,
						title: task.name,
						description: task.description || null,
						featureName: feature.name,
						status: "pending",
						subtasks: subtaskRows,
						order: order++,
					});
				}
			}

			const [proj] = await tx
				.select({ step: projects.step })
				.from(projects)
				.where(eq(projects.id, projectId))
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
			const fname = row.featureName || "Umum";
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

			const subtasks = Array.isArray(row.subtasks)
				? (
						row.subtasks as Array<{
							name: string;
							description: string;
							details?: string[];
							status?: string;
						}>
					).map((s) => ({
						name: s.name,
						description: s.description || "",
						details: s.details ?? [],
					}))
				: [];

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

	for (const t of taskRows) {
		const sub = Array.isArray(t.subtasks)
			? (t.subtasks as Array<Record<string, unknown>>)
			: [];
		const card = {
			id: t.id,
			type: "task" as const,
			featureName: t.featureName || "Umum",
			name: t.title,
			description: t.description ?? "",
			status: (t.status ?? "pending") as
				| "pending"
				| "in_progress"
				| "completed"
				| "failed",
			subtaskCount: sub.length,
			subtaskCompleted: sub.filter((s) => s.status === "completed").length,
			dependencies: Array.isArray(t.dependencies)
				? (t.dependencies as string[])
				: [],
			startedAt: t.startedAt ? (t.startedAt as Date).toISOString() : null,
			completedAt: t.completedAt ? (t.completedAt as Date).toISOString() : null,
			subtasks: sub.map((s) => ({
				name: s.name as string,
				status: (s.status as string) ?? "pending",
			})),
		};
		(columns[card.status] ?? columns.pending).push(card);
	}

	const latestAcAt = acRow?.createdAt ?? null;
	const tasksCreatedAt = taskRows[0]?.createdAt ?? null;
	const acChanged = Boolean(
		latestAcAt &&
			tasksCreatedAt &&
			new Date(latestAcAt as Date) > new Date(tasksCreatedAt as Date),
	);

	return {
		columns,
		staleness: "live",
		lastUpdateAt: new Date().toISOString(),
		acChanged,
		taskStatus: project?.taskStatus ?? null,
	};
}
