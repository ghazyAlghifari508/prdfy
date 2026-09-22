import { createFileRoute } from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { requireUser } from "@/lib/session";

export const Route = createFileRoute("/api/kanban/$pid")({
	server: {
		handlers: {
			GET: async ({ params }: { params: { pid: string } }) => {
				const user = await requireUser(getRequestHeaders());
				const { pid: projectId } = params;

				// App-level ownership check before delegating to shared helper.
				const [project] = await db
					.select({ id: projects.id })
					.from(projects)
					.where(
						and(
							eq(projects.id, projectId),
							eq(projects.userId, user.id),
							isNull(projects.deletedAt),
						),
					)
					.limit(1);
				if (!project)
					return Response.json({ error: "Project not found" }, { status: 404 });

				const { getKanbanData } = await import("@/lib/services/task-service");
				const data = await getKanbanData(projectId);
				return Response.json(data);
			},
		},
	},
});
