import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiGet, apiPost, apiRequest } from "./api-client.js";

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

function callInit(
	fetchMock: ReturnType<typeof stubFetch>,
	index: number,
): RequestInit {
	const init = fetchMock.mock.calls[index][1];
	if (!init) throw new Error("fetch init missing in test");
	return init;
}

function authHeader(init: RequestInit): string | undefined {
	return (init.headers as Record<string, string>).Authorization;
}

function caughtApiError(promise: Promise<unknown>): Promise<ApiError> {
	return promise.then(
		() => {
			throw new Error("expected request to fail in test");
		},
		(e) => e as ApiError,
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("apiGet/apiPost auth headers", () => {
	it("sends the configured Bearer API key", async () => {
		const fetchMock = stubFetch(async () => jsonResponse(200, { ok: true }));

		await apiGet<unknown>("/api/v1/projects/abc");

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(authHeader(callInit(fetchMock, 0))).toMatch(/^Bearer \S+$/);
	});

	it("apiPost sends JSON content type with the Bearer key", async () => {
		const fetchMock = stubFetch(async () => jsonResponse(200, { ok: true }));

		await apiPost<unknown>("/api/v1/projects/abc", { name: "x" });

		const init = callInit(fetchMock, 0);
		expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
			"application/json",
		);
		expect(authHeader(init)).toMatch(/^Bearer \S+$/);
		expect(init.body).toBe(JSON.stringify({ name: "x" }));
	});
});

describe("structured errors", () => {
	it("exposes status, server code, and non-retryable for 4xx", async () => {
		stubFetch(async () =>
			jsonResponse(401, {
				error: "Invalid sync token",
				code: "SYNC_UNAUTHORIZED",
			}),
		);

		const err = await caughtApiError(apiGet<unknown>("/api/v1/x"));
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(401);
		expect(err.code).toBe("SYNC_UNAUTHORIZED");
		expect(err.retryable).toBe(false);
		expect(err.message).toContain("Invalid sync token");
	});

	it("marks 5xx and 429 as retryable", async () => {
		for (const status of [429, 500, 502, 503]) {
			stubFetch(async () =>
				jsonResponse(status, { error: "boom", code: "UPSTREAM" }),
			);
			const err = await caughtApiError(apiGet<unknown>("/api/v1/x"));
			expect(err.retryable).toBe(true);
			expect(err.status).toBe(status);
		}
	});

	it("falls back to a status message when the body is not JSON", async () => {
		stubFetch(async () => new Response("oops", { status: 500 }));

		const err = await caughtApiError(apiGet<unknown>("/api/v1/x"));
		expect(err).toBeInstanceOf(ApiError);
		expect(err.retryable).toBe(true);
		expect(err.message).toContain("500");
	});

	it("never leaks credentials or raw body details in the message", async () => {
		const fetchMock = stubFetch(async (_url, init) => {
			const sentAuth = init ? authHeader(init) : undefined;
			return jsonResponse(403, {
				error: "Forbidden",
				code: "SYNC_FORBIDDEN",
				debug: { echoed: sentAuth, rawBody: "should-not-appear-xyz" },
			});
		});

		const err = await caughtApiError(apiGet<unknown>("/api/v1/x"));
		expect(err).toBeInstanceOf(ApiError);
		expect(err.code).toBe("SYNC_FORBIDDEN");
		expect(err.message).not.toContain("should-not-appear-xyz");
		expect(err.message).not.toContain("Bearer");
		expect(fetchMock).toHaveBeenCalledOnce();
	});
});

describe("timeout and abort", () => {
	it("aborts a hanging request after timeoutMs as retryable", async () => {
		stubFetch(
			(_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new DOMException("aborted", "AbortError")),
					);
				}),
		);

		const err = await caughtApiError(
			apiRequest<unknown>("/api/v1/x", { timeoutMs: 20 }),
		);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.code).toBe("REQUEST_TIMEOUT");
		expect(err.retryable).toBe(true);
	});

	it("treats caller abort as non-retryable", async () => {
		stubFetch(
			(_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new DOMException("aborted", "AbortError")),
					);
				}),
		);
		const controller = new AbortController();
		const pending = caughtApiError(
			apiRequest<unknown>("/api/v1/x", {
				signal: controller.signal,
				timeoutMs: 5000,
			}),
		);
		controller.abort();
		const err = await pending;
		expect(err).toBeInstanceOf(ApiError);
		expect(err.code).toBe("REQUEST_ABORTED");
		expect(err.retryable).toBe(false);
	});

	it("treats network failures as retryable without leaking internals", async () => {
		stubFetch(async () => {
			throw new TypeError("fetch failed: secret-socket-detail");
		});

		const err = await caughtApiError(apiGet<unknown>("/api/v1/x"));
		expect(err).toBeInstanceOf(ApiError);
		expect(err.code).toBe("NETWORK_ERROR");
		expect(err.retryable).toBe(true);
		expect(err.message).not.toContain("secret-socket-detail");
	});
});

describe("bounded requests", () => {
	it("refuses to send an oversized JSON body before any fetch", async () => {
		const fetchMock = stubFetch(async () => jsonResponse(200, { ok: true }));

		const err = await caughtApiError(
			apiRequest<unknown>("/api/v1/x", {
				method: "POST",
				body: { data: "a".repeat(1024) },
				maxBodyBytes: 64,
			}),
		);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.code).toBe("REQUEST_TOO_LARGE");
		expect(err.retryable).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("sends bodies within the bound", async () => {
		const fetchMock = stubFetch(async () => jsonResponse(200, { ok: true }));

		await apiRequest<unknown>("/api/v1/x", {
			method: "POST",
			body: { data: "small" },
			maxBodyBytes: 1024,
		});
		expect(fetchMock).toHaveBeenCalledOnce();
	});
});
