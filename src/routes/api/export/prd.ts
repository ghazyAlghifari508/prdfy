import { createFileRoute } from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { getLatestAcMarkdown } from "@/lib/services/ac-service";
import {
	formatAcMarkdown,
	formatPrdMarkdown,
	formatTasksJson,
} from "@/lib/services/export-service";
import { getLatestPrdContent } from "@/lib/services/prd-service";
import { getTaskTree } from "@/lib/services/task-service";
import { requireUser } from "@/lib/session";

export const Route = createFileRoute("/api/export/prd")({
	server: {
		handlers: {
			POST: async ({ request }: { request: Request }) => {
				const user = await requireUser(getRequestHeaders());
				const { projectId } = await request.json();
				if (!projectId)
					return Response.json(
						{ error: "Project ID required" },
						{ status: 400 },
					);

				const [project] = await db
					.select({ id: projects.id, name: projects.name })
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

				const [prdContent, acContent, taskTree] = await Promise.all([
					getLatestPrdContent(projectId),
					getLatestAcMarkdown(projectId),
					getTaskTree(projectId),
				]);

				return Response.json({
					projectName: project.name,
					prd: prdContent ? formatPrdMarkdown(prdContent) : null,
					ac: acContent ? formatAcMarkdown(acContent) : null,
					tasks: formatTasksJson(taskTree),
				});
			},
		},
	},
});
