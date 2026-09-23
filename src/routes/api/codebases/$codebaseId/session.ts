import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, gt, isNull, notInArray, sql } from "drizzle-orm";
// Server-import exception: top-level `@/db`, schema, and `.server` imports
// are correct here — server handlers only, no client component (neighboring
// `/api/codebases` pattern). Never import this module from client code.
import { db } from "@/db";
import { codebaseSyncSessions, codebases, subscriptions } from "@/db/schema";
import {
	buildSyncCommand,
	CODEBASE_SYNC_RATE_LIMIT_ACTION,
	CODEBASE_SYNC_TERMINAL_STATUSES,
	getSessionUsability,
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

export const CODEBASE_SESSION_ROUTE_PATH = "/api/codebases/$codebaseId/session";

async function getGuardedCodebase(userId: string, codebaseId: string) {
	const [codebase] = await db
		.select({ id: codebases.id, name: codebases.name })
		.from(codebases)
		.where(and(eq(codebases.id, codebaseId), eq(codebases.userId, userId)))
		.limit(1);
	return codebase ?? null;
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

export const Route = createFileRoute("/api/codebases/$codebaseId/session")({
	server: {
		handlers: {
			// Browser read: latest session metadata for refresh recovery.
			// Never exposes the credential hash or any raw credential.
			GET: async ({
				request,
				params,
			}: {
				request: Request;
				params: { codebaseId: string };
			}) => {
				let user: { id: string };
				try {
					user = await requireUser(request.headers);
				} catch {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}
				const { codebaseId } = params;

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

				const codebase = await getGuardedCodebase(user.id, codebaseId);
				if (!codebase)
					return Response.json(
						{ error: "Codebase tidak ditemukan" },
						{ status: 404 },
					);

				const [session] = await db
					.select()
					.from(codebaseSyncSessions)
					.where(
						and(
							eq(codebaseSyncSessions.codebaseId, codebaseId),
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
				const usability = getSessionUsability({
					...session,
					projectId: codebaseId,
				});
				if (!usability.usable && usability.code === "SYNC_SESSION_EXPIRED") {
					await db
						.update(codebaseSyncSessions)
						.set({ status: "expired", updatedAt: new Date() })
						.where(eq(codebaseSyncSessions.id, session.id));
					return Response.json(
						toSessionMetadata({
							...session,
							projectId: codebaseId,
							status: "expired",
						}),
					);
				}
				return Response.json(
					toSessionMetadata({ ...session, projectId: codebaseId }),
				);
			},

			// Browser create/retry: mints one codebase-scoped credential and
			// returns the SyncPromptPayload ONCE with the raw credential.
			// POST {} creates; POST { action: "retry" } revokes the usable
			// credential and mints a replacement (terminal rows are never
			// mutated — a retry is a new session/attempt).
			POST: async ({
				request,
				params,
			}: {
				request: Request;
				params: { codebaseId: string };
			}) => {
				let user: { id: string };
				try {
					user = await requireUser(request.headers);
				} catch {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}
				const { codebaseId } = params;

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

				const codebase = await getGuardedCodebase(user.id, codebaseId);
				if (!codebase)
					return Response.json(
						{ error: "Codebase tidak ditemukan" },
						{ status: 404 },
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
					// Serialize session minting per codebase. Without this lock, two
					// concurrent POSTs can both observe no active row and mint two
					// usable credentials. The lock lasts only for this transaction.
					await tx.execute(
						sql`select pg_advisory_xact_lock(hashtext(${codebaseId}))`,
					);
					const existing = await tx
						.select()
						.from(codebaseSyncSessions)
						.where(
							and(
								eq(codebaseSyncSessions.codebaseId, codebaseId),
								eq(codebaseSyncSessions.userId, user.id),
							),
						)
						.orderBy(desc(codebaseSyncSessions.createdAt));

					if (isRetry) {
						const now = new Date();
						for (const row of existing) {
							if (
								!["uploaded", "analyzing", "ready"].includes(row.status) &&
								getSessionUsability({ ...row, projectId: codebaseId }, now)
									.usable
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
					} else if (
						!shouldCreateSyncSession(
							existing.map((row) => ({ ...row, projectId: codebaseId })),
						)
					) {
						const active = existing.find(
							(row) =>
								!["uploaded", "analyzing", "ready"].includes(row.status) &&
								getSessionUsability({ ...row, projectId: codebaseId }).usable,
						);
						if (active) {
							return { conflictSessionId: active.id, inserted: null };
						}
					}

					const [inserted] = await tx
						.insert(codebaseSyncSessions)
						.values({
							id: crypto.randomUUID(),
							codebaseId,
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
					projectId: codebaseId,
					apiBaseUrl: new URL(request.url).origin,
					syncToken: rawCredential,
					cliMinVersion: inserted.cliMinVersion,
					syncCommand: buildSyncCommand(codebaseId),
					expiresAt: inserted.expiresAt.toISOString(),
				};
				return Response.json(payload);
			},

			// Browser revoke: expires usable credentials for this codebase.
			DELETE: async ({
				request,
				params,
			}: {
				request: Request;
				params: { codebaseId: string };
			}) => {
				let user: { id: string };
				try {
					user = await requireUser(request.headers);
				} catch {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}
				const { codebaseId } = params;

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

				const codebase = await getGuardedCodebase(user.id, codebaseId);
				if (!codebase)
					return Response.json(
						{ error: "Codebase tidak ditemukan" },
						{ status: 404 },
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
							eq(codebaseSyncSessions.codebaseId, codebaseId),
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
