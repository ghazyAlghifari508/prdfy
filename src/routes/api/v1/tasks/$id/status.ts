import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import {
	apiKeyAuth,
	hasScope,
	verifyProjectOwnership,
} from "@/lib/api-key-auth";

const VALID_STATUSES = ["pending", "in_progress", "completed", "failed"];

export const Route = createFileRoute("/api/v1/tasks/$id/status")({
	server: {
		handlers: {
			POST: async ({
				params,
				request,
			}: {
				params: { id: string };
				request: Request;
			}) => {
				const auth = await apiKeyAuth(request);
				if ("error" in auth)
					return Response.json({ error: auth.error }, { status: auth.status });
				if (!hasScope(auth, "write:task:status"))
					return Response.json(
						{ error: "Insufficient scopes" },
						{ status: 403 },
					);

				const { id: taskId } = params;
				let body: Record<string, unknown>;
				try {
					body = await request.json();
				} catch {
					return Response.json({ error: "Invalid JSON body" }, { status: 400 });
				}
				const { status } = body as { status?: string };
				if (!status || !VALID_STATUSES.includes(status))
					return Response.json(
						{
							error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
						},
						{ status: 400 },
					);

			// The ownership check, workflow check, and write run in one
			// transaction on the locked task row so concurrent writers
			// serialize instead of racing on stale reads.
			const result = await db.transaction(async (tx) => {
				const [task] = await tx
					.select({
						id: tasks.id,
						projectId: tasks.projectId,
						status: tasks.status,
					})
					.from(tasks)
					.where(eq(tasks.id, taskId))
					.limit(1)
					.for("update");
				if (
					!task ||
					!(await verifyProjectOwnership(auth.userId, task.projectId))
				)
					return null;

				// Enforce workflow: task must be in_progress before completed.
				// Prevents AI agents from skipping straight to completed.
				if (status === "completed" && task.status === "pending") {
					return { workflowError: true as const };
				}

				const updateData: Record<string, unknown> = {
					status,
					updatedAt: new Date(),
				};
				if (status === "in_progress") updateData.startedAt = new Date();
				if (status === "completed" || status === "failed")
					updateData.completedAt = new Date();

				await tx.update(tasks).set(updateData).where(eq(tasks.id, taskId));
				return { workflowError: false as const };
			});
			if (!result)
				return Response.json({ error: "Task not found" }, { status: 404 });
			if (result.workflowError) {
				return Response.json(
					{
						error:
							"Task harus in_progress dulu sebelum completed. Jalankan: prdfy task update <id> --status in_progress",
					},
					{ status: 400 },
				);
			}
			return Response.json({
				id: taskId,
				status,
				updatedAt: new Date().toISOString(),
			});
			},
		},
	},
});
