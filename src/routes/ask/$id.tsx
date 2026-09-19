import { createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { useEffect } from "react";
import { AskFlow } from "@/app/ask/ask-flow";
import { db } from "@/db";
import { codebaseAnalyses, projects } from "@/db/schema";
import { requireUserServer } from "@/lib/session";
import { useLastRoute } from "@/lib/use-last-route";

// Ask entry decision for existing-codebase projects (unit-tested in
// ./-ask-entry.test.ts): without a ready analysis the generic Ask flow would
// run without codebase context, so those projects are routed to /codebase/$id
// until analysis is ready. Greenfield and unknown modes always enter.
export function decideAskEntry(
	projectMode: string | null | undefined,
	hasReadyAnalysis: boolean,
): "allow" | "redirect-codebase" {
	if (projectMode === "existing_codebase" && !hasReadyAnalysis) {
		return "redirect-codebase";
	}
	return "allow";
}

// ponytail: requireUserServer is a server fn → its auth/db imports get pruned
// from the client bundle. Plain `requireUser` would drag pg (→ Buffer) in.
const loadAsk = createServerFn({ method: "GET" })
	.validator((id: string) => id)
	.handler(async ({ data: id }) => {
		const user = await requireUserServer();

		const [project] = await db
			.select({
				id: projects.id,
				name: projects.name,
				step: projects.step,
				projectMode: projects.projectMode,
			})
			.from(projects)
			.where(and(eq(projects.id, id), eq(projects.userId, user.id)))
			.limit(1);

		if (!project) throw new Error("NOT_FOUND");

		let hasReadyAnalysis = false;
		if (project.projectMode === "existing_codebase") {
			const [analysis] = await db
				.select({ id: codebaseAnalyses.id })
				.from(codebaseAnalyses)
				.where(
					and(
						eq(codebaseAnalyses.projectId, id),
						eq(codebaseAnalyses.status, "ready"),
					),
				)
				.limit(1);
			hasReadyAnalysis = !!analysis;
		}

		return {
			projectId: project.id,
			projectName: project.name,
			step: (project as { step?: string | null }).step ?? null,
			projectMode: project.projectMode,
			hasReadyAnalysis,
		};
	});

export const Route = createFileRoute("/ask/$id")({
	loader: async ({ params }) => {
		try {
			const data = await loadAsk({ data: params.id });
			if (
				decideAskEntry(data.projectMode, data.hasReadyAnalysis) ===
				"redirect-codebase"
			) {
				throw redirect({ to: "/codebase/$id", params: { id: params.id } });
			}
			return data;
		} catch (e) {
			if ((e as Error).message === "Unauthorized")
				throw redirect({ to: "/login" });
			throw e;
		}
	},
	head: ({ loaderData }) => ({
		meta: [{ title: loaderData?.projectName || "Question" }],
	}),
	component: AskPage,
	errorComponent: ({ error }) => {
		if (error?.message === "NOT_FOUND") {
			return (
				<div className="p-10 text-center text-fog">Proyek tidak ditemukan.</div>
			);
		}
		return (
			<div className="p-10 text-center text-crimson">Gagal memuat halaman.</div>
		);
	},
});

function AskPage() {
	const d = Route.useLoaderData();
	const pathname = useLocation({ select: (l) => l.pathname });
	const reportLastRoute = useLastRoute(d.projectId);

	useEffect(() => {
		reportLastRoute(pathname);
	}, [pathname, reportLastRoute]);

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
			<AskFlow projectId={d.projectId} projectName={d.projectName} />
		</div>
	);
}
