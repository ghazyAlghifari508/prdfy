import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
	codebaseAnalyses,
	codebaseSnapshots,
	codebaseSyncSessions,
	projects,
	subscriptions,
} from "@/db/schema";
import {
	type AnalysisResponse,
	analysisRequestSchema,
	analysisResponseSchema,
	codebaseAnalysisSchema,
	decideAnalysisRequest,
} from "@/lib/codebase-analysis";
import {
	AnalysisServiceError,
	requestCodebaseAnalysis,
} from "@/lib/codebase-analysis.server";
import {
	CODEBASE_SYNC_RATE_LIMIT_ACTION,
	isSyncCapableProject,
} from "@/lib/codebase-sync";
import { checkRateLimit, recordRequest } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import type { Plan } from "@/types/database";

// Analysis trigger/read boundary (Task 6).
//
// Auth decision: browser session (requireUser), NOT the sync credential and
// NOT an API key. The trigger comes from the review UI after the CLI upload
// finishes; the sync credential must never leave the modal textarea, and the
// CLI itself has no model access to run analysis. Rate limiting reuses the
// sync `api_call` action like the neighboring /api/codebase browser routes.
// Analysis never consumes PRD/AC/Task credits.

type AnalysisRow = typeof codebaseAnalyses.$inferSelect;

function toIso(value: Date | null | undefined): string | undefined {
	return value ? value.toISOString() : undefined;
}

function toResponse(row: AnalysisRow): AnalysisResponse | null {
	const output =
		row.output == null ? null : codebaseAnalysisSchema.safeParse(row.output);
	if (row.output != null && (!output || !output.success)) return null;
	const response: AnalysisResponse = {
		id: row.id,
		projectId: row.projectId,
		snapshotId: row.snapshotId,
		status: row.status as AnalysisResponse["status"],
		output: output?.success ? output.data : null,
		errorCode: row.errorCode,
		errorMessage: row.errorMessage,
		createdAt: toIso(row.createdAt),
		updatedAt: toIso(row.updatedAt),
	};
	const parsed = analysisResponseSchema.safeParse(response);
	return parsed.success ? parsed.data : null;
}

async function resolvePlan(userId: string): Promise<Plan> {
	const [sub] = await db
		.select({ plan: subscriptions.plan })
		.from(subscriptions)
		.where(eq(subscriptions.userId, userId))
		.orderBy(desc(subscriptions.createdAt))
		.limit(1);
	const rawPlan = sub?.plan || "free";
	return (
		["free", "pro", "hengker"].includes(rawPlan) ? rawPlan : "free"
	) as Plan;
}

