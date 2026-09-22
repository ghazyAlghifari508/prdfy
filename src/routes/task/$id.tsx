import { createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, eq, isNull } from "drizzle-orm";
import { useEffect } from "react";
import { TaskDetail } from "@/components/task/task-detail";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { getLatestAcContent } from "@/lib/services/ac-service";
import { getLatestPrdContent } from "@/lib/services/prd-service";
import { getTaskTree } from "@/lib/services/task-service";
import { requireUserServer } from "@/lib/session";
import { useLastRoute } from "@/lib/use-last-route";

// ponytail: server-only db logic - loader runs on client too, must not import db there.
const loadTask = createServerFn({ method: "GET" })
	.validator((id: string) => id)
	.handler(async ({ data: id }) => {
		const user = await requireUserServer();
		const [project, prdContent, acContent, taskTree] = await Promise.all([
			// ponytail: select only needed cols — name + taskStatus used downstream.
			// Avoids pulling description/shareToken/lastUrl jsonb on every Task page load.
			db
				.select({
					id: projects.id,
					name: projects.name,
					taskStatus: projects.taskStatus,
					step: projects.step,
				})
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
			getTaskTree(id),
		]);

		if (!project[0]) throw new Error("NOT_FOUND");
		return {
			projectId: id,
			projectName: project[0].name,
			step: (project[0] as { step?: string | null }).step ?? null,
			taskTree,
			hasAc: Boolean(acContent),
			taskStatus: project[0].taskStatus,
			latestPrdContent: prdContent ?? null,
			latestAcContent: acContent ?? null,
		};
	});

export const Route = createFileRoute("/task/$id")({
	validateSearch: (
		search: Record<string, unknown>,
	): { order_id?: string; payment?: string; transaction_status?: string } => {
		const result: {
			order_id?: string;
			payment?: string;
			transaction_status?: string;
		} = {};
		if (typeof search.order_id === "string") result.order_id = search.order_id;
		if (typeof search.payment === "string") result.payment = search.payment;
		if (typeof search.transaction_status === "string")
			result.transaction_status = search.transaction_status;
		return result;
	},
	loader: async ({ params }) => {
		try {
			return await loadTask({ data: params.id });
		} catch (e) {
			if (e instanceof Error && e.message === "Unauthorized")
				throw redirect({ to: "/login" });
			throw e;
		}
	},
	head: ({ loaderData }) => ({
		meta: [{ title: `${loaderData?.projectName ?? "Task"} - Task Board` }],
	}),
	component: TaskPage,
	errorComponent: () => (
		<div className="p-10 text-center text-fog">Task board tidak ditemukan.</div>
	),
});

function TaskPage() {
	const d = Route.useLoaderData();
	const pathname = useLocation({ select: (l) => l.pathname });
	const reportLastRoute = useLastRoute(d.projectId);

	useEffect(() => {
		reportLastRoute(pathname);
	}, [pathname, reportLastRoute]);
	return (
		<TaskDetail
			projectId={d.projectId}
			projectName={d.projectName}
			taskTree={d.taskTree as never}
			hasAc={d.hasAc}
			taskStatus={d.taskStatus}
			latestPrdContent={d.latestPrdContent}
			latestAcContent={d.latestAcContent}
		/>
	);
}
