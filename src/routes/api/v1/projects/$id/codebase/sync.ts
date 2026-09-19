import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
	codebaseSnapshots,
	codebaseSyncSessions,
	projects,
	subscriptions,
} from "@/db/schema";
import {
	assertSyncTransition,
	CODEBASE_SYNC_RATE_LIMIT_ACTION,
	type CodebaseSyncStatus,
	cliHandshakeRequestSchema,
	cliHandshakeResponseSchema,
	getSessionUsability,
	isSyncCapableProject,
} from "@/lib/codebase-sync";
import { hashSyncToken } from "@/lib/codebase-sync.server";
import { checkRateLimit, recordRequest } from "@/lib/rate-limit";
import type { Plan } from "@/types/database";

function bearerToken(request: Request): string | null {
	const header = request.headers.get("Authorization");
	if (!header || !header.startsWith("Bearer ")) return null;
	const token = header.slice(7).trim();
	return token ? token : null;
}

export const Route = createFileRoute("/api/v1/projects/$id/codebase/sync")({
	server: {
		handlers: {
			// CLI handshake: `prdfy codebase sync --project-id <id>
			// --sync-token <token>` POSTs { cliVersion } with the short-lived
			// sync credential as Bearer auth. Bearer-only: ordinary API keys
			// are never accepted here (their value matches no credential
			// hash). Success binds session/attempt/snapshot identity and moves
			// waiting_for_cli -> connected; a repeated handshake is
			// idempotent. The CLI enforces the minimum version client-side
			// from the returned cliMinVersion.
			POST: async ({
				request,
				params,
			}: {
				request: Request;
				params: { id: string };
			}) => {
				const { id: projectId } = params;
				const rawToken = bearerToken(request);
				if (!rawToken)
					return Response.json(
						{
							error: "Invalid sync credential",
							code: "INVALID_SYNC_CREDENTIAL",
						},
						{ status: 401 },
					);

				// Credential lookup is project-bound: a token issued for one
				// project never authenticates another (uniform 401, no oracle).
				// The raw token is hashed immediately and never logged/stored.
				const [session] = await db
					.select()
					.from(codebaseSyncSessions)
					.where(
						and(
							eq(codebaseSyncSessions.credentialHash, hashSyncToken(rawToken)),
							eq(codebaseSyncSessions.projectId, projectId),
						),
					)
					.limit(1);
				if (!session)
					return Response.json(
						{
							error: "Invalid sync credential",
							code: "INVALID_SYNC_CREDENTIAL",
						},
						{ status: 401 },
					);

				const usability = getSessionUsability(session);
				if (!usability.usable) {
					if (usability.code === "SYNC_SESSION_EXPIRED") {
						await db
							.update(codebaseSyncSessions)
							.set({ status: "expired", updatedAt: new Date() })
							.where(eq(codebaseSyncSessions.id, session.id));
						return Response.json(
							{
								error: "Sync session expired. Create a new sync session.",
								code: "SYNC_SESSION_EXPIRED",
							},
							{ status: 410 },
						);
					}
					return Response.json(
						{
							error: "Sync credential is no longer valid",
							code:
								usability.code === "SYNC_CREDENTIAL_REVOKED"
									? "SYNC_CREDENTIAL_REVOKED"
									: "SYNC_SESSION_TERMINAL",
						},
						{ status: 401 },
					);
				}

				// Ownership flows through the credential owner; the project
				// must still exist, belong to that owner, and be an
				// existing-codebase project.
				const [project] = await db
					.select({
						id: projects.id,
						userId: projects.userId,
						projectMode: projects.projectMode,
					})
					.from(projects)
					.where(eq(projects.id, projectId))
					.limit(1);
				if (!project || project.userId !== session.userId)
					return Response.json(
						{
							error: "Invalid sync credential",
							code: "INVALID_SYNC_CREDENTIAL",
						},
						{ status: 401 },
					);
				if (!isSyncCapableProject(project))
					return Response.json(
						{
							error: "Project is not an existing-codebase project",
							code: "PROJECT_MODE_MISMATCH",
						},
						{ status: 400 },
					);

				const body = await request.json().catch(() => null);
				const parsedBody = cliHandshakeRequestSchema.safeParse(body);
				if (!parsedBody.success)
					return Response.json(
						{ error: "cliVersion is required", code: "SYNC_FAILED" },
						{ status: 400 },
					);

				const [sub] = await db
					.select({ plan: subscriptions.plan })
					.from(subscriptions)
					.where(eq(subscriptions.userId, session.userId))
					.orderBy(desc(subscriptions.createdAt))
					.limit(1);
				const rawPlan = sub?.plan || "free";
				const plan: Plan = ["free", "pro", "hengker"].includes(rawPlan)
					? (rawPlan as Plan)
					: "free";
				const rateCheck = await checkRateLimit(
					session.userId,
					plan,
					CODEBASE_SYNC_RATE_LIMIT_ACTION,
				);
				if (!rateCheck.allowed)
					return Response.json(
						{ error: "Too many requests", retryAfter: 60 },
						{ status: 429 },
					);
				await recordRequest(session.userId, CODEBASE_SYNC_RATE_LIMIT_ACTION);

				// waiting_for_cli -> connected exactly once; later handshakes
				// (CLI retries) keep the state and only refresh metadata.
				// Usability was verified above, so any remaining state is an
				// active non-terminal state safe to report as-is.
				let status = session.status as CodebaseSyncStatus;
				if (status === "waiting_for_cli") {
					assertSyncTransition(status, "connected");
					status = "connected";
				}
				const metadata =
					(session.metadata as Record<string, unknown> | null) ?? {};
				await db
					.update(codebaseSyncSessions)
					.set({
						status,
						metadata: { ...metadata, cliVersion: parsedBody.data.cliVersion },
						updatedAt: new Date(),
					})
					.where(eq(codebaseSyncSessions.id, session.id));

				// One snapshot per session: the handshake binds (not creates
				// duplicates on retry) the uploading snapshot for Task 5.
				const [existingSnapshot] = await db
					.select({ id: codebaseSnapshots.id })
					.from(codebaseSnapshots)
					.where(eq(codebaseSnapshots.syncSessionId, session.id))
					.orderBy(desc(codebaseSnapshots.createdAt))
					.limit(1);
				let snapshotId = existingSnapshot?.id;
				if (!snapshotId) {
					const [inserted] = await db
						.insert(codebaseSnapshots)
						.values({
							id: crypto.randomUUID(),
							projectId,
							syncSessionId: session.id,
							status: "uploading",
							fileCount: 0,
							excludedCount: 0,
							contentSize: 0,
						})
						.returning({ id: codebaseSnapshots.id });
					if (!inserted)
						return Response.json(
							{
								error: "Failed to initialize sync snapshot",
								code: "SYNC_FAILED",
							},
							{ status: 500 },
						);
					snapshotId = inserted.id;
				}

				// One session is one attempt: a retry mints a new session, so
				// the attempt identity is the session identity.
				const parsed = cliHandshakeResponseSchema.safeParse({
					sessionId: session.id,
					attemptId: session.id,
					snapshotId,
					status,
					cliMinVersion: session.cliMinVersion,
					expiresAt: session.expiresAt.toISOString(),
				});
				if (!parsed.success)
					return Response.json(
						{ error: "Failed to initialize sync session", code: "SYNC_FAILED" },
						{ status: 500 },
					);
				return Response.json(parsed.data);
			},
		},
	},
});
