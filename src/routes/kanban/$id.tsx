import { createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, eq, isNull } from "drizzle-orm";
import { useEffect } from "react";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { getLatestAcContent } from "@/lib/services/ac-service";
import { getLatestPrdContent } from "@/lib/services/prd-service";
import { requireUserServer } from "@/lib/session";
import { useLastRoute } from "@/lib/use-last-route";

// ponytail: server-only db logic - loader runs on client too, must not import db there.
const loadKanban = createServerFn({ method: "GET" })
	.validator((id: string) => id)
	.handler(async ({ data: id }) => {
		const user = await requireUserServer();
		const [project, prdContent, acContent] = await Promise.all([
			db
				.select({ id: projects.id, name: projects.name, step: projects.step })
				.from(projects)
				.where(
					and(
						eq(projects.id, id),
						eq(projects.userId, user.id),
						isNull(projects.deletedAt),
					),
				)
				.limit(1),
			getLatestPrdContent(id),
			getLatestAcContent(id),
		]);
		if (!project[0]) throw new Error("NOT_FOUND");
		return {
			projectId: id,
			projectName: project[0].name,
			step: (project[0] as { step?: string | null }).step ?? null,
			latestPrdContent: prdContent ?? null,
			latestAcContent: acContent ?? null,
		};
	});

export const Route = createFileRoute("/kanban/$id")({
	loader: async ({ params }) => {
		try {
			return await loadKanban({ data: params.id });
		} catch (e) {
			if (e instanceof Error && e.message === "Unauthorized")
				throw redirect({ to: "/login" });
			throw e;
		}
	},
	head: ({ loaderData }) => ({
		meta: [{ title: `${loaderData?.projectName ?? "Kanban"} - Kanban Board` }],
	}),
	component: KanbanPage,
	errorComponent: () => (
		<div className="p-10 text-center text-fog">Board tidak ditemukan.</div>
	),
});

function KanbanPage() {
	const { projectId, projectName, latestPrdContent, latestAcContent } =
		Route.useLoaderData();
	const pathname = useLocation({ select: (l) => l.pathname });
	const reportLastRoute = useLastRoute(projectId);

	useEffect(() => {
		reportLastRoute(pathname);
	}, [pathname, reportLastRoute]);
	return (
		<KanbanBoard
			projectId={projectId}
			projectName={projectName}
			latestPrdContent={latestPrdContent}
			latestAcContent={latestAcContent}
		/>
	);
}
