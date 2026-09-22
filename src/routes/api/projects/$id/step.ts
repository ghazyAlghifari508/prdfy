import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { advanceStep } from "@/lib/flow-progress";
import type { FlowStep } from "@/lib/flow-step";
import { requireUser } from "@/lib/session";

// ponytail: no DB CHECK constraint on projects.step (migration 0000), so valid
// values live here. "question" added so ask-options success can mark a project
// mid-question-stage server-side - drives History visibility without migration.
const ALLOWED_STEPS = new Set(["question", "prd", "ac", "task"]);

export const Route = createFileRoute("/api/projects/$id/step")({
	server: {
		handlers: {
			POST: async ({
				request,
				params,
			}: {
				request: Request;
				params: { id: string };
			}) => {
				const user = await requireUser(request.headers);
				const { id: projectId } = params;
				if (!projectId)
					return Response.json(
						{ error: "Project ID is required" },
						{ status: 400 },
					);

				const body = await request.json().catch(() => null);
				const step = body?.step;
				if (!step || !ALLOWED_STEPS.has(step))
					return Response.json({ error: "Invalid step" }, { status: 400 });

				// ponytail: step is monotonic - this endpoint fires on navigation intent
				// (navbar "Generate AC"), so a user revisiting AC after Task must not
				// rewind step and strand History on the AC page. No-op = still 200.
				// The row lock serializes concurrent writers so two requests
				// reading the same old step cannot overwrite a newer one.
				const result = await db.transaction(async (tx) => {
					const [existing] = await tx
						.select({ step: projects.step })
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
					if (!existing) return null;
					const next = advanceStep(existing.step, step as FlowStep);
					if (!next) return { step: existing.step };
					await tx
						.update(projects)
						.set({ step: next })
						.where(
							and(eq(projects.id, projectId), eq(projects.userId, user.id)),
						);
					return { step: next };
				});
				if (!result)
					return Response.json({ error: "Project not found" }, { status: 404 });
				return Response.json({ success: true, step: result.step });
			},
		},
	},
});
