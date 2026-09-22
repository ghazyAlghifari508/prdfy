import { createFileRoute } from "@tanstack/react-router";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import {
	apiKeyAuth,
	hasScope,
	verifyProjectOwnership,
} from "@/lib/api-key-auth";
import {
	extractFeatureSection,
	getLatestAcContent,
} from "@/lib/services/ac-service";
import { storedTaskPriority } from "@/lib/task-priority";

export const Route = createFileRoute("/api/v1/projects/$id/tasks")({
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

				const VALID_TASK_STATUSES = new Set([
					"pending",
					"in_progress",
					"completed",
				]);
				const url = new URL(request.url);
				const statusFilter = url.searchParams.get("status");
				if (statusFilter && !VALID_TASK_STATUSES.has(statusFilter)) {
					return Response.json(
						{
							error: `Invalid status filter. Allowed: ${Array.from(VALID_TASK_STATUSES).join(", ")}`,
						},
						{ status: 400 },
					);
				}

				const toIsoString = (d: unknown): string | null => {
					if (!d) return null;
					if (d instanceof Date) return d.toISOString();
					const parsed = new Date(d as string);
					return Number.isFinite(parsed.getTime())
						? parsed.toISOString()
						: null;
				};

				let rows: Array<{
					id: string;
					title: string;
					description: string | null;
					status: string | null;
					priority: string | null;
					featureName: string | null;
					startedAt: Date | null;
					completedAt: Date | null;
					dependencies: unknown;
					covers: string[] | null;
					surfaces: string[] | null;
					subtasks: unknown;
				}>;
				let acMarkdown: string | null;
				try {
					// Explicit column contract: never serialize whole rows.
					rows = await db
						.select({
							id: tasks.id,
							title: tasks.title,
							description: tasks.description,
							status: tasks.status,
							priority: tasks.priority,
							featureName: tasks.featureName,
							startedAt: tasks.startedAt,
							completedAt: tasks.completedAt,
							dependencies: tasks.dependencies,
							covers: tasks.covers,
							surfaces: tasks.surfaces,
							subtasks: tasks.subtasks,
						})
						.from(tasks)
						.where(
							statusFilter
								? and(
										eq(tasks.projectId, projectId),
										eq(tasks.status, statusFilter),
									)
								: eq(tasks.projectId, projectId),
						)
						.orderBy(asc(tasks.order));
					acMarkdown = await getLatestAcContent(projectId);
				} catch (e) {
					console.error("v1 tasks failed:", e);
					return Response.json(
						{ error: "Failed to load tasks" },
						{ status: 500 },
					);
				}

				return Response.json({
					tasks: rows.map((t) => ({
						id: t.id,
						name: t.title,
						description: t.description,
						status: t.status ?? "pending",
						// Validated level with the documented legacy fallback: rows
						// written before the priority contract read as medium.
						priority: storedTaskPriority(t.priority),
						featureName: t.featureName || "Umum",
						// Requirement ids this task delivers. Legacy rows carry
						// their references in the description only.
						covers: Array.isArray(t.covers)
							? t.covers.filter((c): c is string => typeof c === "string")
							: [],
						// Page/Screen inventory entries this task implements,
						// referencing the PRD's User Flow → Pages & Screens.
						surfaces: Array.isArray(t.surfaces)
							? t.surfaces.filter((s): s is string => typeof s === "string")
							: [],
						acContext: acMarkdown
							? extractFeatureSection(acMarkdown, t.featureName || "Umum")
							: null,
						startedAt: toIsoString(t.startedAt),
						completedAt: toIsoString(t.completedAt),
						dependencies: Array.isArray(t.dependencies)
							? t.dependencies.filter((d): d is string => typeof d === "string")
							: [],
						subtasks: Array.isArray(t.subtasks)
							? (t.subtasks as Array<Record<string, unknown>>).map((s) => ({
									name: s.name,
									description: s.description,
									status: s.status ?? "pending",
									details: s.details ?? [],
								}))
							: [],
					})),
				});
			},
		},
	},
});
