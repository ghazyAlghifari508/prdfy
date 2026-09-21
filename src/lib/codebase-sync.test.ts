import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	applySessionRevocation,
	assertAttemptBinding,
	assertSyncTransition,
	buildIdempotencyKey,
	buildSyncCommand,
	CliVersionError,
	CODEBASE_ANALYSIS_STATUSES,
	CODEBASE_SNAPSHOT_STATUSES,
	CODEBASE_SYNC_RATE_LIMIT_ACTION,
	CODEBASE_SYNC_SCOPE,
	type CodebaseSyncStatus,
	canAccessSyncSession,
	canTransitionSyncStatus,
	checkSnapshotCompletion,
	cliHandshakeRequestSchema,
	cliHandshakeResponseSchema,
	codebaseAnalysisStatusSchema,
	fileChunkRequestSchema,
	getSessionUsability,
	hasSyncCapability,
	isCompleteReplayCompatible,
	isExpectedIdempotencyKey,
	isFileReplayCompatible,
	isManifestReplayCompatible,
	isSafeRelativePath,
	isSlotIdempotencyKey,
	isSupportedCliVersion,
	isSyncCapableProject,
	isTerminalSyncStatus,
	manifestBatchRequestSchema,
	manifestEntrySchema,
	requireSupportedCliVersion,
	SnapshotCompletionError,
	SyncBindingError,
	type SyncSessionLike,
	SyncTransitionError,
	sanitizeSyncErrorCode,
	sanitizeSyncErrorMessage,
	selectActiveSnapshot,
	shouldCreateSyncSession,
	snapshotCompleteRequestSchema,
	snapshotContextSchema,
	syncPromptPayloadSchema,
	syncStatusResponseSchema,
	toSessionMetadata,
	uploadTransitionSteps,
} from "./codebase-sync";
import {
	decodeBase64ByteLength,
	generateSyncToken,
	hashSyncToken,
	verifyFileContentHash,
} from "./codebase-sync.server";
import {
	CODEBASE_CLI_MIN_VERSION,
	CODEBASE_MAX_CHUNK_BYTES,
	CODEBASE_MAX_FILE_BYTES,
	CODEBASE_MAX_SNAPSHOT_BYTES,
	CODEBASE_SYNC_POLL_INTERVAL_MS,
	CODEBASE_SYNC_SESSION_EXPIRY_MS,
} from "./constants";

describe("codebase sync boundary constants (Locked MVP Decisions)", () => {
	it("polls browser status every 2000ms", () => {
		expect(CODEBASE_SYNC_POLL_INTERVAL_MS).toBe(2000);
	});

	it("expires a sync session after 30 minutes", () => {
		expect(CODEBASE_SYNC_SESSION_EXPIRY_MS).toBe(30 * 60 * 1000);
	});

	it("caps snapshot at 50 MiB, file at 1 MiB, chunk at 256 KiB", () => {
		expect(CODEBASE_MAX_SNAPSHOT_BYTES).toBe(50 * 1024 * 1024);
		expect(CODEBASE_MAX_FILE_BYTES).toBe(1024 * 1024);
		expect(CODEBASE_MAX_CHUNK_BYTES).toBe(256 * 1024);
	});

	it("requires CLI 2.0.0 or newer", () => {
		expect(CODEBASE_CLI_MIN_VERSION).toBe("2.0.0");
	});
});

describe("sync state transitions", () => {
	const chain: CodebaseSyncStatus[] = [
		"waiting_for_cli",
		"connected",
		"scanning",
		"filtering",
		"uploading",
		"uploaded",
		"analyzing",
		"ready",
	];

	it("accepts every step of the happy-path chain", () => {
		for (let i = 0; i < chain.length - 1; i++) {
			expect(canTransitionSyncStatus(chain[i], chain[i + 1])).toBe(true);
			expect(() => assertSyncTransition(chain[i], chain[i + 1])).not.toThrow();
		}
	});

	it("treats ready, failed, and expired as terminal", () => {
		expect(isTerminalSyncStatus("ready")).toBe(true);
		expect(isTerminalSyncStatus("failed")).toBe(true);
		expect(isTerminalSyncStatus("expired")).toBe(true);
		expect(isTerminalSyncStatus("uploading")).toBe(false);
	});

	it("rejects any transition out of a terminal state", () => {
		const terminals: CodebaseSyncStatus[] = ["ready", "failed", "expired"];
		for (const from of terminals) {
			expect(canTransitionSyncStatus(from, "scanning")).toBe(false);
			expect(() => assertSyncTransition(from, "scanning")).toThrow(
				SyncTransitionError,
			);
		}
	});

	it("rejects backward and skipping transitions with a typed error", () => {
		expect(canTransitionSyncStatus("uploading", "scanning")).toBe(false);
		expect(canTransitionSyncStatus("waiting_for_cli", "ready")).toBe(false);

		try {
			assertSyncTransition("uploading", "scanning");
			expect.unreachable("expected SyncTransitionError");
		} catch (error) {
			expect(error).toBeInstanceOf(SyncTransitionError);
			const typed = error as SyncTransitionError;
			expect(typed.from).toBe("uploading");
			expect(typed.to).toBe("scanning");
			expect(typed.code).toBe("INVALID_SYNC_TRANSITION");
		}
	});

	it("allows any active state to fail", () => {
		const active: CodebaseSyncStatus[] = [
			"waiting_for_cli",
			"connected",
			"scanning",
			"filtering",
			"uploading",
			"uploaded",
			"analyzing",
		];
		for (const from of active) {
			expect(canTransitionSyncStatus(from, "failed")).toBe(true);
		}
	});
});

