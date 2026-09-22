import { createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, eq, isNull } from "drizzle-orm";
import { useEffect } from "react";
import { AcDetail } from "@/components/ac/ac-detail";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { getLatestAcContent } from "@/lib/services/ac-service";
import { getLatestPrdContent } from "@/lib/services/prd-service";
import { getUserPlanAndQuota, requireUserServer } from "@/lib/session";
import { useLastRoute } from "@/lib/use-last-route";

// ponytail: server-only db logic - loader runs on client too, must not import db there.
const loadAc = createServerFn({ method: "GET" })
	.validator((id: string) => id)
	.handler(async ({ data: id }) => {
		const user = await requireUserServer();
		const { plan } = await getUserPlanAndQuota();

		// Authorize project ownership FIRST before querying child PRD/AC version tables
		const [project] = await db
			.select({
				id: projects.id,
				name: projects.name,
				acStatus: projects.acStatus,
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
			.limit(1);

		if (!project) throw new Error("NOT_FOUND");

		const [prdContent, acContent] = await Promise.all([
			getLatestPrdContent(id),
			getLatestAcContent(id),
		]);

		return {
			projectId: id,
			projectName: project.name,
			step: project.step ?? null,
			latestAcContent: acContent ?? undefined,
			latestPrdContent: prdContent ?? undefined,
			plan,
			acStatus: project.acStatus ?? "pending",
		};
	});

export const Route = createFileRoute("/ac/$id")({
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
			return await loadAc({ data: params.id });
		} catch (e) {
			if (e instanceof Error && e.message === "Unauthorized")
				throw redirect({ to: "/login" });
			throw e;
		}
	},
	head: ({ loaderData }) => ({
		meta: [
			{ title: `${loaderData?.projectName ?? "AC"} - Acceptance Criteria` },
		],
	}),
	component: AcDetailPage,
	errorComponent: () => (
		<div className="p-10 text-center text-fog">AC tidak ditemukan.</div>
	),
});

function AcDetailPage() {
	const d = Route.useLoaderData();
	const pathname = useLocation({ select: (l) => l.pathname });
	const reportLastRoute = useLastRoute(d.projectId);

	useEffect(() => {
		reportLastRoute(pathname);
	}, [pathname, reportLastRoute]);
	return (
		<AcDetail
			projectId={d.projectId}
			projectName={d.projectName}
			latestAcContent={d.latestAcContent}
			latestPrdContent={d.latestPrdContent}
			plan={d.plan}
			acStatus={(d as { acStatus?: string | null }).acStatus ?? null}
		/>
	);
}
