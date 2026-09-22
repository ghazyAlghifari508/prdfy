import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, isNull } from "drizzle-orm";
import { HistoryPage } from "@/components/history/history-page";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { requireUserServer } from "@/lib/session";

export interface HistoryItem {
	id: string;
	name: string;
	step: string | null;
	lastUrl: string | null;
	updatedAt: Date;
	preview: string | null;
	acStatus: string | null;
	taskStatus: string | null;
}

const loadHistory = createServerFn({ method: "GET" }).handler(async () => {
	const user = await requireUserServer();

	const projectRows = await db
		.select({
			id: projects.id,
			name: projects.name,
			step: projects.step,
			lastUrl: projects.lastUrl,
			updatedAt: projects.updatedAt,
			acStatus: projects.acStatus,
			taskStatus: projects.taskStatus,
			description: projects.description,
		})
		.from(projects)
		.where(and(eq(projects.userId, user.id), isNull(projects.deletedAt)))
		.orderBy(desc(projects.updatedAt));

	// ponytail: preview is the AI-written project summary (projects.description,
	// written fire-and-forget after PRD generate). Legacy rows pre-dating the
	// summary feature have no description — card renders without a preview
	// line rather than re-introducing the full prd_versions content fetch.
	const items: HistoryItem[] = projectRows.map((p) => ({
		id: p.id,
		name: p.name,
		step: p.step,
		lastUrl: p.lastUrl,
		updatedAt: p.updatedAt ?? new Date(0),
		preview: p.description,
		acStatus: p.acStatus,
		taskStatus: p.taskStatus,
	}));

	return { items };
});

export const Route = createFileRoute("/history")({
	loader: async () => {
		try {
			return await loadHistory();
		} catch (e) {
			if ((e as Error).message === "Unauthorized")
				throw redirect({ to: "/login" });
			throw e;
		}
	},
	head: () => ({ meta: [{ title: "History | PrdFy" }] }),
	component: HistoryRoutePage,
});

function HistoryRoutePage() {
	const { items } = Route.useLoaderData();
	return <HistoryPage items={items} />;
}
