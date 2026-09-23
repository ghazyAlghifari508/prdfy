import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-client.js";
import {
	buildCodebaseSyncUrl,
	CODEBASE_MAX_CHUNK_BYTES,
	createSyncClient,
	makeIdempotencyKey,
	planFileChunks,
	withSyncRetry,
} from "./sync-client.js";

const OPTIONS = {
	apiUrl: "http://localhost:3000",
	syncToken: "test-sync-token",
	timeoutMs: 1000,
};

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

function stubFetch(impl: FetchImpl) {
	const fetchMock = vi.fn(impl);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function callUrlAndInit(
	fetchMock: ReturnType<typeof stubFetch>,
	index: number,
): { url: string; init: RequestInit } {
	const [url, init] = fetchMock.mock.calls[index];
	if (!init) throw new Error("fetch init missing in test");
	return { url, init };
}

function requestBody(init: RequestInit): string {
	return String(init.body);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("session handshake", () => {
	it("sends the sync token as Bearer auth without leaking it into URL or body", async () => {
		const fetchMock = stubFetch(async () =>
			jsonResponse(200, {
				sessionId: "sess-1",
				attemptId: "att-1",
				status: "connected",
			}),
		);
		const client = createSyncClient(OPTIONS);

		const res = await client.handshake("proj-1");

		expect(res.sessionId).toBe("sess-1");
		expect(res.attemptId).toBe("att-1");
		expect(fetchMock).toHaveBeenCalledOnce();
		const { url, init } = callUrlAndInit(fetchMock, 0);
		expect(url).toBe(
			"http://localhost:3000/api/v1/codebases/proj-1/codebase/sync",
		);
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer test-sync-token",
		);
		expect(url).not.toContain("test-sync-token");
		expect(requestBody(init)).not.toContain("test-sync-token");
	});

	it("surfaces the server-bound snapshotId from the handshake response", async () => {
		stubFetch(async () =>
			jsonResponse(200, {
				sessionId: "sess-1",
				attemptId: "att-1",
				snapshotId: "snap-1",
				status: "connected",
			}),
		);
		const client = createSyncClient(OPTIONS);

		const res = await client.handshake("proj-1");

		expect(res.snapshotId).toBe("snap-1");
	});

	it("rejects a CLI that is older than the server minimum with update guidance", async () => {
		stubFetch(async () =>
			jsonResponse(200, {
				sessionId: "sess-1",
				attemptId: "att-1",
				status: "connected",
				cliMinVersion: "99.0.0",
			}),
		);

		const err = (await createSyncClient(OPTIONS)
			.handshake("proj-1")
			.then(
				() => {
					throw new Error("expected handshake to fail in test");
				},
				(e) => e as ApiError,
			)) as ApiError;
		expect(err.code).toBe("CLI_UPDATE_REQUIRED");
		expect(err.retryable).toBe(false);
		expect(err.message).toContain("99.0.0");
	});

	it("does not retry non-retryable 4xx handshake failures", async () => {
		const fetchMock = stubFetch(async () =>
			jsonResponse(401, {
				error: "Invalid sync token",
				code: "SYNC_UNAUTHORIZED",
			}),
		);

		const err = await createSyncClient(OPTIONS)
			.handshakeWithRetry("proj-1")
			.then(
				() => {
					throw new Error("expected handshake to fail in test");
				},
				(e) => e as ApiError,
			);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.retryable).toBe(false);
		expect(fetchMock).toHaveBeenCalledOnce();
	});
});