describe("sync prompt payload DTO", () => {
	it("accepts a complete prompt payload", () => {
		const result = syncPromptPayloadSchema.safeParse({
			projectId: "proj_123",
			apiBaseUrl: "https://prdfy.example.com",
			syncToken: "placeholder-sync-token",
			cliMinVersion: "2.0.0",
			syncCommand:
				"prdfy codebase sync --project-id proj_123 --sync-token <token>",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
		});
		expect(result.success).toBe(true);
	});

	it("rejects a payload missing the sync credential", () => {
		const result = syncPromptPayloadSchema.safeParse({
			projectId: "proj_123",
			apiBaseUrl: "https://prdfy.example.com",
			cliMinVersion: "2.0.0",
			syncCommand: "prdfy codebase sync",
			expiresAt: new Date().toISOString(),
		});
		expect(result.success).toBe(false);
	});
});

describe("manifest entry DTO", () => {
	const validHash = "a".repeat(64);

	it("accepts a safe relative entry", () => {
		const result = manifestEntrySchema.safeParse({
			path: "src/lib/codebase-sync.ts",
			size: 1024,
			hash: validHash,
			language: "typescript",
		});
		expect(result.success).toBe(true);
	});

	it("rejects absolute and escaping paths", () => {
		for (const path of [
			"/etc/passwd",
			"../outside.ts",
			"a/../../b.ts",
			"",
			"C:\\repo\\evil.ts",
			"foo\\..\\evil.ts",
		]) {
			const result = manifestEntrySchema.safeParse({
				path,
				size: 10,
				hash: validHash,
			});
			expect(result.success).toBe(false);
		}
	});

	it("rejects files larger than the per-file limit", () => {
		const result = manifestEntrySchema.safeParse({
			path: "src/big.ts",
			size: CODEBASE_MAX_FILE_BYTES + 1,
			hash: validHash,
		});
		expect(result.success).toBe(false);
	});
});

describe("isSafeRelativePath", () => {
	it("accepts normalized repository-relative paths", () => {
		expect(isSafeRelativePath("src/index.ts")).toBe(true);
		expect(isSafeRelativePath("README.md")).toBe(true);
	});

	it("rejects absolute paths, escapes, and empty values", () => {
		expect(isSafeRelativePath("/abs/path.ts")).toBe(false);
		expect(isSafeRelativePath("../escape.ts")).toBe(false);
		expect(isSafeRelativePath("a/../../b.ts")).toBe(false);
		expect(isSafeRelativePath("")).toBe(false);
	});

	it("rejects Windows absolute, UNC, and backslash-traversal paths", () => {
		expect(isSafeRelativePath("\\abs\\path.ts")).toBe(false);
		expect(isSafeRelativePath("\\\\share\\file.ts")).toBe(false);
		expect(isSafeRelativePath("foo\\bar\\..\\evil.ts")).toBe(false);
		expect(isSafeRelativePath("C:\\repo\\file.ts")).toBe(false);
		expect(isSafeRelativePath("C:relative\\evil.ts")).toBe(false);
	});
});

describe("sync status response DTO", () => {
	it("accepts a status response with optional analysis linkage", () => {
		const result = syncStatusResponseSchema.safeParse({
			projectId: "proj_123",
			sessionId: "sess_123",
			status: "uploading",
			fileCount: 12,
			excludedCount: 3,
			analysisId: null,
		});
		expect(result.success).toBe(true);
	});

	it("rejects unknown statuses", () => {
		const result = syncStatusResponseSchema.safeParse({
			projectId: "proj_123",
			sessionId: "sess_123",
			status: "percent_42",
		});
		expect(result.success).toBe(false);
	});
});

describe("snapshot context DTO", () => {
	it("accepts a snapshot identity with counts", () => {
		const result = snapshotContextSchema.safeParse({
			snapshotId: "snap_123",
			projectId: "proj_123",
			branch: "main",
			fileCount: 10,
			excludedCount: 2,
		});
		expect(result.success).toBe(true);
	});

	it("rejects snapshot context without identity", () => {
		expect(
			snapshotContextSchema.safeParse({ projectId: "proj_123" }).success,
		).toBe(false);
		expect(
			snapshotContextSchema.safeParse({ snapshotId: "snap_123" }).success,
		).toBe(false);
	});
});

describe("hashSyncToken", () => {
	it("hashes deterministically to hex without exposing the raw token", () => {
		const first = hashSyncToken("placeholder-sync-token");
		const second = hashSyncToken("placeholder-sync-token");
		expect(first).toBe(second);
		expect(first).toMatch(/^[0-9a-f]{64}$/);
		expect(first).not.toContain("placeholder-sync-token");
	});

	it("produces distinct hashes for distinct tokens", () => {
		expect(hashSyncToken("placeholder-token-a")).not.toBe(
			hashSyncToken("placeholder-token-b"),
		);
	});
});

describe("selectActiveSnapshot", () => {
	const snapshots = [
		{
			id: "snap_1",
			status: "ready" as const,
			createdAt: "2026-01-01T00:00:00.000Z",
		},
		{
			id: "snap_2",
			status: "ready" as const,
			createdAt: "2026-02-01T00:00:00.000Z",
		},
	];

	it("defaults to the first successful snapshot", () => {
		expect(selectActiveSnapshot(snapshots)?.id).toBe("snap_1");
	});

	it("uses the latest user-selected ready snapshot when chosen", () => {
		expect(selectActiveSnapshot(snapshots, "snap_2")?.id).toBe("snap_2");
	});

	it("ignores a selected snapshot that is not ready", () => {
		const withPending = [
			...snapshots,
			{
				id: "snap_3",
				status: "uploading" as const,
				createdAt: "2026-03-01T00:00:00.000Z",
			},
		];
		expect(selectActiveSnapshot(withPending, "snap_3")?.id).toBe("snap_1");
	});

	it("returns null when no snapshot is ready", () => {
		expect(selectActiveSnapshot([])).toBeNull();
	});
});

