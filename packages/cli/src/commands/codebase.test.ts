import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/sync-client.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../lib/sync-client.js")>();
	return {
		...actual,
		createSyncClient: vi.fn(),
	};
});

vi.mock("../lib/config.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../lib/config.js")>();
	return {
		...actual,
		saveConfig: vi.fn(),
		getApiUrl: vi.fn(() => "http://localhost:3000"),
	};
});

import { saveConfig } from "../lib/config.js";
import { createSyncClient } from "../lib/sync-client.js";
import { syncCodebase } from "./codebase.js";

function makeRepo(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "prdfy-codebase-"));
	for (const [rel, content] of Object.entries(files)) {
		const abs = join(root, ...rel.split("/"));
		mkdirSync(join(abs, ".."), { recursive: true });
		writeFileSync(abs, content);
	}
	return root;
}

let repos: string[] = [];

function trackRepo(root: string): string {
	repos.push(root);
	return root;
}

afterEach(() => {
	for (const repo of repos) rmSync(repo, { recursive: true, force: true });
	repos = [];
	vi.restoreAllMocks();
	vi.mocked(createSyncClient).mockReset();
});

const SESSION = { sessionId: "sess-1", attemptId: "att-1" };

interface CompletionCounts {
	fileCount: number;
	excludedCount: number;
}

interface ChunkArg {
	path: string;
}

function mockClient(overrides: Record<string, unknown> = {}) {
	const client = {
		handshake: vi.fn(async () => ({
			...SESSION,
			status: "connected",
		})),
		handshakeWithRetry: vi.fn(async () => ({
			...SESSION,
			status: "connected",
		})),
		uploadManifestWithRetry: vi.fn(
			async (
				_projectId: string,
				_session: typeof SESSION,
				_entries: unknown,
			) => ({ status: "uploading" }),
		),
		uploadFileChunksWithRetry: vi.fn(
			async (
				_projectId: string,
				_session: typeof SESSION,
				_chunks: ChunkArg[],
			) => ({ status: "uploading" }),
		),
		completeWithRetry: vi.fn(
			async (_proj: string, input: CompletionCounts) => ({
				status: "uploaded",
				fileCount: input.fileCount,
				excludedCount: input.excludedCount,
			}),
		),
		...overrides,
	};
	vi.mocked(createSyncClient).mockReturnValue(client as never);
	return client;
}

describe("syncCodebase validation", () => {
	beforeEach(() => {
		mockClient();
	});

	it("rejects empty project id or sync token before any IO", async () => {
		const root = trackRepo(makeRepo({ "a.ts": "const a = 1;\n" }));
		const res = await syncCodebase({
			projectId: "",
			syncToken: "tok",
			root,
			output: "json",
		});
		expect(res.ok).toBe(false);
		expect(res.errorCode).toBe("INVALID_OPTIONS");
		expect(vi.mocked(createSyncClient)).not.toHaveBeenCalled();
	});

	it("rejects an invalid output mode", async () => {
		const root = trackRepo(makeRepo({ "a.ts": "const a = 1;\n" }));
		const res = await syncCodebase({
			projectId: "p1",
			syncToken: "tok",
			root,
			output: "yaml" as never,
		});
		expect(res.ok).toBe(false);
		expect(res.errorCode).toBe("INVALID_OPTIONS");
	});
});

describe("syncCodebase blocked content", () => {
	it("refuses to upload when the manifest contains secret-matched content", async () => {
		const client = mockClient();
		const root = trackRepo(
			makeRepo({
				"src/app.ts": "export const app = 1;\n",
				// Placeholder-shaped match, not a real credential.
				"src/leak.ts": "const api_key = '<placeholder-value>';\n",
			}),
		);

		const res = await syncCodebase({
			projectId: "p1",
			syncToken: "tok",
			root,
			output: "json",
		});

		expect(res.ok).toBe(false);
		expect(res.errorCode).toBe("BLOCKED_CONTENT");
		expect(res.errorMessage).toContain("src/leak.ts");
		expect(res.errorMessage).not.toContain("<placeholder-value>");
		expect(client.handshakeWithRetry).not.toHaveBeenCalled();
		expect(client.uploadManifestWithRetry).not.toHaveBeenCalled();
		expect(client.uploadFileChunksWithRetry).not.toHaveBeenCalled();
		expect(client.completeWithRetry).not.toHaveBeenCalled();
	});
});

