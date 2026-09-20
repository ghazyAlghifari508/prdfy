import { createFileRoute } from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { db } from "@/db";
import { errorReports } from "@/db/schema";
import {
	type ErrorReportPayload,
	parseErrorReportBody,
} from "@/lib/error-report";
import { getSessionFromHeaders } from "@/lib/session";

export const Route = createFileRoute("/api/report-error")({
	server: {
		handlers: {
			POST: async ({ request }: { request: Request }) => {
				const session = await getSessionFromHeaders(getRequestHeaders());
				const body = await request.json().catch(() => null);
				let payload: ErrorReportPayload;
				try {
					payload = parseErrorReportBody(body);
				} catch {
					return Response.json({ error: "Invalid payload" }, { status: 400 });
				}

				await db.insert(errorReports).values({
					id: crypto.randomUUID(),
					userId: session?.user.id ?? null,
					errorMessage: payload.errorMessage,
					context: payload.context,
				});

				return Response.json({ received: true });
			},
		},
	},
});
