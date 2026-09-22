import { createFileRoute } from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { isValidHistoryUrl } from "@/lib/flow-progress";
import { requireUser } from "@/lib/session";

export const Route = createFileRoute("/api/projects/$id/last-route")({
	server: {
		handlers: {
			POST: async ({
				request,
				params,
			}: {
				request: Request;
				params: { id: string };
			}) => {
				const user = await requireUser(getRequestHeaders());
				const { id: projectId } = params;

				let body: { url?: unknown } | null = null;
				try {
					body = await request.json().catch(() => null);
				} catch {
					return Response.json({ error: "Invalid JSON body" }, { status: 400 });
				}
				const url = typeof body?.url === "string" ? body.url : null;
				if (!url || !isValidHistoryUrl(url, projectId)) {
					return Response.json({ error: "Invalid URL" }, { status: 400 });
				}

				const [existing] = await db
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
				if (!existing)
					return Response.json({ error: "Project not found" }, { status: 404 });

				await db
					.update(projects)
					.set({ lastUrl: url, updatedAt: new Date() })
					.where(
						and(
							eq(projects.id, projectId),
							eq(projects.userId, user.id),
							isNull(projects.deletedAt),
						),
					);
				return Response.json({ success: true, url });
			},
		},
	},
});