describe("manifest upload", () => {
	const entries = [
		{
			path: "src/a.ts",
			size: 10,
			hash: "a".repeat(64),
			language: "typescript",
		},
		{ path: "src/b.ts", size: 12, hash: "b".repeat(64) },
	];

	it("uploads bounded manifest batches with stable idempotency keys", async () => {
		const seen: string[] = [];
		const fetchMock = stubFetch(async (_url, init) => {
			if (init) seen.push(requestBody(init));
			return jsonResponse(200, { status: "uploading" });
		});

		const res = await createSyncClient(OPTIONS).uploadManifestWithRetry(
			"proj-1",
			{ sessionId: "sess-1", attemptId: "att-1" },
			entries,
		);

		expect(res.status).toBe("uploading");
		expect(fetchMock).toHaveBeenCalledOnce();
		const body = JSON.parse(seen[0]);
		expect(body.sessionId).toBe("sess-1");
		expect(body.attemptId).toBe("att-1");
		expect(body.entries).toHaveLength(2);
		expect(body.batchIndex).toBe(0);
		expect(body.batchTotal).toBe(1);
		expect(body.idempotencyKey).toBe(
			makeIdempotencyKey("att-1", "manifest", 0),
		);
		const serialized = new TextEncoder().encode(seen[0]).length;
		expect(serialized).toBeLessThanOrEqual(CODEBASE_MAX_CHUNK_BYTES);
	});

	it("splits large manifests so every request stays within the chunk bound", async () => {
		const big = Array.from({ length: 3000 }, (_, i) => ({
			path: `src/file-${i}.ts`,
			size: 100,
			hash: "c".repeat(64),
			language: "typescript",
		}));
		const sizes: number[] = [];
		const fetchMock = stubFetch(async (_url, init) => {
			sizes.push(new TextEncoder().encode(requestBody(init ?? {})).length);
			return jsonResponse(200, { status: "uploading" });
		});

		await createSyncClient(OPTIONS).uploadManifestWithRetry(
			"proj-1",
			{ sessionId: "sess-1", attemptId: "att-1" },
			big,
		);

		expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
		for (const size of sizes) {
			expect(size).toBeLessThanOrEqual(CODEBASE_MAX_CHUNK_BYTES);
		}
	});

	it("retries a 500 with the identical session/attempt/chunk identity", async () => {
		const fetchMock = stubFetch(async () =>
			jsonResponse(500, { error: "boom", code: "UPSTREAM" }),
		);
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse(500, { error: "boom", code: "UPSTREAM" }),
			)
			.mockResolvedValueOnce(jsonResponse(200, { status: "uploading" }));

		await createSyncClient(OPTIONS).uploadManifestWithRetry(
			"proj-1",
			{ sessionId: "sess-1", attemptId: "att-1" },
			entries,
		);

		const bodies = fetchMock.mock.calls.map((call) =>
			requestBody(call[1] ?? {}),
		);
		expect(bodies.length).toBe(2);
		expect(bodies[0]).toBe(bodies[1]);
		expect(JSON.parse(bodies[1]).idempotencyKey).toBe(
			makeIdempotencyKey("att-1", "manifest", 0),
		);
	});
});

describe("planFileChunks", () => {
	it("keeps every chunk within the byte bound and round-trips content", () => {
		const base64 = Buffer.from("hello world ".repeat(50_000)).toString(
			"base64",
		);
		const chunks = planFileChunks([
			{ path: "src/big.ts", base64, hash: "d".repeat(64) },
		]);

		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.path).toBe("src/big.ts");
			expect(chunk.encoding).toBe("base64");
			expect(chunk.contentHash).toBe("d".repeat(64));
			expect(new TextEncoder().encode(chunk.data).length).toBeLessThanOrEqual(
				CODEBASE_MAX_CHUNK_BYTES,
			);
		}
		const totals = new Set(chunks.map((c) => c.chunkTotal));
		expect(totals.size).toBe(1);
		const joined = [...chunks]
			.sort((a, b) => a.chunkIndex - b.chunkIndex)
			.map((c) => c.data)
			.join("");
		expect(joined).toBe(base64);
	});

	it("emits a single chunk for small files", () => {
		const chunks = planFileChunks([
			{
				path: "a.ts",
				base64: Buffer.from("hi").toString("base64"),
				hash: "e".repeat(64),
			},
		]);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].chunkIndex).toBe(0);
		expect(chunks[0].chunkTotal).toBe(1);
	});

	it("skips empty files instead of emitting a chunk the server rejects", () => {
		const chunks = planFileChunks([
			{ path: "empty.ts", base64: "", hash: "f".repeat(64) },
		]);
		expect(chunks).toEqual([]);
	});

	it("cuts every chunk on a 4-char base64 boundary so each is standalone-valid", () => {
		// 196227 source bytes base64 to 261636 chars (not divisible by the
		// old even char-split): a naive half-split yields 130818-char chunks,
		// which is NOT valid standalone base64. Aligned slicing must fix it.
		const raw = Buffer.alloc(196227);
		for (let i = 0; i < raw.length; i += 1) raw[i] = 97 + (i % 26);
		const base64 = raw.toString("base64");
		const chunks = planFileChunks([
			{ path: "src/big.bin.ts", base64, hash: "a".repeat(64) },
		]);

		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.data.length % 4).toBe(0);
			expect(() => Buffer.from(chunk.data, "base64")).not.toThrow();
			expect(Buffer.from(chunk.data, "base64").toString("base64")).toBe(
				chunk.data,
			);
		}
		const joined = [...chunks]
			.sort((a, b) => a.chunkIndex - b.chunkIndex)
			.map((c) => c.data)
			.join("");
		expect(joined).toBe(base64);
	});
});

