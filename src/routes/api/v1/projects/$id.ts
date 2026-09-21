import { createFileRoute } from "@tanstack/react-router";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { prdVersions, projects, tasks } from "@/db/schema";
import {
	apiKeyAuth,
	hasScope,
	verifyProjectOwnership,
} from "@/lib/api-key-auth";
import { getLatestPrdContent } from "@/lib/services/prd-service";

export const Route = createFileRoute("/api/v1/projects/$id")({
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

				try {
					const [project, prdContent, taskRows, prdVer] = await Promise.all([
						db
							.select({
								id: projects.id,
								name: projects.name,
								step: projects.step,
							})
							.from(projects)
							.where(eq(projects.id, projectId))
							.limit(1),
						getLatestPrdContent(projectId),
						db
							.select({
								id: tasks.id,
								title: tasks.title,
								description: tasks.description,
								status: tasks.status,
								priority: tasks.priority,
								assignee: tasks.assignee,
								dependencies: tasks.dependencies,
								subtasks: tasks.subtasks,
								order: tasks.order,
								featureName: tasks.featureName,
								startedAt: tasks.startedAt,
								completedAt: tasks.completedAt,
								createdAt: tasks.createdAt,
								updatedAt: tasks.updatedAt,
							})
							.from(tasks)
							.where(eq(tasks.projectId, projectId))
							.orderBy(asc(tasks.order)),
						db
							.select({ version: prdVersions.version })
							.from(prdVersions)
							.where(eq(prdVersions.projectId, projectId))
							.orderBy(desc(prdVersions.version))
							.limit(1),
					]);

					// The project passed ownership but may have been deleted
					// between the checks: never return a 200 with undefined id.
					const row = project[0];
					if (!row)
						return Response.json(
							{ error: "Project not found" },
							{ status: 404 },
						);

					return Response.json({
						id: row.id,
						name: row.name,
						step: row.step,
						prd: prdContent
							? { content: prdContent, version: prdVer[0]?.version ?? 1 }
							: null,
						ac: null,
						tasks: taskRows,
						subtasks: [],
					});
				} catch (e) {
					console.error("v1 project detail failed:", e);
					return Response.json(
						{ error: "Failed to load project" },
						{ status: 500 },
					);
				}
			},
		},
	},
});
