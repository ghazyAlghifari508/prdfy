import { createFileRoute } from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { prdVersions, projects } from "@/db/schema";
import { requireUser } from "@/lib/session";

// Client-side version history refresh after PRD revisions (prd-detail.tsx).
export const Route = createFileRoute("/api/projects/$id/versions")({
	server: {
		handlers: {
			GET: async ({ params }: { request: Request; params: { id: string } }) => {
				const user = await requireUser(getRequestHeaders());
				const { id: projectId } = params;
				if (!projectId)
					return Response.json(
						{ error: "Project ID is required" },
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

				const rows = await db
					.select({
						id: prdVersions.id,
						version: prdVersions.version,
						content: prdVersions.content,
						change_summary: prdVersions.changeSummary,
						created_at: prdVersions.createdAt,
					})
					.from(prdVersions)
					.where(eq(prdVersions.projectId, projectId))
					.orderBy(desc(prdVersions.version));

				return Response.json(rows);
			},
		},
	},
});
