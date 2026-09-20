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
import { resolveSubscriptionState } from "@/lib/billing";
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
import {
	buildCodebaseMetrics,
	createCreditQuote,
	formatInsufficientCreditsError,
	formatSubscriptionPausedError,
	markCreditOperationRunning,
	releaseCreditOperation,
	reserveCreditOperation,
	settleCreditOperation,
} from "@/lib/services/credit-service";
import { requireUser } from "@/lib/session";
import type { Plan } from "@/types/database";

// Analysis trigger/read boundary (Task 6).
//
// Server-import exception: top-level `@/db`, schema, and `.server` imports
// are correct here — this module registers server handlers only (no client
// component), following the neighboring `/api/v1` pattern. Never import
// this route module (or the `.server` modules) from client code.
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

				// Unpinned reads scope to the LATEST snapshot (not the latest
				// analysis across all snapshots): after a re-sync starts, the
				// previous attempt's stale ready analysis must not surface as
				// the current state. Pass ?snapshotId= to pin an older attempt.
				const snapshotRows = snapshotScope
					? [{ id: snapshotScope[0] as string }]
					: await db
							.select({ id: codebaseSnapshots.id })
							.from(codebaseSnapshots)
							.where(inArray(codebaseSnapshots.syncSessionId, sessionIds))
							.orderBy(desc(codebaseSnapshots.createdAt))
							.limit(1);
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
			//
			// Sync/async evaluation (Task 9): this POST stays synchronous
			// (model thinking 15–90s+, same trade-off as `/api/ask/options`) —
			// no 202 + job queue in MVP. The review page single-flights the
			// trigger per uploaded snapshot and polls status, so a duplicate
			// POST reuses the pending row instead of stacking model calls.
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

				let snapshot: {
					id: string;
					status: string;
					fileCount: number;
					contentSize: number;
				} | null = null;
				if (body.data.snapshotId) {
					const [pinned] = await db
						.select({
							id: codebaseSnapshots.id,
							status: codebaseSnapshots.status,
							fileCount: codebaseSnapshots.fileCount,
							contentSize: codebaseSnapshots.contentSize,
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
							fileCount: codebaseSnapshots.fileCount,
							contentSize: codebaseSnapshots.contentSize,
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
					.where(eq(subscriptions.userId, user.id))
					.orderBy(desc(subscriptions.createdAt))
					.limit(1);

				const eff = resolveSubscriptionState(sub, new Date());
				const availableCredits = Math.max(
					0,
					(sub?.credits ?? 0) -
						(sub?.creditsUsed ?? 0) -
						(sub?.creditsReserved ?? 0),
				);

				const metrics = buildCodebaseMetrics({
					fileCount: snapshot.fileCount,
					contentSize: snapshot.contentSize,
				});

				const quote = createCreditQuote({
					userId: user.id,
					projectId,
					stage: "codebase",
					operation: "codebase_analysis",
					metrics,
				});

				if (eff.state === "paused") {
					return Response.json(
						formatSubscriptionPausedError({
							quote,
							availableCredits,
							stageLabel: "analisis codebase",
						}),
						{ status: 403 },
					);
				}

				if (availableCredits < quote.maximumCredits) {
					return Response.json(
						formatInsufficientCreditsError({
							quote,
							availableCredits,
							stageLabel: "analisis codebase",
						}),
						{ status: 403 },
					);
				}

				const idempotencyKey = `${projectId}:codebase_analysis:${snapshot.id}`;

				let reservation: {
					id: string;
					state: string;
					finalCharge: number | null;
				};
				try {
					reservation = await reserveCreditOperation({
						userId: user.id,
						projectId,
						stage: "codebase",
						operation: "codebase_analysis",
						metrics,
						idempotencyKey,
						quote,
					});
				} catch (err) {
					console.error(
						"[codebase/analysis] reserveCreditOperation failed:",
						err,
					);
					return Response.json(
						formatInsufficientCreditsError({
							quote,
							availableCredits,
							stageLabel: "analisis codebase",
						}),
						{ status: 403 },
					);
				}

				await markCreditOperationRunning({
					userId: user.id,
					operationId: reservation.id,
				});

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
					if (!response || !analysis) {
						await releaseCreditOperation({
							userId: user.id,
							operationId: reservation.id,
							reason: "Hasil analisis rusak",
						}).catch(() => {});
						return Response.json(
							{ error: "Hasil analisis rusak", code: "SYNC_FAILED" },
							{ status: 500 },
						);
					}

					await settleCreditOperation({
						userId: user.id,
						operationId: reservation.id,
						artifactId: analysis.id,
						actualMetrics: metrics,
					});

					return Response.json(response);
				} catch (error) {
					const failureReason =
						error instanceof Error ? error.message : "Analisis codebase gagal";
					await releaseCreditOperation({
						userId: user.id,
						operationId: reservation.id,
						reason: failureReason,
					}).catch((relErr) => {
						console.error(
							"[codebase/analysis] releaseCreditOperation failed:",
							relErr,
						);
					});

					if (error instanceof AnalysisServiceError) {
						if (error.code === "SNAPSHOT_NOT_UPLOADED")
							return Response.json(
								{ error: error.message, code: "SNAPSHOT_INCOMPLETE" },
								{ status: 409 },
							);
						const [failed] = await db
							.select()
							.from(codebaseAnalyses)
							.where(
								and(
									eq(codebaseAnalyses.snapshotId, snapshot.id),
									eq(codebaseAnalyses.status, "failed"),
								),
							)
							.orderBy(desc(codebaseAnalyses.createdAt))
							.limit(1);
						return Response.json(
							{
								error: error.message,
								code: "ANALYSIS_FAILED",
								// Prefer the exact failed attempt carried by the
								// service (Task 9): under a concurrent duplicate
								// trigger the latest row could be the sibling's
								// ready record. The failed-only query is fallback.
								analysisId: error.analysisId ?? failed?.id,
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
