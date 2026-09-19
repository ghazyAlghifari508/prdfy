import { describe, expect, it } from "vitest";
import {
	assertSyncTransition,
	CODEBASE_ANALYSIS_STATUSES,
	CODEBASE_SNAPSHOT_STATUSES,
	type CodebaseSyncStatus,
	canTransitionSyncStatus,
	isSafeRelativePath,
	isTerminalSyncStatus,
	manifestEntrySchema,
	SyncTransitionError,
	selectActiveSnapshot,
	snapshotContextSchema,
	syncPromptPayloadSchema,
	syncStatusResponseSchema,
} from "./codebase-sync";
import { hashSyncToken } from "./codebase-sync.server";
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
