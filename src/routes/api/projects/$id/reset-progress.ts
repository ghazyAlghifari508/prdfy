import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, isNull } from "drizzle-orm";
// Server-import exception: top-level `@/db` and schema imports are correct here
// — server handler only, no client component (neighboring `/api/projects`
// pattern). Never import this module from client code.
import { db } from "@/db";
import { projects, subscriptions, tasks } from "@/db/schema";
import { checkRateLimit } from "@/lib/rate-limit";
import {
	hasNonPendingSubtask,
	needsProgressReset,
	normalizeSubtasksForReset,
	TASK_STATUS_PENDING,
} from "@/lib/services/task-reset";
import { requireUser } from "@/lib/session";
import type { Plan } from "@/types/database";

export const RESET_PROGRESS_ROUTE_PATH = "/api/projects/$id/reset-progress";

// Same plan resolution as the neighboring codebase routes
// (`src/routes/api/codebase/$projectId/session.ts:42-53`): the rate-limit tier
// comes from the user's own subscription, never a hardcoded default.
async function resolvePlan(userId: string): Promise<Plan> {
	const [sub] = await db
		.select({ plan: subscriptions.plan })
		.from(subscriptions)
		.where(eq(subscriptions.userId, userId))
		.orderBy(desc(subscriptions.createdAt))
		.limit(1);
	const rawPlan = sub?.plan || "free";
	return ["free", "pro", "hengker"].includes(rawPlan)
		? (rawPlan as Plan)
		: "free";
}

export const Route = createFileRoute("/api/projects/$id/reset-progress")({
	server: {
		handlers: {
			// Clears task progress only. The task set, PRD, AC, and the project's
			// stage are untouched: this exists so the same plan can be handed to
			// an agent again without burning a credit on regeneration.
			POST: async ({
				request,
				params,
			}: {
				request: Request;
				params: { id: string };
			}) => {
				let user: { id: string };
				try {
					user = await requireUser(request.headers);
				} catch {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}
				const { id: projectId } = params;

				const plan = await resolvePlan(user.id);
				const rateCheck = await checkRateLimit(user.id, plan, "api_call");
				if (!rateCheck.allowed)
					return Response.json(
						{ error: "Terlalu banyak permintaan", retryAfter: 60 },
						{ status: 429 },
					);

				try {
					const result = await db.transaction(async (tx) => {
						// Ownership is established on the locked project row so a
						// project that disappears or changes hands mid-request can
						// never be reset without revalidation.
						const [project] = await tx
							.select({ id: projects.id })
							.from(projects)
							.where(
								and(
									eq(projects.id, projectId),
									eq(projects.userId, user.id),
									isNull(projects.deletedAt),
								),
							)
							.limit(1)
							.for("update");
						if (!project) return { kind: "not_found" as const };

						// Row lock: concurrent resets serialize here instead of
						// racing on a stale read, and the no-op decision is made
						// on the locked rows.
						const rows = await tx
							.select({
								id: tasks.id,
								status: tasks.status,
								subtasks: tasks.subtasks,
							})
							.from(tasks)
							.where(eq(tasks.projectId, projectId))
							.for("update");

						if (!needsProgressReset(rows)) {
							return { kind: "noop" as const, tasksReset: 0 };
						}

						const now = new Date();
						let tasksReset = 0;
						for (const row of rows) {
							// Change is detected with the raw-value helper:
							// normalizeSubtasksForReset always writes "pending", so
							// inspecting its output could never report a change.
							if (
								row.status === TASK_STATUS_PENDING &&
								!hasNonPendingSubtask(row.subtasks)
							) {
								continue;
							}
							await tx
								.update(tasks)
								.set({
									status: TASK_STATUS_PENDING,
									startedAt: null,
									completedAt: null,
									subtasks: normalizeSubtasksForReset(row.subtasks),
									updatedAt: now,
								})
								.where(
									and(eq(tasks.id, row.id), eq(tasks.projectId, projectId)),
								);
							tasksReset += 1;
						}
						return { kind: "reset" as const, tasksReset };
					});

					if (result.kind === "not_found")
						return Response.json(
							{ error: "Project tidak ditemukan" },
							{ status: 404 },
						);
					if (result.kind === "noop")
						return Response.json({ reset: false, tasksReset: 0 });
					return Response.json({
						reset: true,
						tasksReset: result.tasksReset,
					});
				} catch (e) {
					console.error("reset-progress handler failed:", e);
					return Response.json(
						{ error: "Gagal mereset progress" },
						{ status: 500 },
					);
				}
			},
		},
	},
});
