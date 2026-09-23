import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deletionTimestamp, isProjectActive } from "./project-deletion";

describe("isProjectActive", () => {
	it("treats a null project as inactive", () => {
		expect(isProjectActive(null)).toBe(false);
		expect(isProjectActive(undefined)).toBe(false);
	});

	it("treats a project without a tombstone as active", () => {
		expect(isProjectActive({ deletedAt: null })).toBe(true);
		expect(isProjectActive({})).toBe(true);
	});

	it("treats a tombstoned project as inactive", () => {
		expect(isProjectActive({ deletedAt: new Date() })).toBe(false);
		expect(isProjectActive({ deletedAt: "2026-01-01T00:00:00.000Z" })).toBe(
			false,
		);
	});
});

describe("deletionTimestamp", () => {
	it("returns the provided instant", () => {
		const now = new Date("2026-01-02T03:04:05.000Z");
		expect(deletionTimestamp(now)).toBe(now);
	});
});

describe("project deletion contract", () => {
	const source = readFileSync("src/routes/api/projects/$id.ts", "utf8");

	it("never deletes the append-only credit ledger", () => {
		expect(source).not.toContain("delete(creditLedgerEntries)");
		expect(source).not.toContain("creditLedgerEntries");
	});

	it("never deletes credit operations, which carry the audit trail", () => {
		expect(source).not.toContain("delete(creditOperations)");
	});

	it("tombstones the project instead of destroying the row", () => {
		expect(source).toContain("deletedAt");
		expect(source).not.toMatch(/\.delete\(projects\)/);
	});

	it("purges every user-facing product artifact", () => {
		for (const table of [
			"messages",
			"conversations",
			"prdVersions",
			"acVersions",
			"tasks",
			"codebaseAskHandoffs",
			"codebaseGenerationContexts",
			"codebaseAnalyses",
			"codebaseSnapshotFiles",
			"codebaseSyncIdempotencyKeys",
			"codebaseSnapshots",
			"codebaseSyncSessions",
		]) {
			expect(source).toContain(`delete(${table})`);
		}
	});

	it("clears share access so a purged project cannot be read via its token", () => {
		expect(source).toContain("shareToken: null");
	});

	it("returns stable machine-readable error codes", () => {
		expect(source).toContain("PROJECT_NOT_FOUND");
		expect(source).toContain("PROJECT_DELETE_FAILED");
	});

	it("logs the internal cause server-side while returning a safe message", () => {
		expect(source).toContain("[projects/delete] failed");
		expect(source).toContain("Gagal menghapus proyek.");
	});

	it("is idempotent for an already-tombstoned project", () => {
		expect(source).toContain("already");
	});
});

describe("read paths exclude tombstoned projects", () => {
	const files = [
		"src/routes/history.tsx",
		"src/routes/prd/$id.tsx",
		"src/routes/ac/$id.tsx",
		"src/routes/task/$id.tsx",
		"src/routes/kanban/$id.tsx",
		"src/routes/ask/$id.tsx",
		"src/routes/codebase/$id.tsx",
		"src/routes/prd/share/$token.tsx",
		"src/lib/api-key-auth.ts",
		"src/routes/api/chat.ts",
		"src/routes/api/ac/generate.ts",
		"src/routes/api/task/generate.ts",
		"src/routes/api/kanban/$pid.ts",
		"src/routes/api/kanban/stream.ts",
		"src/routes/api/kanban/update-status.ts",
		"src/routes/api/task/$projectId.ts",
		"src/routes/api/projects/$id/versions.ts",
		"src/routes/api/projects/$id/step.ts",
		"src/routes/api/projects/$id/last-route.ts",
		"src/routes/api/ask/options.ts",
		"src/routes/api/export/prd.ts",
		"src/routes/api/export/zip.ts",
		"src/routes/api/codebase/$projectId/status.ts",
		"src/routes/api/codebase/$projectId/session.ts",
		"src/routes/api/v1/projects/$id/codebase/analysis.ts",
		"src/routes/api/v1/projects/$id/codebase/sync.ts",
		"src/lib/services/chat-service.ts",
		"src/lib/services/ac-service.ts",
		"src/lib/services/prd-service.ts",
		"src/lib/services/task-service.ts",
		"src/lib/language.ts",
		"src/lib/codebase-generation-context.ts",
		"src/lib/codebase-analysis.server.ts",
	];

	it("filters on deleted_at at every project read boundary", () => {
		const missing: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			if (!source.includes("deletedAt")) missing.push(file);
		}
		expect(missing).toEqual([]);
	});
});
