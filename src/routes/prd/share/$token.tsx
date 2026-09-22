import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, isNull } from "drizzle-orm";
import { PrdViewer } from "@/components/prd/prd-viewer";
import { Logo } from "@/components/ui/logo";
import { db } from "@/db";
import { prdVersions, projects } from "@/db/schema";

// ponytail: server-only db logic - loader runs on client too, must not import db there.
const loadSharedPrd = createServerFn({ method: "GET" })
	.validator((token: string) => token)
	.handler(async ({ data: token }) => {
		// ponytail: schema has no `is_shared` flag - shareToken presence implies shared.
		const [project] = await db
			.select({ id: projects.id, name: projects.name, userId: projects.userId })
			.from(projects)
			.where(and(eq(projects.shareToken, token), isNull(projects.deletedAt)))
			.limit(1);
		if (!project) throw new Error("NOT_FOUND");

		const { subscriptions } = await import("@/db/schema");
		const { FEATURES } = await import("@/types/database");
		const { resolveSubscriptionState } = await import("@/lib/billing");
		const [sub] = await db
			.select({
				plan: subscriptions.plan,
				status: subscriptions.status,
				credits: subscriptions.credits,
				creditsUsed: subscriptions.creditsUsed,
				creditsReserved: subscriptions.creditsReserved,
				currentPeriodStart: subscriptions.currentPeriodStart,
				currentPeriodEnd: subscriptions.currentPeriodEnd,
				cancelledAt: subscriptions.cancelledAt,
			})
			.from(subscriptions)
			.where(eq(subscriptions.userId, project.userId))
			.orderBy(desc(subscriptions.createdAt))
			.limit(1);
		const eff = resolveSubscriptionState(sub, new Date());
		if (FEATURES[eff.effectivePlan].shareLink === false) {
			throw new Error("NOT_FOUND");
		}

		const [latest] = await db
			.select({ content: prdVersions.content })
			.from(prdVersions)
			.where(eq(prdVersions.projectId, project.id))
			.orderBy(desc(prdVersions.version))
			.limit(1);
		if (!latest) throw new Error("NOT_FOUND");

		return { content: latest.content, projectName: project.name };
	});

export const Route = createFileRoute("/prd/share/$token")({
	loader: ({ params }) => loadSharedPrd({ data: params.token }),
	head: ({ loaderData }) => ({
		meta: [{ title: loaderData?.projectName || "Shared PRD" }],
	}),
	component: SharedPrdPage,
	errorComponent: () => (
		<div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-(--bg-card)">
			<p className="text-fog">PRD tidak ditemukan atau belum dibagikan.</p>
			<Link
				to="/"
				className="rounded-lg border border-(--border-subtle) px-4 py-2 text-sm hover:bg-(--bg-surface)"
			>
				Kembali
			</Link>
		</div>
	),
});

function SharedPrdPage() {
	const { content, projectName } = Route.useLoaderData();
	return (
		<div className="min-h-screen bg-(--bg-card)">
			<div className="border-b border-(--border-subtle) px-6 py-4">
				<div className="mx-auto flex max-w-4xl items-center justify-between">
					<Logo />
					<span className="rounded-full bg-(--bg-surface) px-3 py-1 text-xs text-(--text-secondary)">
						Shared View
					</span>
				</div>
			</div>
			<PrdViewer content={content} projectName={projectName} />
		</div>
	);
}
