import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, gt, isNull, notInArray, sql } from "drizzle-orm";
// Server-import exception: top-level `@/db`, schema, and `.server` imports
// are correct here — server handlers only, no client component (neighboring
// `/api/codebase` pattern). Never import this module from client code.
import { db } from "@/db";
import { codebaseSyncSessions, projects, subscriptions } from "@/db/schema";
import {
	buildSyncCommand,
	CODEBASE_SYNC_RATE_LIMIT_ACTION,
	CODEBASE_SYNC_TERMINAL_STATUSES,
	getSessionUsability,
	isSyncCapableProject,
	type SyncPromptPayload,
	shouldCreateSyncSession,
	toSessionMetadata,
} from "@/lib/codebase-sync";
import { generateSyncToken, hashSyncToken } from "@/lib/codebase-sync.server";
import {
	CODEBASE_CLI_MIN_VERSION,
	CODEBASE_SYNC_SESSION_EXPIRY_MS,
} from "@/lib/constants";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import type { Plan } from "@/types/database";

async function getGuardedProject(userId: string, projectId: string) {
	const [project] = await db
		.select({ id: projects.id, projectMode: projects.projectMode })
		.from(projects)
		.where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
		.limit(1);
	return project ?? null;
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

export const Route = createFileRoute("/api/codebase/$projectId/session")({
	server: {
		handlers: {
			// Browser read: latest session metadata for refresh recovery.
			// Never exposes the credential hash or any raw credential.
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
				const { projectId } = params;

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

				const project = await getGuardedProject(user.id, projectId);
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

				const [session] = await db
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
				if (!session)
					return Response.json(
						{ error: "Belum ada sync session", code: "NO_SYNC_SESSION" },
						{ status: 404 },
					);

				// Lazy expiry so refresh recovery reports the terminal state.
				const usability = getSessionUsability(session);
				if (!usability.usable && usability.code === "SYNC_SESSION_EXPIRED") {
					await db
						.update(codebaseSyncSessions)
						.set({ status: "expired", updatedAt: new Date() })
						.where(eq(codebaseSyncSessions.id, session.id));
					return Response.json(
						toSessionMetadata({ ...session, status: "expired" }),
					);
				}
				return Response.json(toSessionMetadata(session));
			},

			// Browser create/retry: mints one project-scoped credential and
			// returns the SyncPromptPayload ONCE with the raw credential.
			// POST {} creates; POST { action: "retry" } revokes the usable
			// credential and mints a replacement (terminal rows are never
			// mutated — a retry is a new session/attempt).
			POST: async ({
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
				const { projectId } = params;

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

				const project = await getGuardedProject(user.id, projectId);
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

				const body = (await request.json().catch(() => ({}))) as {
					action?: string;
				};
				const isRetry = body?.action === "retry";

				const rawCredential = generateSyncToken();
				const expiresAt = new Date(
					Date.now() + CODEBASE_SYNC_SESSION_EXPIRY_MS,
				);
				const result = await db.transaction(async (tx) => {
					// Serialize session minting per project. Without this lock, two
					// concurrent POSTs can both observe no active row and mint two
					// usable credentials. The lock lasts only for this transaction.
					await tx.execute(
						sql`select pg_advisory_xact_lock(hashtext(${projectId}))`,
					);
					const existing = await tx
						.select()
						.from(codebaseSyncSessions)
						.where(
							and(
								eq(codebaseSyncSessions.projectId, projectId),
								eq(codebaseSyncSessions.userId, user.id),
							),
						)
						.orderBy(desc(codebaseSyncSessions.createdAt));

					if (isRetry) {
						const now = new Date();
						for (const row of existing) {
							if (
								!["uploaded", "analyzing", "ready"].includes(row.status) &&
								getSessionUsability(row, now).usable
							) {
								await tx
									.update(codebaseSyncSessions)
									.set({
										status: "expired",
										consumedAt: now,
										updatedAt: now,
									})
									.where(eq(codebaseSyncSessions.id, row.id));
							}
						}
					} else if (!shouldCreateSyncSession(existing)) {
						const active = existing.find(
							(row) =>
								!["uploaded", "analyzing", "ready"].includes(row.status) &&
								getSessionUsability(row).usable,
						);
						if (active) {
							return { conflictSessionId: active.id, inserted: null };
						}
					}

					const [inserted] = await tx
						.insert(codebaseSyncSessions)
						.values({
							id: crypto.randomUUID(),
							projectId,
							userId: user.id,
							credentialHash: hashSyncToken(rawCredential),
							status: "waiting_for_cli",
							expiresAt,
							cliMinVersion: CODEBASE_CLI_MIN_VERSION,
							attempt: existing.length + 1,
						})
						.returning({
							id: codebaseSyncSessions.id,
							expiresAt: codebaseSyncSessions.expiresAt,
							cliMinVersion: codebaseSyncSessions.cliMinVersion,
						});
					return { inserted, conflictSessionId: undefined };
				});
				if (result.conflictSessionId)
					return Response.json(
						{
							error: "Masih ada sync session yang aktif",
							code: "SYNC_SESSION_ACTIVE",
							sessionId: result.conflictSessionId,
						},
						{ status: 409 },
					);
				const inserted = result.inserted;
				if (!inserted)
					return Response.json(
						{ error: "Gagal membuat sync session", code: "SYNC_FAILED" },
						{ status: 500 },
					);

				const payload: SyncPromptPayload = {
					projectId,
					apiBaseUrl: new URL(request.url).origin,
					syncToken: rawCredential,
					cliMinVersion: inserted.cliMinVersion,
					syncCommand: buildSyncCommand(projectId),
					expiresAt: inserted.expiresAt.toISOString(),
				};
				return Response.json(payload);
			},

			// Browser revoke: expires usable credentials for this project.
			DELETE: async ({
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
				const { projectId } = params;

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

				const project = await getGuardedProject(user.id, projectId);
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

				// Single set-based revocation: one statement expires every
				// usable credential, so a concurrent handshake can neither
				// mint-then-escape nor block behind O(n) round trips. The
				// predicate mirrors getSessionUsability (unconsumed,
				// unexpired, non-terminal status).
				const now = new Date();
				const revoked = await db
					.update(codebaseSyncSessions)
					.set({ status: "expired", consumedAt: now, updatedAt: now })
					.where(
						and(
							eq(codebaseSyncSessions.projectId, projectId),
							eq(codebaseSyncSessions.userId, user.id),
							isNull(codebaseSyncSessions.consumedAt),
							gt(codebaseSyncSessions.expiresAt, now),
							notInArray(codebaseSyncSessions.status, [
								...CODEBASE_SYNC_TERMINAL_STATUSES,
							]),
						),
					)
					.returning({ id: codebaseSyncSessions.id });
				if (revoked.length === 0)
					return Response.json(
						{ error: "Belum ada sync session", code: "NO_SYNC_SESSION" },
						{ status: 404 },
					);
				return Response.json({
					revoked: true,
					sessionIds: revoked.map((r) => r.id),
				});
			},
		},
	},
});