describe("snapshot and analysis status vocabularies", () => {
	it("covers the persisted snapshot default", () => {
		expect(
			(CODEBASE_SNAPSHOT_STATUSES as readonly string[]).includes("uploading"),
		).toBe(true);
	});

	it("covers the persisted analysis default", () => {
		expect(
			(CODEBASE_ANALYSIS_STATUSES as readonly string[]).includes("pending"),
		).toBe(true);
	});
});

describe("sync capability scope (Task 4)", () => {
	it("defines a dedicated narrow scope distinct from auto-key scopes", () => {
		expect(CODEBASE_SYNC_SCOPE).toBe("codebase:sync");
		expect(CODEBASE_SYNC_SCOPE).not.toBe("read:project");
		expect(CODEBASE_SYNC_SCOPE).not.toBe("write:task:status");
	});

	it("grants sync capability only to the dedicated scope, admin, or wildcard", () => {
		expect(hasSyncCapability([CODEBASE_SYNC_SCOPE])).toBe(true);
		expect(hasSyncCapability(["admin"])).toBe(true);
		expect(hasSyncCapability(["*"])).toBe(true);
	});

	it("rejects ordinary auto-key scopes and empty scope sets", () => {
		expect(hasSyncCapability(["read:project"])).toBe(false);
		expect(hasSyncCapability(["read:project", "write:task:status"])).toBe(
			false,
		);
		expect(hasSyncCapability([])).toBe(false);
		expect(hasSyncCapability(null)).toBe(false);
		expect(hasSyncCapability(undefined)).toBe(false);
	});

	it("rate-limits sync endpoints with the neighboring api_call convention", () => {
		expect(CODEBASE_SYNC_RATE_LIMIT_ACTION).toBe("api_call");
	});
});

describe("sync session usability (Task 4)", () => {
	const base: SyncSessionLike = {
		id: "sess_1",
		projectId: "proj_1",
		userId: "user_1",
		status: "waiting_for_cli",
		expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
		consumedAt: null,
	};

	it("treats a fresh active session as usable", () => {
		expect(getSessionUsability(base, new Date()).usable).toBe(true);
	});

	it("rejects an expired session without echoing credentials", () => {
		const expired = {
			...base,
			expiresAt: new Date(Date.now() - 1000).toISOString(),
		};
		const result = getSessionUsability(expired, new Date());
		expect(result.usable).toBe(false);
		if (!result.usable) {
			expect(result.code).toBe("SYNC_SESSION_EXPIRED");
			expect(result.httpStatus).toBe(410);
		}
		expect(JSON.stringify(result)).not.toContain("placeholder");
	});

	it("rejects a consumed session after completion or revocation", () => {
		const consumed = { ...base, consumedAt: new Date().toISOString() };
		const result = getSessionUsability(consumed, new Date());
		expect(result.usable).toBe(false);
		if (!result.usable) {
			expect(result.code).toBe("SYNC_CREDENTIAL_REVOKED");
			expect(result.httpStatus).toBe(401);
		}
	});

	it("rejects terminal sessions even before expiry", () => {
		for (const status of ["ready", "failed", "expired"] as const) {
			const result = getSessionUsability({ ...base, status }, new Date());
			expect(result.usable).toBe(false);
		}
	});
});

describe("sync session ownership and project binding (Task 4)", () => {
	const session: SyncSessionLike = {
		id: "sess_1",
		projectId: "proj_1",
		userId: "user_1",
		status: "waiting_for_cli",
		expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
		consumedAt: null,
	};

	it("allows the owning user on the bound project", () => {
		expect(canAccessSyncSession(session, "user_1", "proj_1")).toBe(true);
	});

	it("rejects a different user on the same project", () => {
		expect(canAccessSyncSession(session, "user_2", "proj_1")).toBe(false);
	});

	it("rejects the owner presenting a different project (wrong-project binding)", () => {
		expect(canAccessSyncSession(session, "user_1", "proj_2")).toBe(false);
	});

	it("requires an existing_codebase project mode", () => {
		expect(isSyncCapableProject({ projectMode: "existing_codebase" })).toBe(
			true,
		);
		expect(isSyncCapableProject({ projectMode: "greenfield" })).toBe(false);
		expect(isSyncCapableProject({ projectMode: null })).toBe(false);
		expect(isSyncCapableProject({})).toBe(false);
	});
});

