import { createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, asc, desc, eq } from "drizzle-orm";
import { useEffect } from "react";
import { PrdDetail } from "@/components/prd/prd-detail";
import { db } from "@/db";
import { conversations, messages, prdVersions, projects } from "@/db/schema";
import { getUserPlanAndQuota, requireUserServer } from "@/lib/session";
import { useLastRoute } from "@/lib/use-last-route";

// ponytail: requireUserServer is a server fn → its auth/db imports get pruned
// from the client bundle. Plain `requireUser` would drag pg (→ Buffer) in.
const loadPrd = createServerFn({ method: "GET" })
	.validator((id: string) => id)
	.handler(async ({ data: id }) => {
		const user = await requireUserServer();
		const { plan, quota } = await getUserPlanAndQuota();

		const [projectRows, versionRows, convRows] = await Promise.all([
			db
				.select({ id: projects.id, name: projects.name, step: projects.step })
				.from(projects)
				.where(and(eq(projects.id, id), eq(projects.userId, user.id)))
				.limit(1),
			db
				.select({
					id: prdVersions.id,
					project_id: prdVersions.projectId,
					version: prdVersions.version,
					content: prdVersions.content,
					change_summary: prdVersions.changeSummary,
					created_at: prdVersions.createdAt,
				})
				.from(prdVersions)
				.where(eq(prdVersions.projectId, id))
				.orderBy(desc(prdVersions.version)),
			db
				.select({ id: conversations.id })
				.from(conversations)
				.where(eq(conversations.projectId, id))
				.orderBy(desc(conversations.createdAt))
				.limit(1),
		]);

		const project = projectRows[0];
		if (!project) throw new Error("NOT_FOUND");

		let initialMessages: Array<{
			id: string;
			role: string;
			content: string;
			created_at: string;
		}> = [];
		const conv = convRows[0];
		if (conv) {
			const msgs = await db
				.select({
					id: messages.id,
					role: messages.role,
					content: messages.content,
					created_at: messages.createdAt,
				})
				.from(messages)
				.where(eq(messages.conversationId, conv.id))
				.orderBy(asc(messages.createdAt))
				.limit(200);
			initialMessages = msgs as never;
		}

		return {
			projectId: id,
			projectName: project.name,
			step: (project as { step?: string | null }).step ?? null,
			latestVersion: versionRows[0],
			allVersions: versionRows,
			conversationId: conv?.id,
			plan,
			revisionLimit: quota?.revisionLimit ?? undefined,
			initialMessages,
		};
	});

export const Route = createFileRoute("/prd/$id")({
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
			return await loadPrd({ data: params.id });
		} catch (e) {
			if (e instanceof Error && e.message === "Unauthorized")
				throw redirect({ to: "/login" });
			throw e;
		}
	},
	head: ({ loaderData }) => ({
		meta: [{ title: loaderData?.projectName || "PRD" }],
	}),
	component: PrdPage,
	errorComponent: ({ error }) => {
		if (error instanceof Error && error.message === "NOT_FOUND") {
			return (
				<div className="p-10 text-center text-fog">PRD tidak ditemukan.</div>
			);
		}
		return (
			<div className="p-10 text-center text-crimson">Gagal memuat PRD.</div>
		);
	},
});

function PrdPage() {
	const d = Route.useLoaderData();
	const pathname = useLocation({ select: (l) => l.pathname });
	const reportLastRoute = useLastRoute(d.projectId);

	useEffect(() => {
		reportLastRoute(pathname);
	}, [pathname, reportLastRoute]);
	return (
		<PrdDetail
			projectId={d.projectId}
			projectName={d.projectName}
			step={d.step}
			latestVersion={d.latestVersion as never}
			allVersions={d.allVersions as never}
			conversationId={d.conversationId}
			plan={d.plan}
			revisionLimit={d.revisionLimit}
			initialMessages={d.initialMessages}
		/>
	);
}
