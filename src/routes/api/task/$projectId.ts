import { createFileRoute } from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { getTaskTree } from "@/lib/services/task-service";
import { requireUser } from "@/lib/session";

export const Route = createFileRoute("/api/task/$projectId")({
	server: {
		handlers: {
			GET: async ({ params }: { params: { projectId: string } }) => {
				const user = await requireUser(getRequestHeaders());
				const { projectId } = params;
				if (!projectId)
					return Response.json(
						{ error: "Project ID required" },
						{ status: 400 },
					);

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

				const taskTree = await getTaskTree(projectId);
				return Response.json({ taskTree: taskTree ?? { features: [] } });
			},
		},
	},
});