describe("one-active-session and retry semantics (Task 4)", () => {
	const active: SyncSessionLike = {
		id: "sess_active",
		projectId: "proj_1",
		userId: "user_1",
		status: "waiting_for_cli",
		expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
		consumedAt: null,
	};
	const expired: SyncSessionLike = {
		...active,
		id: "sess_old",
		status: "expired",
		expiresAt: new Date(Date.now() - 1000).toISOString(),
	};

	it("creates when no session exists", () => {
		expect(shouldCreateSyncSession([], new Date())).toBe(true);
	});

	it("refuses a second credential while one is still usable", () => {
		expect(shouldCreateSyncSession([expired, active], new Date())).toBe(false);
	});

	it("allows a retry credential once prior sessions are terminal or expired", () => {
		expect(shouldCreateSyncSession([expired], new Date())).toBe(true);
	});

	it("revocation expires the credential and stamps consumption", () => {
		const revoked = applySessionRevocation(
			active,
			new Date("2026-09-19T00:00:00.000Z"),
		);
		expect(revoked.status).toBe("expired");
		expect(revoked.consumedAt).toEqual(new Date("2026-09-19T00:00:00.000Z"));
		expect(revoked.id).toBe(active.id);
		expect(revoked.projectId).toBe(active.projectId);
		expect(getSessionUsability(revoked, new Date()).usable).toBe(false);
	});

	it("exposes session metadata without any credential material", () => {
		const metadata = toSessionMetadata({
			...active,
			credentialHash: "hash-value",
		});
		expect(metadata.sessionId).toBe(active.id);
		expect(metadata.status).toBe(active.status);
		expect("credentialHash" in metadata).toBe(false);
		expect("syncToken" in metadata).toBe(false);
		expect(JSON.stringify(metadata)).not.toContain("hash-value");
	});
});

