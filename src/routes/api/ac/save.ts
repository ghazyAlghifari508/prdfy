import { createFileRoute } from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import {
	AcProjectNotFoundError,
	saveAcVersion,
} from "@/lib/services/ac-service";
import { sanitizeErrorForClient } from "@/lib/services/error-sanitizer";
import { requireUser } from "@/lib/session";

/**
 * POST /api/ac/save - client recovery (PRD US-2): saves AC content already
 * rendered on the client when the SSE generate route's automatic save failed.
 * No AI call - plain insert via saveAcVersion (which enforces ownership in the
 * same transaction that writes).
 */
export const Route = createFileRoute("/api/ac/save")({
	server: {
		handlers: {
			POST: async ({ request }: { request: Request }) => {
				const user = await requireUser(getRequestHeaders());
				let body: unknown;
				try {
					body = await request.json();
				} catch {
					return Response.json({ error: "Invalid JSON body" }, { status: 400 });
				}
				const projectId =
					body && typeof body === "object" && "projectId" in body
						? (body as { projectId: unknown }).projectId
						: undefined;
				const content =
					body && typeof body === "object" && "content" in body
						? (body as { content: unknown }).content
						: undefined;
				if (
					typeof projectId !== "string" ||
					projectId.length === 0 ||
					typeof content !== "string" ||
					content.length === 0
				) {
					return Response.json(
						{ error: "projectId and content required" },
						{ status: 400 },
					);
				}

				try {
					const { acVersionId, version } = await saveAcVersion(
						projectId,
						user.id,
						content,
						"Retry Simpan (recovery)",
					);
					return Response.json({ acVersionId, version });
				} catch (err) {
					if (err instanceof AcProjectNotFoundError) {
						return Response.json(
							{ error: "Project not found" },
							{ status: 404 },
						);
					}
					console.error("ac/save recovery failed:", err);
					return Response.json(
						{ error: sanitizeErrorForClient(err, "ac") },
						{ status: 500 },
					);
				}
			},
		},
	},
});