describe("file chunk upload and completion", () => {
	it("uploads text chunks and echoes the persisted server status", async () => {
		const fetchMock = stubFetch(async () =>
			jsonResponse(200, { status: "uploading" }),
		);

		const res = await createSyncClient(OPTIONS).uploadFileChunksWithRetry(
			"proj-1",
			{ sessionId: "sess-1", attemptId: "att-1" },
			[
				{
					path: "a.ts",
					chunkIndex: 0,
					chunkTotal: 1,
					encoding: "base64",
					data: Buffer.from("hi").toString("base64"),
					contentHash: "e".repeat(64),
				},
			],
		);

		expect(res.status).toBe("uploading");
		const { url, init } = callUrlAndInit(fetchMock, 0);
		expect(url).toBe(
			"http://localhost:3000/api/v1/codebases/proj-1/codebase/files",
		);
		expect(requestBody(init)).not.toContain("test-sync-token");
	});

	it("completes with file/excluded counts and an idempotency key", async () => {
		const fetchMock = stubFetch(async () =>
			jsonResponse(200, {
				status: "uploaded",
				fileCount: 2,
				excludedCount: 1,
			}),
		);

		const res = await createSyncClient(OPTIONS).completeWithRetry("proj-1", {
			sessionId: "sess-1",
			attemptId: "att-1",
			fileCount: 2,
			excludedCount: 1,
		});

		expect(res.status).toBe("uploaded");
		expect(res.fileCount).toBe(2);
		const { init } = callUrlAndInit(fetchMock, 0);
		const body = JSON.parse(requestBody(init));
		expect(body.fileCount).toBe(2);
		expect(body.excludedCount).toBe(1);
		expect(body.idempotencyKey).toBe(
			makeIdempotencyKey("att-1", "complete", 0),
		);
	});
});

describe("withSyncRetry", () => {
	it("retries retryable errors and stops after success", async () => {
		let calls = 0;
		const res = await withSyncRetry(async () => {
			calls += 1;
			if (calls === 1)
				throw new ApiError("x", { retryable: true, status: 500 });
			return "done";
		});
		expect(res).toBe("done");
		expect(calls).toBe(2);
	});

	it("does not retry non-retryable errors", async () => {
		let calls = 0;
		const err = await withSyncRetry(async () => {
			calls += 1;
			throw new ApiError("nope", { retryable: false, status: 400 });
		}).catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(calls).toBe(1);
	});

	it("gives up after the attempt budget", async () => {
		let calls = 0;
		const err = await withSyncRetry(
			async () => {
				calls += 1;
				throw new ApiError("still bad", { retryable: true, status: 500 });
			},
			{ maxAttempts: 2 },
		).catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(calls).toBe(2);
	});
});

describe("buildCodebaseSyncUrl", () => {
	it("targets the codebase-scoped upload boundary", () => {
		expect(
			buildCodebaseSyncUrl("https://prdfy.example", "cb_1", "manifest"),
		).toBe("https://prdfy.example/api/v1/codebases/cb_1/codebase/manifest");
	});

	it("encodes the codebase id", () => {
		expect(buildCodebaseSyncUrl("https://prdfy.example", "a/b", "files")).toBe(
			"https://prdfy.example/api/v1/codebases/a%2Fb/codebase/files",
		);
	});
});