describe("sync credential generation and hash-only persistence (Task 4)", () => {
	it("generates a 64-char hex credential", () => {
		const token = generateSyncToken();
		expect(token).toMatch(/^[0-9a-f]{64}$/);
	});

	it("generates unique credentials", () => {
		const seen = new Set(Array.from({ length: 50 }, () => generateSyncToken()));
		expect(seen.size).toBe(50);
	});

	it("never stores the raw credential alongside its hash", () => {
		const raw = generateSyncToken();
		const stored = hashSyncToken(raw);
		expect(stored).not.toContain(raw);
		expect(stored).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe("safe sync errors and CLI version gate (Task 4)", () => {
	it("passes through known safe error codes", () => {
		expect(sanitizeSyncErrorCode("SYNC_SESSION_EXPIRED")).toBe(
			"SYNC_SESSION_EXPIRED",
		);
		expect(sanitizeSyncErrorCode("INVALID_SYNC_CREDENTIAL")).toBe(
			"INVALID_SYNC_CREDENTIAL",
		);
	});

	it("collapses unknown codes to a generic failure without payload echo", () => {
		expect(sanitizeSyncErrorCode("E_CONN_RESET db password=hunter2")).toBe(
			"SYNC_FAILED",
		);
		expect(sanitizeSyncErrorCode("")).toBe("SYNC_FAILED");
		expect(sanitizeSyncErrorCode(null)).toBe("SYNC_FAILED");
		expect(sanitizeSyncErrorCode(undefined)).toBe("SYNC_FAILED");
	});

	it("gates CLI versions against the locked minimum", () => {
		expect(isSupportedCliVersion("2.0.0", "2.0.0")).toBe(true);
		expect(isSupportedCliVersion("2.1.0", "2.0.0")).toBe(true);
		expect(isSupportedCliVersion("1.9.9", "2.0.0")).toBe(false);
		expect(isSupportedCliVersion("2.0.0", "2.0.1")).toBe(false);
		expect(isSupportedCliVersion("not-a-version", "2.0.0")).toBe(false);
	});

	it("builds the locked sync command with a placeholder, never a raw token", () => {
		const raw = generateSyncToken();
		const command = buildSyncCommand("proj_123");
		expect(command).toBe(
			"prdfy codebase sync --project-id proj_123 --sync-token <token>",
		);
		expect(command).not.toContain(raw);
	});
});

describe("CLI handshake DTOs (Task 4)", () => {
	it("accepts a handshake body carrying only the CLI version", () => {
		const result = cliHandshakeRequestSchema.safeParse({
			cliVersion: "2.0.0",
		});
		expect(result.success).toBe(true);
	});

	it("rejects a handshake body without a CLI version", () => {
		expect(cliHandshakeRequestSchema.safeParse({}).success).toBe(false);
		expect(
			cliHandshakeRequestSchema.safeParse({ cliVersion: "" }).success,
		).toBe(false);
	});

	it("accepts the bound attempt/snapshot handshake response", () => {
		const result = cliHandshakeResponseSchema.safeParse({
			sessionId: "sess_1",
			attemptId: "sess_1",
			snapshotId: "snap_1",
			status: "connected",
			cliMinVersion: "2.0.0",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
		});
		expect(result.success).toBe(true);
	});

	it("rejects a handshake response missing snapshot identity", () => {
		const result = cliHandshakeResponseSchema.safeParse({
			sessionId: "sess_1",
			attemptId: "sess_1",
			status: "connected",
			cliMinVersion: "2.0.0",
			expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
		});
		expect(result.success).toBe(false);
	});
});

describe("manifest batch upload DTO (Task 5)", () => {
	const entry = {
		path: "src/lib/a.ts",
		size: 10,
		hash: "a".repeat(64),
		language: "typescript",
	};
	const base = {
		sessionId: "sess_1",
		attemptId: "sess_1",
		batchIndex: 0,
		batchTotal: 1,
		entries: [entry],
		idempotencyKey: "sess_1:manifest:0",
	};

	it("accepts the exact CLI manifest batch shape", () => {
		expect(manifestBatchRequestSchema.safeParse(base).success).toBe(true);
	});

	it("accepts an empty entries batch for a zero-file repository", () => {
		const result = manifestBatchRequestSchema.safeParse({
			...base,
			entries: [],
			batchTotal: 1,
		});
		expect(result.success).toBe(true);
	});

	it("rejects batchIndex at or beyond batchTotal", () => {
		expect(
			manifestBatchRequestSchema.safeParse({ ...base, batchIndex: 1 }).success,
		).toBe(false);
		expect(
			manifestBatchRequestSchema.safeParse({ ...base, batchTotal: 0 }).success,
		).toBe(false);
	});

	it("rejects entries with unsafe paths, oversized files, or bad hashes", () => {
		expect(
			manifestBatchRequestSchema.safeParse({
				...base,
				entries: [{ ...entry, path: "../escape.ts" }],
			}).success,
		).toBe(false);
		expect(
			manifestBatchRequestSchema.safeParse({
				...base,
				entries: [{ ...entry, size: CODEBASE_MAX_FILE_BYTES + 1 }],
			}).success,
		).toBe(false);
		expect(
			manifestBatchRequestSchema.safeParse({
				...base,
				entries: [{ ...entry, hash: "not-a-hash" }],
			}).success,
		).toBe(false);
	});

	it("rejects a batch without an idempotency key", () => {
		const { idempotencyKey: _dropped, ...withoutKey } = base;
		expect(manifestBatchRequestSchema.safeParse(withoutKey).success).toBe(
			false,
		);
	});
});

describe("file chunk upload DTO (Task 5)", () => {
	const base64 = Buffer.from("console.log('a');").toString("base64");
	const base = {
		sessionId: "sess_1",
		attemptId: "sess_1",
		path: "src/lib/a.ts",
		chunkIndex: 0,
		chunkTotal: 1,
		encoding: "base64" as const,
		data: base64,
		contentHash: "a".repeat(64),
		idempotencyKey: "sess_1:file:0",
	};

	it("accepts the exact CLI file chunk shape", () => {
		expect(fileChunkRequestSchema.safeParse(base).success).toBe(true);
	});

	it("rejects non-base64 encodings and empty payloads", () => {
		expect(
			fileChunkRequestSchema.safeParse({ ...base, encoding: "utf8" }).success,
		).toBe(false);
		expect(
			fileChunkRequestSchema.safeParse({ ...base, data: "" }).success,
		).toBe(false);
	});

	it("rejects chunk payloads beyond the 256 KiB transport bound", () => {
		expect(
			fileChunkRequestSchema.safeParse({
				...base,
				data: "a".repeat(CODEBASE_MAX_CHUNK_BYTES + 1),
			}).success,
		).toBe(false);
	});

	it("rejects chunkIndex at or beyond chunkTotal", () => {
		expect(
			fileChunkRequestSchema.safeParse({ ...base, chunkIndex: 1 }).success,
		).toBe(false);
		expect(
			fileChunkRequestSchema.safeParse({ ...base, chunkTotal: 0 }).success,
		).toBe(false);
	});

	it("rejects unsafe paths and malformed content hashes", () => {
		expect(
			fileChunkRequestSchema.safeParse({ ...base, path: "/abs/evil.ts" })
				.success,
		).toBe(false);
		expect(
			fileChunkRequestSchema.safeParse({
				...base,
				contentHash: "short",
			}).success,
		).toBe(false);
	});
});

describe("snapshot completion DTO (Task 5)", () => {
	const base = {
		sessionId: "sess_1",
		attemptId: "sess_1",
		fileCount: 2,
		excludedCount: 5,
		idempotencyKey: "sess_1:complete:0",
	};

	it("accepts the exact CLI completion shape", () => {
		expect(snapshotCompleteRequestSchema.safeParse(base).success).toBe(true);
	});

	it("rejects negative counts and missing keys", () => {
		expect(
			snapshotCompleteRequestSchema.safeParse({ ...base, fileCount: -1 })
				.success,
		).toBe(false);
		expect(
			snapshotCompleteRequestSchema.safeParse({ ...base, excludedCount: -1 })
				.success,
		).toBe(false);
		const { idempotencyKey: _dropped, ...withoutKey } = base;
		expect(snapshotCompleteRequestSchema.safeParse(withoutKey).success).toBe(
			false,
		);
	});
});

describe("idempotency key binding (Task 5)", () => {
	it("builds keys in the CLI attemptId-kind-index format", () => {
		expect(buildIdempotencyKey("sess_1", "manifest", 0)).toBe(
			"sess_1:manifest:0",
		);
		expect(buildIdempotencyKey("sess_1", "file", 3)).toBe("sess_1:file:3");
		expect(buildIdempotencyKey("sess_1", "complete", 0)).toBe(
			"sess_1:complete:0",
		);
	});

	it("accepts file keys by slot format (CLI flat sequence is client-side)", () => {
		// The CLI numbers file keys by its own flat chunk sequence, which the
		// server cannot reconstruct — so the files endpoint binds the
		// `${attemptId}:file:<n>` shape instead of an exact index. Exact
		// replay still matches the stored key byte-for-byte.
		expect(isSlotIdempotencyKey("sess_1:file:0", "sess_1", "file")).toBe(true);
		expect(isSlotIdempotencyKey("sess_1:file:42", "sess_1", "file")).toBe(true);
		expect(isSlotIdempotencyKey("sess_1:manifest:0", "sess_1", "file")).toBe(
			false,
		);
		expect(isSlotIdempotencyKey("sess_2:file:0", "sess_1", "file")).toBe(false);
		expect(isSlotIdempotencyKey("sess_1:file:x", "sess_1", "file")).toBe(false);
		expect(isSlotIdempotencyKey("", "sess_1", "file")).toBe(false);
	});

	it("accepts only the exact key for its attempt slot", () => {
		expect(
			isExpectedIdempotencyKey("sess_1:manifest:0", "sess_1", "manifest", 0),
		).toBe(true);
		expect(
			isExpectedIdempotencyKey("sess_1:manifest:1", "sess_1", "manifest", 0),
		).toBe(false);
		expect(
			isExpectedIdempotencyKey("sess_1:file:0", "sess_1", "manifest", 0),
		).toBe(false);
		expect(
			isExpectedIdempotencyKey("sess_2:manifest:0", "sess_1", "manifest", 0),
		).toBe(false);
		expect(isExpectedIdempotencyKey("", "sess_1", "manifest", 0)).toBe(false);
	});
});

describe("replay-payload identity (Task 9)", () => {
	const entry = {
		path: "src/index.ts",
		size: 120,
		hash: "a".repeat(64),
		language: "TypeScript",
	};

	it("accepts replays whose entries are all present with stored identity", () => {
		const stored = [
			entry,
			{ path: "src/other.ts", size: 10, hash: "b".repeat(64) },
		];
		// Multi-batch retry: batch 0 replayed after batch 1 already merged.
		expect(isManifestReplayCompatible(stored, [entry])).toBe(true);
		expect(isManifestReplayCompatible(stored, stored)).toBe(true);
		expect(isManifestReplayCompatible(stored, [])).toBe(false);
		expect(isManifestReplayCompatible([], [])).toBe(true);
	});

	it("rejects replays larger than the stored manifest (forged batches)", () => {
		const stored = [entry];
		expect(
			isManifestReplayCompatible(stored, [
				entry,
				{ path: "src/other.ts", size: 10, hash: "b".repeat(64) },
			]),
		).toBe(false);
	});

	it("rejects manifest replays with missing or divergent entries", () => {
		const stored = [entry];
		expect(isManifestReplayCompatible(stored, [{ ...entry, size: 121 }])).toBe(
			false,
		);
		expect(
			isManifestReplayCompatible(stored, [{ ...entry, hash: "c".repeat(64) }]),
		).toBe(false);
		expect(
			isManifestReplayCompatible(stored, [
				{ ...entry, language: "JavaScript" },
			]),
		).toBe(false);
		expect(
			isManifestReplayCompatible(stored, [
				{ path: "src/new.ts", size: 1, hash: "d".repeat(64) },
			]),
		).toBe(false);
	});

	it("treats manifest hashes case-insensitively like the merge path", () => {
		const stored = [entry];
		expect(
			isManifestReplayCompatible(stored, [{ ...entry, hash: "A".repeat(64) }]),
		).toBe(true);
	});

	it("accepts byte-identical file chunk replays only", () => {
		const replayed = {
			path: "src/index.ts",
			chunkIndex: 0,
			chunkTotal: 2,
			contentHash: "a".repeat(64),
			data: "aGVsbG8=",
		};
		const stored = [{ ...replayed }];
		expect(isFileReplayCompatible(stored, replayed)).toBe(true);
		expect(
			isFileReplayCompatible(stored, { ...replayed, data: "d29ybGQ=" }),
		).toBe(false);
		expect(
			isFileReplayCompatible(stored, {
				...replayed,
				contentHash: "b".repeat(64),
			}),
		).toBe(false);
		expect(isFileReplayCompatible(stored, { ...replayed, chunkTotal: 3 })).toBe(
			false,
		);
		expect(isFileReplayCompatible(stored, { ...replayed, chunkIndex: 1 })).toBe(
			false,
		);
		expect(
			isFileReplayCompatible(stored, { ...replayed, path: "src/x.ts" }),
		).toBe(false);
		expect(isFileReplayCompatible([], replayed)).toBe(false);
	});

	it("accepts completion replays with identical counts only", () => {
		expect(
			isCompleteReplayCompatible(
				{ fileCount: 3, excludedCount: 7 },
				{ fileCount: 3, excludedCount: 7 },
			),
		).toBe(true);
		expect(
			isCompleteReplayCompatible(
				{ fileCount: 3, excludedCount: 7 },
				{ fileCount: 4, excludedCount: 7 },
			),
		).toBe(false);
		expect(
			isCompleteReplayCompatible(
				{ fileCount: 3, excludedCount: 7 },
				{ fileCount: 3, excludedCount: 8 },
			),
		).toBe(false);
	});
});

describe("sync attempt binding (Task 5)", () => {
	it("accepts the session-owned attempt identity", () => {
		expect(() => assertAttemptBinding("sess_1", "sess_1")).not.toThrow();
	});

	it("rejects a foreign attempt with a credential-safe typed error", () => {
		try {
			assertAttemptBinding("sess_1", "sess_2");
			expect.unreachable("expected SyncBindingError");
		} catch (error) {
			expect(error).toBeInstanceOf(SyncBindingError);
			const typed = error as SyncBindingError;
			expect(typed.code).toBe("INVALID_SYNC_CREDENTIAL");
			expect(typed.message).not.toContain("sess_2");
		}
	});
});

describe("upload session advancement (Task 5)", () => {
	it("walks connected through scanning/filtering to uploading", () => {
		const steps = uploadTransitionSteps("connected");
		expect(steps).toEqual([
			["connected", "scanning"],
			["scanning", "filtering"],
			["filtering", "uploading"],
		]);
		for (const [from, to] of steps) {
			expect(canTransitionSyncStatus(from, to)).toBe(true);
		}
	});

	it("shortens the walk for sessions already mid-chain", () => {
		expect(uploadTransitionSteps("scanning")).toEqual([
			["scanning", "filtering"],
			["filtering", "uploading"],
		]);
		expect(uploadTransitionSteps("filtering")).toEqual([
			["filtering", "uploading"],
		]);
		expect(uploadTransitionSteps("uploading")).toEqual([]);
	});

	it("refuses uploads before handshake or after upload completion", () => {
		for (const status of [
			"waiting_for_cli",
			"uploaded",
			"analyzing",
			"ready",
			"failed",
			"expired",
		] as const) {
			expect(() => uploadTransitionSteps(status)).toThrow(SyncTransitionError);
		}
	});
});

describe("snapshot completion verification (Task 5)", () => {
	const hashFor = (text: string): string =>
		createHash("sha256").update(text, "utf8").digest("hex");

	const fileA = "console.log('a');";
	const fileB = "export const b = 1;";
	const manifest = [
		{ path: "src/a.ts", size: fileA.length, hash: hashFor(fileA) },
		{ path: "src/b.ts", size: fileB.length, hash: hashFor(fileB) },
	];
	const chunks = [
		{
			path: "src/a.ts",
			chunkIndex: 0,
			chunkTotal: 1,
			dataBase64Length: 24,
			decodedBytes: fileA.length,
		},
		{
			path: "src/b.ts",
			chunkIndex: 0,
			chunkTotal: 1,
			dataBase64Length: 28,
			decodedBytes: fileB.length,
		},
	];

	it("accepts a complete snapshot and reports measured content size", () => {
		const result = checkSnapshotCompletion({
			manifest,
			chunks,
			fileCount: 2,
			excludedCount: 5,
		});
		expect(result.files).toHaveLength(2);
		expect(result.contentSize).toBe(fileA.length + fileB.length);
	});

	it("enforces the locked count definition (fileCount = eligible entries)", () => {
		try {
			checkSnapshotCompletion({
				manifest,
				chunks,
				fileCount: 1,
				excludedCount: 5,
			});
			expect.unreachable("expected SnapshotCompletionError");
		} catch (error) {
			expect(error).toBeInstanceOf(SnapshotCompletionError);
			expect((error as SnapshotCompletionError).code).toBe(
				"SNAPSHOT_INCOMPLETE",
			);
		}
	});

	it("rejects snapshots with missing or gapped chunks", () => {
		expect(() =>
			checkSnapshotCompletion({
				manifest,
				chunks: chunks.slice(0, 1),
				fileCount: 2,
				excludedCount: 0,
			}),
		).toThrow(SnapshotCompletionError);
		const gapped = [
			{
				path: "src/a.ts",
				chunkIndex: 0,
				chunkTotal: 2,
				dataBase64Length: 12,
				decodedBytes: 9,
			},
		];
		try {
			checkSnapshotCompletion({
				manifest: [manifest[0]],
				chunks: gapped,
				fileCount: 1,
				excludedCount: 0,
			});
			expect.unreachable("expected SnapshotCompletionError");
		} catch (error) {
			expect((error as SnapshotCompletionError).code).toBe(
				"SNAPSHOT_INCOMPLETE",
			);
		}
	});

	it("rejects orphan chunks for paths absent from the manifest", () => {
		try {
			checkSnapshotCompletion({
				manifest,
				chunks: [
					...chunks,
					{
						path: "src/evil.ts",
						chunkIndex: 0,
						chunkTotal: 1,
						dataBase64Length: 8,
						decodedBytes: 6,
					},
				],
				fileCount: 2,
				excludedCount: 0,
			});
			expect.unreachable("expected SnapshotCompletionError");
		} catch (error) {
			expect((error as SnapshotCompletionError).code).toBe("SNAPSHOT_CONFLICT");
		}
	});

	it("rejects files beyond 1 MiB and snapshots beyond 50 MiB", () => {
		expect(() =>
			checkSnapshotCompletion({
				manifest: [
					{
						path: "src/big.ts",
						size: CODEBASE_MAX_FILE_BYTES + 1,
						hash: "a".repeat(64),
					},
				],
				chunks: [],
				fileCount: 1,
				excludedCount: 0,
			}),
		).toThrow(SnapshotCompletionError);
		try {
			checkSnapshotCompletion({
				manifest,
				chunks: chunks.map((chunk) => ({
					...chunk,
					decodedBytes: CODEBASE_MAX_SNAPSHOT_BYTES,
				})),
				fileCount: 2,
				excludedCount: 0,
			});
			expect.unreachable("expected SnapshotCompletionError");
		} catch (error) {
			expect((error as SnapshotCompletionError).code).toBe(
				"SNAPSHOT_TOO_LARGE",
			);
		}
	});
});

describe("server-side CLI version gate (Task 5 carry-over)", () => {
	it("accepts CLI versions at or above the locked minimum", () => {
		expect(() => requireSupportedCliVersion("2.0.0")).not.toThrow();
		expect(() => requireSupportedCliVersion("2.1.0")).not.toThrow();
	});

	it("rejects older or malformed versions fail-closed with update guidance", () => {
		for (const version of ["1.9.9", "not-a-version", "", null, undefined]) {
			try {
				requireSupportedCliVersion(version as string);
				expect.unreachable(`expected CliVersionError for ${version}`);
			} catch (error) {
				expect(error).toBeInstanceOf(CliVersionError);
				expect((error as CliVersionError).code).toBe("CLI_UPDATE_REQUIRED");
			}
		}
	});

	it("whitelists the new completion error codes as safe", () => {
		expect(sanitizeSyncErrorCode("SNAPSHOT_INCOMPLETE")).toBe(
			"SNAPSHOT_INCOMPLETE",
		);
		expect(sanitizeSyncErrorCode("SNAPSHOT_CONFLICT")).toBe(
			"SNAPSHOT_CONFLICT",
		);
		expect(sanitizeSyncErrorCode("SNAPSHOT_HASH_MISMATCH")).toBe(
			"SNAPSHOT_HASH_MISMATCH",
		);
		expect(sanitizeSyncErrorCode("CLI_UPDATE_REQUIRED")).toBe(
			"CLI_UPDATE_REQUIRED",
		);
	});
});

describe("safe sync error messages (Task 5 carry-over)", () => {
	it("passes through short safe user-facing strings", () => {
		expect(sanitizeSyncErrorMessage("Analysis failed")).toBe("Analysis failed");
	});

	it("collapses missing or empty messages to null", () => {
		expect(sanitizeSyncErrorMessage(null)).toBeNull();
		expect(sanitizeSyncErrorMessage(undefined)).toBeNull();
		expect(sanitizeSyncErrorMessage("   ")).toBeNull();
		expect(sanitizeSyncErrorMessage(42)).toBeNull();
	});

	it("strips control characters and caps message length", () => {
		expect(sanitizeSyncErrorMessage("a\0b\x1Bc")).toBe("abc");
		const long = "x".repeat(600);
		const sanitized = sanitizeSyncErrorMessage(long);
		expect(sanitized?.length).toBeLessThanOrEqual(500);
		expect(sanitized).not.toContain("\0");
	});
});

describe("analysis retry rollback (Task 6)", () => {
	it("allows analyzing -> uploaded when an analysis attempt fails", () => {
		expect(canTransitionSyncStatus("analyzing", "uploaded")).toBe(true);
		expect(() => assertSyncTransition("analyzing", "uploaded")).not.toThrow();
	});

	it("keeps ready, failed, and expired terminal after the rollback edge", () => {
		for (const from of ["ready", "failed", "expired"] as const) {
			expect(canTransitionSyncStatus(from, "uploaded")).toBe(false);
			expect(canTransitionSyncStatus(from, "analyzing")).toBe(false);
		}
	});

	it("still rejects unrelated backward transitions", () => {
		expect(canTransitionSyncStatus("analyzing", "uploading")).toBe(false);
		expect(canTransitionSyncStatus("ready", "analyzing")).toBe(false);
	});
});

describe("analysis status DTO (Task 6)", () => {
	it("validates pending, ready, and failed analysis statuses", () => {
		for (const status of ["pending", "ready", "failed"]) {
			expect(codebaseAnalysisStatusSchema.safeParse(status).success).toBe(true);
		}
		expect(codebaseAnalysisStatusSchema.safeParse("analyzing").success).toBe(
			false,
		);
	});

	it("accepts a status response with analysis linkage", () => {
		const result = syncStatusResponseSchema.safeParse({
			projectId: "proj_123",
			sessionId: "sess_123",
			status: "ready",
			analysisId: "an_123",
			analysisStatus: "ready",
		});
		expect(result.success).toBe(true);
	});

	it("accepts a status response without analysis linkage", () => {
		const result = syncStatusResponseSchema.safeParse({
			projectId: "proj_123",
			sessionId: "sess_123",
			status: "uploading",
		});
		expect(result.success).toBe(true);
	});

	it("rejects an unknown analysis status", () => {
		const result = syncStatusResponseSchema.safeParse({
			projectId: "proj_123",
			sessionId: "sess_123",
			status: "ready",
			analysisStatus: "done",
		});
		expect(result.success).toBe(false);
	});
});

describe("codebase route entry (Task 6)", () => {
	it("denies greenfield projects from entering the codebase route", () => {
		expect(isSyncCapableProject({ projectMode: "greenfield" })).toBe(false);
	});

	it("allows existing-codebase projects to enter the codebase route", () => {
		expect(isSyncCapableProject({ projectMode: "existing_codebase" })).toBe(
			true,
		);
	});

	it("denies projects without an explicit existing-codebase mode", () => {
		expect(isSyncCapableProject({})).toBe(false);
		expect(isSyncCapableProject({ projectMode: null })).toBe(false);
	});
});

describe("verifyFileContentHash (Task 5)", () => {
	const text = "console.log('hello');";
	const base64 = Buffer.from(text, "utf8").toString("base64");
	const hash = createHash("sha256").update(text, "utf8").digest("hex");

	it("accepts content whose hash matches the manifest", () => {
		expect(verifyFileContentHash(base64, hash)).toBe(true);
	});

	it("rejects tampered content or mismatched hashes fail-closed", () => {
		expect(
			verifyFileContentHash(
				Buffer.from("tampered", "utf8").toString("base64"),
				hash,
			),
		).toBe(false);
		expect(verifyFileContentHash(base64, "0".repeat(64))).toBe(false);
	});

	it("rejects malformed base64 without throwing", () => {
		expect(verifyFileContentHash("!!!not-base64!!!", hash)).toBe(false);
		expect(verifyFileContentHash("", hash)).toBe(false);
	});

	it("rejects non-canonical base64 with non-zero unused bits", () => {
		// "Zh==" decodes to the same byte as canonical "Zg==" but is not a
		// valid canonical encoding; accepting both would let different layers
		// disagree about the accepted upload.
		expect(verifyFileContentHash("Zh==", hash)).toBe(false);
	});
});

describe("decodeBase64ByteLength canonical form (Task 5)", () => {
	it("decodes canonical base64 and rejects non-canonical encodings", () => {
		expect(decodeBase64ByteLength("Zg==")).toBe(1);
		expect(decodeBase64ByteLength("Zh==")).toBeNull();
		expect(decodeBase64ByteLength("")).toBeNull();
		expect(decodeBase64ByteLength("a")).toBeNull();
	});
});