export const Route = createFileRoute("/api/v1/projects/$id/codebase/analysis")({
	server: {
		handlers: {
			// Read: latest analysis for this project (optionally pinned to a
			// snapshot). Powers the review page after reload without replaying
			// generation. 404 (no code) means "no analysis yet" — the UI then
			// offers the trigger. Never returns tokens or source content.
			GET: async ({
				request,
				params,
			}: {
				request: Request;
				params: { id: string };
			}) => {
				let user: { id: string };
				try {
					user = await requireUser(request.headers);
				} catch {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}
				const { id: projectId } = params;

				const plan = await resolvePlan(user.id);
				const rateCheck = await checkRateLimit(
					user.id,
					plan,
					CODEBASE_SYNC_RATE_LIMIT_ACTION,
				);
				if (!rateCheck.allowed)
					return Response.json(
						{ error: "Terlalu banyak permintaan", retryAfter: 60 },
						{ status: 429 },
					);
				await recordRequest(user.id, CODEBASE_SYNC_RATE_LIMIT_ACTION);

				const [project] = await db
					.select({ id: projects.id, projectMode: projects.projectMode })
					.from(projects)
					.where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
					.limit(1);
				if (!project)
					return Response.json(
						{ error: "Project tidak ditemukan" },
						{ status: 404 },
					);
				if (!isSyncCapableProject(project))
					return Response.json(
						{
							error: "Project ini bukan project existing-codebase",
							code: "PROJECT_MODE_MISMATCH",
						},
						{ status: 400 },
					);

				const url = new URL(request.url);
				const pinnedSnapshotId = url.searchParams.get("snapshotId");

				const sessions = await db
					.select({ id: codebaseSyncSessions.id })
					.from(codebaseSyncSessions)
					.where(
						and(
							eq(codebaseSyncSessions.projectId, projectId),
							eq(codebaseSyncSessions.userId, user.id),
						),
					);
				if (sessions.length === 0)
					return Response.json(
						{ error: "Belum ada analisis codebase" },
						{ status: 404 },
					);
				const sessionIds = sessions.map((session) => session.id);

				const snapshotScope =
					pinnedSnapshotId &&
					(
						await db
							.select({ id: codebaseSnapshots.id })
							.from(codebaseSnapshots)
							.where(
								and(
									eq(codebaseSnapshots.id, pinnedSnapshotId),
									inArray(codebaseSnapshots.syncSessionId, sessionIds),
								),
							)
							.limit(1)
					).length > 0
						? [pinnedSnapshotId]
						: null;
				if (pinnedSnapshotId && !snapshotScope)
					return Response.json(
						{ error: "Snapshot tidak ditemukan" },
						{ status: 404 },
					);

				const snapshotRows = snapshotScope
					? [{ id: snapshotScope[0] as string }]
					: await db
							.select({ id: codebaseSnapshots.id })
							.from(codebaseSnapshots)
							.where(inArray(codebaseSnapshots.syncSessionId, sessionIds));
				if (snapshotRows.length === 0)
					return Response.json(
						{ error: "Belum ada analisis codebase" },
						{ status: 404 },
					);

				const [row] = await db
					.select()
					.from(codebaseAnalyses)
					.where(
						inArray(
							codebaseAnalyses.snapshotId,
							snapshotRows.map((snapshot) => snapshot.id),
						),
					)
					.orderBy(desc(codebaseAnalyses.createdAt))
					.limit(1);
				if (!row)
					return Response.json(
						{ error: "Belum ada analisis codebase" },
						{ status: 404 },
					);
				const response = toResponse(row);
				if (!response)
					return Response.json(
						{ error: "Hasil analisis rusak", code: "SYNC_FAILED" },
						{ status: 500 },
					);
				return Response.json(response);
			},

			// Trigger: run analysis on an uploaded snapshot. Idempotent — a
			// pending or ready record is reused; only a failed (or missing)
			// record mints a fresh attempt. Never replays completion and never
			// touches terminal sync rows.
			POST: async ({
				request,
				params,
			}: {
				request: Request;
				params: { id: string };
			}) => {
				let user: { id: string };
				try {
					user = await requireUser(request.headers);
				} catch {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}
				const { id: projectId } = params;

				const plan = await resolvePlan(user.id);
				const rateCheck = await checkRateLimit(
					user.id,
					plan,
					CODEBASE_SYNC_RATE_LIMIT_ACTION,
				);
				if (!rateCheck.allowed)
					return Response.json(
						{ error: "Terlalu banyak permintaan", retryAfter: 60 },
						{ status: 429 },
					);
				await recordRequest(user.id, CODEBASE_SYNC_RATE_LIMIT_ACTION);

				const [project] = await db
					.select({ id: projects.id, projectMode: projects.projectMode })
					.from(projects)
					.where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
					.limit(1);
				if (!project)
					return Response.json(
						{ error: "Project tidak ditemukan" },
						{ status: 404 },
					);
				if (!isSyncCapableProject(project))
					return Response.json(
						{
							error: "Project ini bukan project existing-codebase",
							code: "PROJECT_MODE_MISMATCH",
						},
						{ status: 400 },
					);

				const raw = (await request.json().catch(() => ({}))) as unknown;
				const body = analysisRequestSchema.safeParse(raw);
				if (!body.success)
					return Response.json(
						{ error: "Request analisis tidak valid", code: "SYNC_FAILED" },
						{ status: 400 },
					);

				const sessions = await db
					.select({ id: codebaseSyncSessions.id })
					.from(codebaseSyncSessions)
					.where(
						and(
							eq(codebaseSyncSessions.projectId, projectId),
							eq(codebaseSyncSessions.userId, user.id),
						),
					)
					.orderBy(desc(codebaseSyncSessions.createdAt));
				if (sessions.length === 0)
					return Response.json(
						{ error: "Belum ada sync session", code: "NO_SYNC_SESSION" },
						{ status: 404 },
					);
				const sessionIds = sessions.map((session) => session.id);

				let snapshot: { id: string; status: string } | null = null;
				if (body.data.snapshotId) {
					const [pinned] = await db
						.select({
							id: codebaseSnapshots.id,
							status: codebaseSnapshots.status,
						})
						.from(codebaseSnapshots)
						.where(
							and(
								eq(codebaseSnapshots.id, body.data.snapshotId),
								inArray(codebaseSnapshots.syncSessionId, sessionIds),
							),
						)
						.limit(1);
					snapshot = pinned ?? null;
					if (!snapshot)
						return Response.json(
							{ error: "Snapshot tidak ditemukan" },
							{ status: 404 },
						);
				} else {
					const [latest] = await db
						.select({
							id: codebaseSnapshots.id,
							status: codebaseSnapshots.status,
						})
						.from(codebaseSnapshots)
						.where(
							and(
								inArray(codebaseSnapshots.syncSessionId, sessionIds),
								eq(codebaseSnapshots.status, "uploaded"),
							),
						)
						.orderBy(desc(codebaseSnapshots.createdAt))
						.limit(1);
					snapshot = latest ?? null;
					if (!snapshot)
						return Response.json(
							{
								error: "Snapshot belum siap dianalisis",
								code: "SNAPSHOT_INCOMPLETE",
							},
							{ status: 409 },
						);
				}

				const existing = await db
					.select({ id: codebaseAnalyses.id, status: codebaseAnalyses.status })
					.from(codebaseAnalyses)
					.where(eq(codebaseAnalyses.snapshotId, snapshot.id))
					.orderBy(desc(codebaseAnalyses.createdAt));
				const decision = decideAnalysisRequest(
					{ id: snapshot.id, status: snapshot.status },
					existing,
				);
				if (decision.action === "reject")
					return Response.json(
						{ error: decision.message, code: "SNAPSHOT_INCOMPLETE" },
						{ status: 409 },
					);
				if (decision.action === "reuse") {
					const [row] = await db
						.select()
						.from(codebaseAnalyses)
						.where(eq(codebaseAnalyses.id, decision.analysisId))
						.limit(1);
					const response = row ? toResponse(row) : null;
					if (!response)
						return Response.json(
							{ error: "Hasil analisis rusak", code: "SYNC_FAILED" },
							{ status: 500 },
						);
					return Response.json(response);
				}

				try {
					const analysis = await requestCodebaseAnalysis(
						projectId,
						snapshot.id,
					);
					const [row] = await db
						.select()
						.from(codebaseAnalyses)
						.where(
							and(
								eq(codebaseAnalyses.snapshotId, snapshot.id),
								eq(codebaseAnalyses.status, "ready"),
							),
						)
						.orderBy(desc(codebaseAnalyses.createdAt))
						.limit(1);
					const response = row ? toResponse(row) : null;
					if (!response || !analysis)
						return Response.json(
							{ error: "Hasil analisis rusak", code: "SYNC_FAILED" },
							{ status: 500 },
						);
					return Response.json(response);
				} catch (error) {
					if (error instanceof AnalysisServiceError) {
						if (error.code === "SNAPSHOT_NOT_UPLOADED")
							return Response.json(
								{ error: error.message, code: "SNAPSHOT_INCOMPLETE" },
								{ status: 409 },
							);
						const [failed] = await db
							.select()
							.from(codebaseAnalyses)
							.where(eq(codebaseAnalyses.snapshotId, snapshot.id))
							.orderBy(desc(codebaseAnalyses.createdAt))
							.limit(1);
						return Response.json(
							{
								error: error.message,
								code: "ANALYSIS_FAILED",
								analysisId: failed?.id,
							},
							{ status: 502 },
						);
					}
					console.error("Codebase analysis trigger error:", error);
					return Response.json(
						{ error: "Analisis codebase gagal", code: "ANALYSIS_FAILED" },
						{ status: 502 },
					);
				}
			},
		},
	},
});
