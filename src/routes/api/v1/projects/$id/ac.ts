import { createFileRoute } from "@tanstack/react-router";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { acVersions } from "@/db/schema";
import {
	apiKeyAuth,
	hasScope,
	verifyProjectOwnership,
} from "@/lib/api-key-auth";

export const Route = createFileRoute("/api/v1/projects/$id/ac")({
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
							content: acVersions.content,
							version: acVersions.version,
						})
						.from(acVersions)
						.where(eq(acVersions.projectId, projectId))
						.orderBy(desc(acVersions.version))
						.limit(1);

					if (!latest)
						return Response.json({ error: "AC not found" }, { status: 404 });

					return Response.json({
						projectId,
						content: latest.content,
						version: latest.version,
					});
				} catch (e) {
					console.error("v1 AC detail failed:", e);
					return Response.json(
						{ error: "Failed to load AC" },
						{ status: 500 },
					);
				}
			},
		},
	},
});
