import { describe, expect, it, vi } from "vitest";
import { readBoundedJson } from "./codebase-sync-upload.server";
import { CODEBASE_MAX_CHUNK_BYTES } from "./constants";

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