describe("syncCodebase happy path", () => {
	it("syncs eligible text files and returns the JSON result shape", async () => {
		const client = mockClient();
		const root = trackRepo(
			makeRepo({
				"src/app.ts": "export const app = 1;\n",
				"README.md": "# demo\n",
			}),
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const res = await syncCodebase({
			projectId: "p1",
			syncToken: "tok",
			root,
			output: "json",
		});

		expect(res.ok).toBe(true);
		expect(res.projectId).toBe("p1");
		expect(res.sessionId).toBe("sess-1");
		expect(res.status).toBe("uploaded");
		// fileCount = eligible entries, excludedCount = all exclusions (Task 2).
		expect(res.fileCount).toBe(2);
		expect(res.excludedCount).toBe(0);
		expect(res.uploadedFiles).toBe(2);

		const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
		const parsed = JSON.parse(logged);
		expect(parsed.ok).toBe(true);
		expect(parsed.sessionId).toBe("sess-1");
		expect(parsed.fileCount).toBe(2);
		logSpy.mockRestore();

		expect(client.uploadManifestWithRetry).toHaveBeenCalledOnce();
		expect(client.uploadFileChunksWithRetry).toHaveBeenCalled();
		expect(client.completeWithRetry).toHaveBeenCalledOnce();
	});

	it("never uploads binary files", async () => {
		const client = mockClient();
		const root = trackRepo(makeRepo({ "src/app.ts": "export const x = 1;\n" }));
		writeFileSync(
			join(root, "logo.png"),
			Buffer.from([0x89, 0x50, 0x00, 0xff]),
		);
		vi.spyOn(console, "log")
			.mockImplementation(() => {})
			.mockRestore();

		const res = await syncCodebase({
			projectId: "p1",
			syncToken: "tok",
			root,
			output: "json",
		});

		expect(res.ok).toBe(true);
		expect(res.fileCount).toBe(1);
		const manifestArg = client.uploadManifestWithRetry.mock.calls[0]?.[2] as
			| Array<{ path: string }>
			| undefined;
		expect(manifestArg?.map((entry) => entry.path)).toEqual(["src/app.ts"]);
		const chunksArg = client.uploadFileChunksWithRetry.mock.calls[0]?.[2];
		expect(chunksArg?.map((c) => c.path)).not.toContain("logo.png");
		expect(res.excludedCount).toBeGreaterThanOrEqual(1);
	});

	it("prints a human summary with real statuses and no invented percentages", async () => {
		mockClient();
		const root = trackRepo(makeRepo({ "src/app.ts": "export const x = 1;\n" }));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const res = await syncCodebase({
			projectId: "p1",
			syncToken: "tok",
			root,
			output: "human",
		});

		expect(res.ok).toBe(true);
		const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logged).toContain("uploaded");
		expect(logged).not.toContain("%");
		logSpy.mockRestore();
	});

	it("reports incomplete sync as failure", async () => {
		mockClient({
			completeWithRetry: vi.fn(async () => ({
				status: "failed",
				errorCode: "SNAPSHOT_REJECTED",
				errorMessage: "Snapshot rejected",
			})),
		});
		const root = trackRepo(makeRepo({ "src/app.ts": "export const x = 1;\n" }));

		const res = await syncCodebase({
			projectId: "p1",
			syncToken: "tok",
			root,
			output: "json",
		});

		expect(res.ok).toBe(false);
		expect(res.status).toBe("failed");
	});

	it("never persists the sync token to global config", async () => {
		mockClient();
		const root = trackRepo(makeRepo({ "src/app.ts": "export const x = 1;\n" }));

		await syncCodebase({
			projectId: "p1",
			syncToken: "super-secret-token",
			root,
			output: "json",
		});

		expect(vi.mocked(saveConfig)).not.toHaveBeenCalled();
		// The token travels in memory to the sync client (required for Bearer
		// auth) but must never reach the global config writer.
		const clientOptions = vi.mocked(createSyncClient).mock.calls[0]?.[0] as
			| { syncToken?: string }
			| undefined;
		expect(clientOptions?.syncToken).toBe("super-secret-token");
	});
});
