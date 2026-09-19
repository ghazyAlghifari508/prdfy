// Server-only guard for CLI sync transport endpoints (Task 5).
//
// Never import this module from client/isomorphic code: it imports the
// database client and Node crypto transitively. Route handlers import it
// directly, following the neighboring `/api/v1` top-level `{ db }` pattern.
//
// === Credential/scope separation (carry-over Task 4 → 5) ===
// These endpoints intentionally do NOT call `apiKeyAuth`/`hasScope` with
// `CODEBASE_SYNC_SCOPE`. The Bearer sync credential is authenticated ONLY
// against `codebase_sync_sessions.credential_hash` (SHA-256, project-bound):
// an ordinary API key (`api_keys.key` hash) never matches a credential hash
// and vice versa, so the two credential stores are structurally disjoint.
// The sync credential embodies the single `codebase:sync` capability by
// construction — it grants no `api_keys` scopes and reaches no other
// project — which is exactly what `hasSyncCapability` enforces on the
// API-key side. Validating scope here would check the wrong store; the
// project binding + session binding + usability checks below ARE the
// capability enforcement for this boundary.

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
	codebaseSnapshots,
	codebaseSyncIdempotencyKeys,
	codebaseSyncSessions,
	projects,
	subscriptions,
} from "@/db/schema";
import type { Plan } from "@/types/database";
import {
	assertAttemptBinding,
	CODEBASE_SYNC_RATE_LIMIT_ACTION,
	getSessionUsability,
	isSyncCapableProject,
	requireSupportedCliVersion,
	SyncBindingError,
} from "./codebase-sync";
import { hashSyncToken } from "./codebase-sync.server";
import { CODEBASE_MAX_CHUNK_BYTES } from "./constants";
import { checkRateLimit, recordRequest } from "./rate-limit";

export interface SyncUploadContext {
	session: typeof codebaseSyncSessions.$inferSelect;
	snapshot: typeof codebaseSnapshots.$inferSelect;
	userId: string;
}

export interface UploadGuardFailure {
	status: number;
	body: { error: string; code: string; retryAfter?: number };
}

type GuardResult =
	| { ok: true; ctx: SyncUploadContext }
	| { ok: false; failure: UploadGuardFailure };

function bearerToken(request: Request): string | null {
	const header = request.headers.get("Authorization");
	if (!header || !header.startsWith("Bearer ")) return null;
	const token = header.slice(7).trim();
	return token ? token : null;
}

function fail(
	status: number,
	error: string,
	code: string,
): { ok: false; failure: UploadGuardFailure } {
	return { ok: false, failure: { status, body: { error, code } } };
}

// Reads the request body as text behind the locked transport bound. Rejects
// oversized payloads (413) before JSON parsing so a hostile client cannot
// force unbounded memory allocation through these endpoints.
export async function readBoundedJson(
	request: Request,
): Promise<
	{ ok: true; body: unknown } | { ok: false; failure: UploadGuardFailure }
> {
	const contentLength = request.headers.get("content-length");
	if (
		contentLength !== null &&
		Number(contentLength) > CODEBASE_MAX_CHUNK_BYTES
	) {
		return fail(
			413,
			"Upload chunk exceeds the 256 KiB transport bound",
			"SNAPSHOT_TOO_LARGE",
		);
	}
	const text = await request.text().catch(() => null);
	if (text === null || text.length > CODEBASE_MAX_CHUNK_BYTES) {
		return fail(
			413,
			"Upload chunk exceeds the 256 KiB transport bound",
			"SNAPSHOT_TOO_LARGE",
		);
	}
	try {
		return { ok: true, body: JSON.parse(text) as unknown };
	} catch {
		return fail(400, "Invalid JSON body", "SYNC_FAILED");
	}
}

