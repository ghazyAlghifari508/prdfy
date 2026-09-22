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

import { and, desc, eq, isNull, lt } from "drizzle-orm";
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
import {
	CODEBASE_MAX_CHUNK_BYTES,
	CODEBASE_SYNC_CLAIM_STALE_MS,
} from "./constants";
import { checkRateLimit } from "./rate-limit";

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

// Reads the request body behind the locked transport bound. The declared
// Content-Length is validated (finite non-negative integer) and checked
// before reading, but never trusted: the body is streamed with a running
// byte count so a chunked/undeclared body cannot materialize an unbounded
// string before the limit fires. Rejection closes the reader stream.
export async function readBoundedJson(
	request: Request,
): Promise<
	{ ok: true; body: unknown } | { ok: false; failure: UploadGuardFailure }
> {
	const contentLength = request.headers.get("content-length");
	if (contentLength !== null) {
		const declaredBytes = Number(contentLength);
		if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
			return fail(400, "Invalid Content-Length", "SYNC_FAILED");
		}
		if (declaredBytes > CODEBASE_MAX_CHUNK_BYTES) {
			return fail(
				413,
				"Upload chunk exceeds the 256 KiB transport bound",
				"SNAPSHOT_TOO_LARGE",
			);
		}
	}
	const reader = request.body?.getReader();
	if (!reader) {
		return fail(400, "Invalid JSON body", "SYNC_FAILED");
	}
	const pieces: Uint8Array[] = [];
	let totalBytes = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			totalBytes += value.byteLength;
			if (totalBytes > CODEBASE_MAX_CHUNK_BYTES) {
				await reader.cancel().catch(() => {});
				return fail(
					413,
					"Upload chunk exceeds the 256 KiB transport bound",
					"SNAPSHOT_TOO_LARGE",
				);
			}
			pieces.push(value);
		}
	} catch {
		return fail(400, "Invalid JSON body", "SYNC_FAILED");
	}
	const total = pieces.reduce((sum, piece) => sum + piece.byteLength, 0);
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const piece of pieces) {
		bytes.set(piece, offset);
		offset += piece.byteLength;
	}
	try {
		return {
			ok: true,
			body: JSON.parse(new TextDecoder().decode(bytes)) as unknown,
		};
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
		.where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
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

export type IdempotentClaim =
	| { status: "claimed" }
	| ({ status: "replay" } & IdempotentReplay)
	| { status: "in-progress" }
	| { status: "conflict" };

// Idempotent upload protocol (Task 9 hardening): the key is CLAIMED
// atomically BEFORE the mutation runs, so two concurrent retries of the same
// request can never both perform the upload — the loser observes the pending
// claim and either replays the winner's stored response (once finalized) or
// fails closed. Claim rows carry `statusCode = 0` as the pending sentinel;
// only 2xx/4xx/5xx finalize values are real. Callers must `finalize` after
// producing the response or `release` on any early return/throw, so a failed
// attempt never wedges the key in pending state for a legitimate retry.
// Lookup binds session/snapshot/kind: reusing one key across operations
// fails closed instead of replaying a foreign response.
const PENDING_CLAIM_STATUS = 0;

export async function claimIdempotency(input: {
	key: string;
	sessionId: string;
	snapshotId: string;
	kind: string;
}): Promise<IdempotentClaim> {
	const [inserted] = await db
		.insert(codebaseSyncIdempotencyKeys)
		.values({
			key: input.key,
			sessionId: input.sessionId,
			snapshotId: input.snapshotId,
			kind: input.kind,
			statusCode: PENDING_CLAIM_STATUS,
			response: {},
		})
		.onConflictDoNothing({ target: codebaseSyncIdempotencyKeys.key })
		.returning({ key: codebaseSyncIdempotencyKeys.key });
	if (inserted) return { status: "claimed" };

	const [existing] = await db
		.select({
			sessionId: codebaseSyncIdempotencyKeys.sessionId,
			snapshotId: codebaseSyncIdempotencyKeys.snapshotId,
			kind: codebaseSyncIdempotencyKeys.kind,
			statusCode: codebaseSyncIdempotencyKeys.statusCode,
			response: codebaseSyncIdempotencyKeys.response,
		})
		.from(codebaseSyncIdempotencyKeys)
		.where(eq(codebaseSyncIdempotencyKeys.key, input.key))
		.limit(1);
	// Row vanished between insert-conflict and select (cascade delete): the
	// owning session/snapshot is gone; fail closed rather than trust it.
	if (!existing) return { status: "conflict" };
	if (
		existing.sessionId !== input.sessionId ||
		existing.snapshotId !== input.snapshotId ||
		existing.kind !== input.kind
	) {
		return { status: "conflict" };
	}
	if (existing.statusCode === PENDING_CLAIM_STATUS) {
		// A pending claim only blocks while its owner is live. The CLI's
		// per-request timeout is 30s, so a pending row older than
		// CODEBASE_SYNC_CLAIM_STALE_MS was abandoned by a crashed request.
		// Atomically steal it (single update guarded on the still-pending
		// age): exactly one racing retry wins and proceeds as the claimant.
		const cutoff = new Date(Date.now() - CODEBASE_SYNC_CLAIM_STALE_MS);
		const [stolen] = await db
			.update(codebaseSyncIdempotencyKeys)
			.set({
				sessionId: input.sessionId,
				snapshotId: input.snapshotId,
				kind: input.kind,
				statusCode: PENDING_CLAIM_STATUS,
				response: {},
				createdAt: new Date(),
			})
			.where(
				and(
					eq(codebaseSyncIdempotencyKeys.key, input.key),
					eq(codebaseSyncIdempotencyKeys.statusCode, PENDING_CLAIM_STATUS),
					lt(codebaseSyncIdempotencyKeys.createdAt, cutoff),
				),
			)
			.returning({ key: codebaseSyncIdempotencyKeys.key });
		if (stolen) return { status: "claimed" };
		return { status: "in-progress" };
	}
	return {
		status: "replay",
		statusCode: existing.statusCode,
		response: existing.response,
	};
}

export async function finalizeIdempotencyClaim(input: {
	key: string;
	statusCode: number;
	response: Record<string, unknown>;
}): Promise<void> {
	await db
		.update(codebaseSyncIdempotencyKeys)
		.set({ statusCode: input.statusCode, response: input.response })
		.where(
			and(
				eq(codebaseSyncIdempotencyKeys.key, input.key),
				eq(codebaseSyncIdempotencyKeys.statusCode, PENDING_CLAIM_STATUS),
			),
		);
}

export async function releaseIdempotencyClaim(key: string): Promise<void> {
	await db
		.delete(codebaseSyncIdempotencyKeys)
		.where(
			and(
				eq(codebaseSyncIdempotencyKeys.key, key),
				eq(codebaseSyncIdempotencyKeys.statusCode, PENDING_CLAIM_STATUS),
			),
		);
}
