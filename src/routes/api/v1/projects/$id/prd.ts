import { createFileRoute } from "@tanstack/react-router";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { prdVersions } from "@/db/schema";
import {
	apiKeyAuth,
	hasScope,
	verifyProjectOwnership,
} from "@/lib/api-key-auth";

export const Route = createFileRoute("/api/v1/projects/$id/prd")({
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
					const [latest] = await db
						.select({
							content: prdVersions.content,
							version: prdVersions.version,
						})
						.from(prdVersions)
						.where(eq(prdVersions.projectId, projectId))
						.orderBy(desc(prdVersions.version))
						.limit(1);

					if (!latest)
						return Response.json({ error: "PRD not found" }, { status: 404 });

					return Response.json({
						projectId,
						content: latest.content,
						version: latest.version,
					});
				} catch (e) {
					console.error("v1 PRD detail failed:", e);
					return Response.json(
						{ error: "Failed to load PRD" },
						{ status: 500 },
					);
				}
			},
		},
	},
});
