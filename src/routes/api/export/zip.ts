import { createFileRoute } from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { getLatestAcMarkdown } from "@/lib/services/ac-service";
import {
	formatAcMarkdown,
	formatPrdMarkdown,
	formatTasksJson,
	generateZipBuffer,
} from "@/lib/services/export-service";
import { getLatestPrdContent } from "@/lib/services/prd-service";
import { getTaskTree } from "@/lib/services/task-service";
import { requireUser } from "@/lib/session";

export const Route = createFileRoute("/api/export/zip")({
	server: {
		handlers: {
			POST: async ({ request }: { request: Request }) => {
				const user = await requireUser(getRequestHeaders());
				const body = await request.json().catch(() => null);
				const projectId =
					body && typeof body === "object" && !Array.isArray(body)
						? (body as { projectId?: unknown }).projectId
						: undefined;
				if (typeof projectId !== "string" || projectId.length === 0)
					return Response.json(
						{ error: "Project ID required" },
						{ status: 400 },
					);

				const [project] = await db
					.select({ id: projects.id, name: projects.name })
					.from(projects)
					.where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
					.limit(1);
				if (!project)
					return Response.json({ error: "Project not found" }, { status: 404 });

				const [prdContent, acContent, taskTree] = await Promise.all([
					getLatestPrdContent(projectId),
					getLatestAcMarkdown(projectId),
					getTaskTree(projectId),
				]);

				const zipBuffer = await generateZipBuffer({
					prd: prdContent ? formatPrdMarkdown(prdContent) : undefined,
					ac: acContent ? formatAcMarkdown(acContent) : undefined,
					tasks: formatTasksJson(taskTree),
				});

				const safeName = (project.name || "project")
					.replace(/[^a-zA-Z0-9_-]/g, "-")
					.replace(/-+/g, "-")
					.toLowerCase();

				return new Response(new Uint8Array(zipBuffer), {
					headers: {
						"Content-Type": "application/zip",
						"Content-Disposition": `attachment; filename="prdfy-${safeName}.zip"`,
						"Content-Length": String(zipBuffer.length),
					},
				});
			},
		},
	},
});
