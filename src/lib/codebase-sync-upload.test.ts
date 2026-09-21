import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import * as uploadServer from "./codebase-sync-upload.server";
import { readBoundedJson } from "./codebase-sync-upload.server";
import { CODEBASE_MAX_CHUNK_BYTES } from "./constants";

describe("idempotent claim protocol surface", () => {
	it("exposes atomic claim/finalize/release and drops the old read-then-insert pair", () => {
		expect(typeof uploadServer.claimIdempotency).toBe("function");
		expect(typeof uploadServer.finalizeIdempotencyClaim).toBe("function");
		expect(typeof uploadServer.releaseIdempotencyClaim).toBe("function");
		// The non-atomic helpers that allowed two concurrent retries to both
		// mutate are gone.
		expect(
			"getIdempotentReplay" in
				(uploadServer as unknown as Record<string, unknown>),
		).toBe(false);
		expect(
			"storeIdempotentResponse" in
				(uploadServer as unknown as Record<string, unknown>),
		).toBe(false);
	});

	it("every upload route claims before its mutation and releases on failure", async () => {
		for (const route of [
			"../routes/api/v1/projects/$id/codebase/manifest.ts",
			"../routes/api/v1/projects/$id/codebase/files.ts",
			"../routes/api/v1/projects/$id/codebase/complete.ts",
		]) {
			const source = await readFile(new URL(route, import.meta.url), "utf8");
			const claimIndex = source.indexOf("await claimIdempotency(");
			expect(claimIndex, route).toBeGreaterThan(-1);
			expect(source, route).toContain("finalizeIdempotencyClaim(");
			expect(source, route).toContain("releaseIdempotencyClaim(");
			// The claim must be taken before any write to snapshot/session data.
			const firstWrite = source.search(
				/db\s*\n?\s*\.\s*(update|insert|transaction)\(/,
			);
			expect(
				firstWrite,
				`${route}: claim should precede writes`,
			).toBeGreaterThan(claimIndex);
		}
	});
});

function fakeRequest(
	chunks: Uint8Array[],
	headers: Record<string, string> = {},
) {
	const reads: number[] = [];
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			controller.close();
		},
		pull(controller) {
			reads.push(1);
			controller.enqueue(new Uint8Array(0));
		},
	});
	return {
		request: {
			headers: new Headers(headers),
			body: stream,
		} as unknown as Request,
		readCount: () => reads.length,
	};
}

describe("readBoundedJson transport bound", () => {
	it("parses a small body streamed in multiple pieces", async () => {
		const text = JSON.stringify({ ok: true });
		const bytes = new TextEncoder().encode(text);
		const { request } = fakeRequest([bytes.slice(0, 5), bytes.slice(5)]);
		const result = await readBoundedJson(request);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.body).toEqual({ ok: true });
	});

	it("rejects a malformed Content-Length before reading the body", async () => {
		const { request } = fakeRequest([new TextEncoder().encode("{}")], {
			"content-length": "garbage",
		});
		const result = await readBoundedJson(request);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failure.status).toBe(400);
			expect(result.failure.body.error).toBe("Invalid Content-Length");
		}
	});

	it("rejects a negative Content-Length", async () => {
		const { request } = fakeRequest([new TextEncoder().encode("{}")], {
			"content-length": "-5",
		});
		const result = await readBoundedJson(request);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.failure.status).toBe(400);
	});

	it("honors the declared bound before any read", async () => {
		const spy = vi.fn();
		const request = {
			headers: new Headers({
				"content-length": String(CODEBASE_MAX_CHUNK_BYTES + 1),
			}),
			body: {
				getReader: () => {
					spy();
					throw new Error("body must not be read");
				},
			},
		} as unknown as Request;
		const result = await readBoundedJson(request);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.failure.status).toBe(413);
		expect(spy).not.toHaveBeenCalled();
	});

	it("rejects an undeclared chunked body once the byte cap is crossed", async () => {
		const oversized = new Uint8Array(1024 * 1024);
		const { request, readCount } = fakeRequest([oversized]);
		const result = await readBoundedJson(request);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failure.status).toBe(413);
			expect(result.failure.body.code).toBe("SNAPSHOT_TOO_LARGE");
		}
		// Rejected on the first oversized chunk, not after draining the body.
		expect(readCount()).toBeLessThanOrEqual(1);
	});

	it("rejects invalid JSON with 400", async () => {
		const { request } = fakeRequest([new TextEncoder().encode("{oops")]);
		const result = await readBoundedJson(request);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.failure.status).toBe(400);
	});
});

describe("handshake snapshot serialization contract", () => {
	it("serializes handshake state transition and snapshot creation via advisory lock in transaction", async () => {
		const source = await readFile(
			new URL(
				"../routes/api/v1/projects/$id/codebase/sync.ts",
				import.meta.url,
			),
			"utf8",
		);
		const lockIndex = source.indexOf("pg_advisory_xact_lock(hashtext(");
		const txUpdateSessionIndex = source.search(
			/tx\s*\n?\s*\.\s*update\(codebaseSyncSessions\)/,
		);
		const txInsertSnapshotIndex = source.search(
			/tx\s*\n?\s*\.\s*insert\(codebaseSnapshots\)/,
		);

		expect(lockIndex).toBeGreaterThan(-1);
		expect(txUpdateSessionIndex).toBeGreaterThan(lockIndex);
		expect(txInsertSnapshotIndex).toBeGreaterThan(txUpdateSessionIndex);
	});
});
