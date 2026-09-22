import { createFileRoute } from "@tanstack/react-router";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { acVersions, tasks } from "@/db/schema";
import {
	apiKeyAuth,
	hasScope,
	verifyProjectOwnership,
} from "@/lib/api-key-auth";

interface TaskCard {
	id: string;
	type: "task";
	featureName: string;
	name: string;
	description: string | null;
	status: "pending" | "in_progress" | "completed" | "failed";
	priority?: string | null;
	subtaskCount: number;
	subtaskCompleted: number;
	dependencies: string[];
	startedAt: string | null;
	completedAt: string | null;
	subtasks: Array<{ name: string; status: string }>;
}

export const Route = createFileRoute("/api/v1/projects/$id/kanban")({
	server: {
		handlers: {
			GET: async ({
				params,
				request,
			}: {
				params: { id: string };
				request: Request;
			}) => {
				const auth = await apiKeyAuth(request);
				if ("error" in auth)
					return Response.json({ error: auth.error }, { status: auth.status });
				if (!hasScope(auth, "read:project"))
					return Response.json(
						{ error: "Insufficient scopes" },
						{ status: 403 },
					);

				const { id: projectId } = params;
				if (!(await verifyProjectOwnership(auth.userId, projectId)))
					return Response.json({ error: "Project not found" }, { status: 404 });

				let taskRows: Array<{
					id: string;
					title: string;
					description: string | null;
					status: string | null;
					priority: string | null;
					featureName: string | null;
					subtasks: unknown;
					dependencies: unknown;
					startedAt: Date | null;
					completedAt: Date | null;
					createdAt: Date | null;
				}>;
				let acRows: Array<{ createdAt: Date | null }>;
				try {
					[taskRows, acRows] = await Promise.all([
						// Explicit column contract: never serialize whole rows —
						// future internal columns must not leak into the API.
						db
							.select({
								id: tasks.id,
								title: tasks.title,
								description: tasks.description,
								status: tasks.status,
								priority: tasks.priority,
								featureName: tasks.featureName,
								subtasks: tasks.subtasks,
								dependencies: tasks.dependencies,
								startedAt: tasks.startedAt,
								completedAt: tasks.completedAt,
								createdAt: tasks.createdAt,
							})
							.from(tasks)
							.where(eq(tasks.projectId, projectId))
							.orderBy(asc(tasks.order)),
						db
							.select({ createdAt: acVersions.createdAt })
							.from(acVersions)
							.where(eq(acVersions.projectId, projectId))
							.orderBy(desc(acVersions.version))
							.limit(1),
					]);
				} catch (e) {
					console.error("v1 kanban failed:", e);
					return Response.json(
						{ error: "Failed to load kanban" },
						{ status: 500 },
					);
				}

				const columns: Record<string, TaskCard[]> = {
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
				]);

				const toIso = (d: unknown): string | null => {
					if (!d) return null;
					if (d instanceof Date) return d.toISOString();
					const parsed = new Date(d as string);
					return Number.isFinite(parsed.getTime())
						? parsed.toISOString()
						: null;
				};

				for (const t of taskRows) {
					const sub = Array.isArray(t.subtasks)
						? t.subtasks.filter(
								(s): s is Record<string, unknown> =>
									s !== null &&
									typeof s === "object" &&
									typeof (s as Record<string, unknown>).name === "string",
							)
						: [];
					const rawStatus = t.status ?? "pending";
					const status: TaskCard["status"] = VALID_CARD_STATUSES.has(rawStatus)
						? (rawStatus as TaskCard["status"])
						: "pending";

					const card: TaskCard = {
						id: t.id,
						type: "task",
						featureName: t.featureName || "Umum",
						name: t.title,
						description: t.description,
						status,
						priority: t.priority ?? "medium",
						subtaskCount: sub.length,
						subtaskCompleted: sub.filter((s) => s.status === "completed")
							.length,
						dependencies: Array.isArray(t.dependencies)
							? t.dependencies.filter((d): d is string => typeof d === "string")
							: [],
						startedAt: toIso(t.startedAt),
						completedAt: toIso(t.completedAt),
						subtasks: sub.map((s) => ({
							name: s.name as string,
							status: (s.status as string) ?? "pending",
						})),
					};
					(columns[card.status] ?? columns.pending).push(card);
				}

				const latestAcAt = acRows[0]?.createdAt ?? null;
				const tasksGeneratedAt = taskRows.reduce<Date | null>((max, t) => {
					if (!t.createdAt) return max;
					const d =
						t.createdAt instanceof Date
							? t.createdAt
							: new Date(t.createdAt as string);
					if (!Number.isFinite(d.getTime())) return max;
					return !max || d > max ? d : max;
				}, null);
				const acChanged = Boolean(
					latestAcAt &&
						tasksGeneratedAt &&
						new Date(latestAcAt) > new Date(tasksGeneratedAt),
				);

				return Response.json({
					columns,
					staleness: "live",
					lastUpdateAt: new Date().toISOString(),
					acChanged,
				});
			},
		},
	},
});