// Full per-request guard: Bearer sync credential + project/session binding +
// usability + ownership + sync-capable mode + rate limit + fail-closed CLI
// version check + bound snapshot lookup. Every upload endpoint runs this
// before touching snapshot data, so no check can be forgotten per-route.
export async function guardSyncUpload(
	request: Request,
	projectId: string,
	body: { sessionId: string; attemptId: string },
	options: { rateLimit?: boolean } = {},
): Promise<GuardResult> {
	const rawToken = bearerToken(request);
	if (!rawToken)
		return fail(401, "Invalid sync credential", "INVALID_SYNC_CREDENTIAL");

	// Credential lookup is project-bound: a token issued for one project
	// never authenticates another (uniform 401, no oracle). The raw token is
	// hashed immediately and never logged or stored.
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
		return fail(401, "Invalid sync credential", "INVALID_SYNC_CREDENTIAL");

	const usability = getSessionUsability(session);
	if (!usability.usable) {
		if (usability.code === "SYNC_SESSION_EXPIRED") {
			await db
				.update(codebaseSyncSessions)
				.set({ status: "expired", updatedAt: new Date() })
				.where(eq(codebaseSyncSessions.id, session.id));
			return fail(
				410,
				"Sync session expired. Create a new sync session.",
				"SYNC_SESSION_EXPIRED",
			);
		}
		return fail(
			401,
			"Sync credential is no longer valid",
			usability.code === "SYNC_CREDENTIAL_REVOKED"
				? "SYNC_CREDENTIAL_REVOKED"
				: "SYNC_SESSION_TERMINAL",
		);
	}

	// One session is one attempt: both ids must equal the bound session id.
	try {
		assertAttemptBinding(body.sessionId, body.attemptId);
		if (body.sessionId !== session.id || body.attemptId !== session.id) {
			throw new SyncBindingError();
		}
	} catch {
		return fail(401, "Invalid sync credential", "INVALID_SYNC_CREDENTIAL");
	}

	// Ownership flows through the credential owner; the project must still
	// exist, belong to that owner, and be an existing-codebase project.
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
		return fail(401, "Invalid sync credential", "INVALID_SYNC_CREDENTIAL");
	if (!isSyncCapableProject(project))
		return fail(
			400,
			"Project is not an existing-codebase project",
			"PROJECT_MODE_MISMATCH",
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
	if (options.rateLimit !== false) {
		const rateCheck = await checkRateLimit(
			session.userId,
			plan,
			CODEBASE_SYNC_RATE_LIMIT_ACTION,
		);
		if (!rateCheck.allowed)
			return {
				ok: false,
				failure: {
					status: 429,
					body: {
						error: "Too many requests",
						code: "SYNC_FAILED",
						retryAfter: 60,
					},
				},
			};
		await recordRequest(session.userId, CODEBASE_SYNC_RATE_LIMIT_ACTION);
	}

	// Fail-closed CLI version gate: the minimum version is enforced
	// server-side from the version recorded at handshake. Sessions without a
	// recorded version (pre-gate rows) are rejected rather than trusted.
	const metadata = session.metadata as { cliVersion?: unknown } | null;
	try {
		requireSupportedCliVersion(metadata?.cliVersion, session.cliMinVersion);
	} catch (error) {
		return fail(
			426,
			error instanceof Error ? error.message : "CLI update required",
			"CLI_UPDATE_REQUIRED",
		);
	}

	// The handshake binds exactly one uploading snapshot per session; uploads
	// before the handshake have no snapshot to attach to.
	const [snapshot] = await db
		.select()
		.from(codebaseSnapshots)
		.where(eq(codebaseSnapshots.syncSessionId, session.id))
		.orderBy(desc(codebaseSnapshots.createdAt))
		.limit(1);
	if (!snapshot)
		return fail(409, "Sync handshake required before upload", "SYNC_FAILED");

	return { ok: true, ctx: { session, snapshot, userId: session.userId } };
}

export interface IdempotentReplay {
	statusCode: number;
	response: unknown;
}

// Duplicate-request idempotent replay: a retried request carries the same
// idempotency key, so the stored response is returned without duplicating
// records. Callers verify the replayed payload's identity against stored
// state (isManifestReplayCompatible / isFileReplayCompatible /
// isCompleteReplayCompatible) BEFORE returning the replay — a divergent
// retry fails closed instead of silently succeeding.
export async function getIdempotentReplay(
	key: string,
): Promise<IdempotentReplay | null> {
	const [row] = await db
		.select({
			statusCode: codebaseSyncIdempotencyKeys.statusCode,
			response: codebaseSyncIdempotencyKeys.response,
		})
		.from(codebaseSyncIdempotencyKeys)
		.where(eq(codebaseSyncIdempotencyKeys.key, key))
		.limit(1);
	if (!row) return null;
	return { statusCode: row.statusCode, response: row.response };
}

// Stored responses are status payloads only (counts/ids) — never tokens or
// source content — so replay cannot leak snapshot data.
export async function storeIdempotentResponse(input: {
	key: string;
	sessionId: string;
	snapshotId: string;
	kind: string;
	statusCode: number;
	response: Record<string, unknown>;
}): Promise<void> {
	await db
		.insert(codebaseSyncIdempotencyKeys)
		.values({
			key: input.key,
			sessionId: input.sessionId,
			snapshotId: input.snapshotId,
			kind: input.kind,
			statusCode: input.statusCode,
			response: input.response,
		})
		.onConflictDoNothing({ target: codebaseSyncIdempotencyKeys.key });
}
