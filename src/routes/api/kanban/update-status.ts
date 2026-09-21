import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, projects, tasks } from "@/db/schema";

const VALID_STATUSES = new Set([
	"pending",
	"in_progress",
	"completed",
	"failed",
]);

export const Route = createFileRoute("/api/kanban/update-status")({
	server: {
		handlers: {
			POST: async ({ request }: { request: Request }) => {
				// Dual auth: Bearer API key (CLI /api/v1 consumers) OR session cookie (kanban board drag).
				// Keeps existing key-scope checks for CLI path; board path uses requireUser ownership.
				let actingUserId: string | null = null;
				let keyRecordId: string | null = null;

				const authHeader = request.headers.get("Authorization") ?? "";
				const bearer = authHeader.startsWith("Bearer ")
					? authHeader.slice(7).trim()
					: "";

				if (bearer) {
					const hashedKey = createHash("sha256").update(bearer).digest("hex");
					const [keyRecord] = await db
						.select({
							id: apiKeys.id,
							userId: apiKeys.userId,
							scopes: apiKeys.scopes,
							expiresAt: apiKeys.expiresAt,
						})
						.from(apiKeys)
						.where(eq(apiKeys.key, hashedKey))
						.limit(1);
					if (!keyRecord)
						return Response.json({ error: "Invalid API Key" }, { status: 401 });
					if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date())
						return Response.json({ error: "API Key expired" }, { status: 401 });
					const scopes = keyRecord.scopes ?? [];
					if (
						!scopes.includes("write:task:status") &&
						!scopes.includes("admin") &&
						!scopes.includes("*")
					) {
						return Response.json(
							{ error: "Insufficient scopes for this action" },
							{ status: 403 },
						);
					}
					actingUserId = keyRecord.userId;
					keyRecordId = keyRecord.id;
				} else {
					try {
						const { requireUser } = await import("@/lib/session");
						const sessionUser = await requireUser(request.headers);
						actingUserId = sessionUser.id;
					} catch {
						return Response.json({ error: "Unauthorized" }, { status: 401 });
					}
				}

				const body = await request.json().catch(() => null);
				if (!body || typeof body !== "object" || Array.isArray(body))
					return Response.json({ error: "Invalid JSON body" }, { status: 400 });

				const { projectId, taskId, status } = body as {
					projectId?: unknown;
					taskId?: unknown;
					status?: unknown;
				};
				// Shape + bounds before any DB predicate: arrays, primitives,
				// and oversized strings must never reach the query layer.
				const isIdLike = (v: unknown): v is string =>
					typeof v === "string" && v.length > 0 && v.length <= 128;
				if (!isIdLike(projectId) || !isIdLike(taskId) || typeof status !== "string")
					return Response.json(
						{ error: "Missing required fields (projectId, taskId, status)" },
						{ status: 400 },
					);
				if (!VALID_STATUSES.has(status))
					return Response.json(
						{ error: "Invalid status value" },
						{ status: 400 },
					);

			// Ownership check and status write run in one transaction on
			// the locked project row so the authorization cannot go stale
			// between the check and the update.
			const updated = await db.transaction(async (tx) => {
				const [project] = await tx
					.select({ id: projects.id })
					.from(projects)
					.where(
						and(eq(projects.id, projectId), eq(projects.userId, actingUserId!)),
					)
					.limit(1)
					.for("update");
				if (!project) return [];

				// Re-bind the task inside the transaction: the project lock
				// above cannot stop a concurrent move of the task row itself
				// to another project between the check and this write.
				const [bound] = await tx
					.select({ id: tasks.id, projectId: tasks.projectId })
					.from(tasks)
					.where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
					.limit(1)
					.for("update");
				if (!bound) return [];

				// Lifecycle timestamps are rebuilt per target state so a
				// backwards transition never leaves contradictory values
				// (e.g. completedAt set while status is in_progress).
				const updateData: Record<string, unknown> = {
					status,
					updatedAt: new Date(),
					startedAt: status === "pending" ? null : undefined,
					completedAt:
						status === "completed" || status === "failed"
							? new Date()
							: null,
				};
				if (status === "in_progress") updateData.startedAt = new Date();
				return tx
					.update(tasks)
					.set(updateData)
					.where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
					.returning({
						id: tasks.id,
						status: tasks.status,
						updatedAt: tasks.updatedAt,
						startedAt: tasks.startedAt,
						completedAt: tasks.completedAt,
					});
			});
			if (!updated.length)
				return Response.json(
					{ error: "task not found in this project" },
					{ status: 404 },
				);

				if (keyRecordId) {
					db.update(apiKeys)
						.set({ lastUsedAt: new Date() })
						.where(eq(apiKeys.id, keyRecordId))
						.catch(() => {});
				}
				// Return updated task JSON for optimistic setQueryData on the kanban board.
				return Response.json({
					success: true,
					taskId: updated[0].id,
					status: updated[0].status,
					projectId,
					task: updated[0],
				});
			},
		},
	},
});
