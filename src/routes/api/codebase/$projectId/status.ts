import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, isNull, notInArray } from "drizzle-orm";
// Server-import exception: top-level `@/db` and schema imports are correct
// here — server handlers only, no client component (neighboring
// `/api/codebase` pattern). Never import this module from client code.
import { db } from "@/db";
import {
	codebaseAnalyses,
	codebaseSnapshots,
	codebaseSyncSessions,
	projects,
	subscriptions,
} from "@/db/schema";
import {
	CODEBASE_SYNC_RATE_LIMIT_ACTION,
	type CodebaseSyncStatus,
	canAccessSyncSession,
	getSessionUsability,
	isSyncCapableProject,
	type SyncStatusResponse,
	sanitizeSyncErrorCode,
	sanitizeSyncErrorMessage,
	syncStatusResponseSchema,
} from "@/lib/codebase-sync";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import type { Plan } from "@/types/database";

export const Route = createFileRoute("/api/codebase/$projectId/status")({
	server: {
		handlers: {
			// Browser polling (2000ms, no SSE in MVP): persisted status plus
			// timestamps, counts, safe error, and analysis linkage. Errors and
			// payloads never carry tokens or source data.
			GET: async ({
				request,
				params,
			}: {
				request: Request;
				params: { projectId: string };
			}) => {
				let user: { id: string };
				try {
					user = await requireUser(request.headers);
				} catch {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}
				// The whole operational path runs guarded: subscription,
				// project, session, snapshot, and analysis reads (plus lazy
				// expiry writes) must surface the documented JSON error
				// contract, never an uncontrolled framework error.
				try {
					const { projectId } = params;

					const [sub] = await db
						.select({ plan: subscriptions.plan })
						.from(subscriptions)
						.where(eq(subscriptions.userId, user.id))
						.orderBy(desc(subscriptions.createdAt))
						.limit(1);
					const rawPlan = sub?.plan || "free";
					const plan: Plan = ["free", "pro", "hengker"].includes(rawPlan)
						? (rawPlan as Plan)
						: "free";

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
					const [project] = await db
						.select({ id: projects.id, projectMode: projects.projectMode })
						.from(projects)
						.where(
							and(
								eq(projects.id, projectId),
								eq(projects.userId, user.id),
								isNull(projects.deletedAt),
							),
						)
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
					const requestedSessionId = url.searchParams.get("sessionId");

					let session = null;
					if (requestedSessionId) {
						const [row] = await db
							.select()
							.from(codebaseSyncSessions)
							.where(eq(codebaseSyncSessions.id, requestedSessionId))
							.limit(1);
						if (row && canAccessSyncSession(row, user.id, projectId)) {
							session = row;
						}
					} else {
						const [row] = await db
							.select()
							.from(codebaseSyncSessions)
							.where(
								and(
									eq(codebaseSyncSessions.projectId, projectId),
									eq(codebaseSyncSessions.userId, user.id),
								),
							)
							.orderBy(desc(codebaseSyncSessions.createdAt))
							.limit(1);
						session = row ?? null;
					}
					if (!session)
						return Response.json(
							{ error: "Belum ada sync session", code: "NO_SYNC_SESSION" },
							{ status: 404 },
						);

					// Lazy expiry so polling converges on the terminal state.
					// Conditional on the still-expirable state: a concurrent
					// worker may have moved the session to ready/failed/consumed
					// after our read, and this write must not clobber that.
					let status = session.status as CodebaseSyncStatus;
					let sessionUpdatedAt = session.updatedAt;
					const usability = getSessionUsability(session);
					if (!usability.usable && usability.code === "SYNC_SESSION_EXPIRED") {
						const [expired] = await db
							.update(codebaseSyncSessions)
							.set({ status: "expired", updatedAt: new Date() })
							.where(
								and(
									eq(codebaseSyncSessions.id, session.id),
									isNull(codebaseSyncSessions.consumedAt),
									notInArray(codebaseSyncSessions.status, [
										"ready",
										"failed",
										"expired",
									]),
								),
							)
							.returning({ updatedAt: codebaseSyncSessions.updatedAt });
						if (expired) {
							status = "expired";
							sessionUpdatedAt = expired.updatedAt;
						}
					}

					// Artifacts are only attached for usable or successfully-ready
					// sessions. A failed/expired session must not serve a stale
					// snapshot or a ready analysis that polling could mistake for
					// the current sync's success.
					const showArtifacts = status !== "failed" && status !== "expired";
					const [snapshot] = showArtifacts
						? await db
								.select({
									id: codebaseSnapshots.id,
									fileCount: codebaseSnapshots.fileCount,
									excludedCount: codebaseSnapshots.excludedCount,
									createdAt: codebaseSnapshots.createdAt,
								})
								.from(codebaseSnapshots)
								.where(eq(codebaseSnapshots.syncSessionId, session.id))
								.orderBy(desc(codebaseSnapshots.createdAt))
								.limit(1)
						: [];

					let analysisId: string | null = null;
					let analysisStatus: "pending" | "ready" | "failed" | undefined;
					let errorCode: string | null = null;
					let errorMessage: string | null = null;
					if (snapshot) {
						const [analysis] = await db
							.select({
								id: codebaseAnalyses.id,
								status: codebaseAnalyses.status,
								errorCode: codebaseAnalyses.errorCode,
								errorMessage: codebaseAnalyses.errorMessage,
							})
							.from(codebaseAnalyses)
							.where(eq(codebaseAnalyses.snapshotId, snapshot.id))
							.orderBy(desc(codebaseAnalyses.createdAt))
							.limit(1);
						if (analysis) {
							analysisId = analysis.id;
							// Task 6: drive the review/retry UI. Stored statuses are
							// writer-controlled (pending/ready/failed); anything
							// else is dropped so polling never shows a bogus state.
							if (
								analysis.status === "pending" ||
								analysis.status === "ready" ||
								analysis.status === "failed"
							) {
								analysisStatus = analysis.status;
							}
							// Server-written codes only; unknown values collapse so
							// analysis internals never leak through status polling.
							if (analysis.errorCode) {
								errorCode = sanitizeSyncErrorCode(analysis.errorCode);
							}
							// Analysis writers must store only safe user-facing
							// strings; this sanitizer is defense-in-depth so
							// tokens or source content can never pass through.
							errorMessage = sanitizeSyncErrorMessage(analysis.errorMessage);
						}
					}

					const toIso = (value: Date | null | undefined): string | undefined =>
						value ? value.toISOString() : undefined;
					const response: SyncStatusResponse = {
						projectId,
						sessionId: session.id,
						status,
						snapshotId: snapshot?.id ?? null,
						snapshotCreatedAt: toIso(snapshot?.createdAt),
						fileCount: snapshot?.fileCount ?? undefined,
						excludedCount: snapshot?.excludedCount ?? undefined,
						errorCode,
						errorMessage,
						analysisId,
						analysisStatus,
						createdAt: toIso(session.createdAt),
						updatedAt: toIso(sessionUpdatedAt),
						expiresAt: toIso(session.expiresAt),
					};
					let parsed: ReturnType<typeof syncStatusResponseSchema.safeParse>;
					try {
						parsed = syncStatusResponseSchema.safeParse(response);
					} catch (e) {
						console.error("sync status serialization failed:", e);
						return Response.json(
							{ error: "Gagal membaca status sync", code: "SYNC_FAILED" },
							{ status: 500 },
						);
					}
					if (!parsed.success)
						return Response.json(
							{ error: "Gagal membaca status sync", code: "SYNC_FAILED" },
							{ status: 500 },
						);
					return Response.json(parsed.data);
				} catch (e) {
					console.error("sync status handler failed:", e);
					return Response.json(
						{ error: "Gagal membaca status sync", code: "SYNC_FAILED" },
						{ status: 500 },
					);
				}
			},
		},
	},
});
