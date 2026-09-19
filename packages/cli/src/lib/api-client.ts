/**
 * HTTP client for PrdFy API v1.
 *
 * `apiGet`/`apiPost` keep their historical behavior (same headers and error
 * messages) for existing commands. New code — including the codebase sync
 * transport — should use `apiRequest`, which adds timeout/abort, bounded
 * JSON bodies, and structured `ApiError`s (status + retryability + server
 * code, never credentials or raw bodies).
 */

import { getApiKey, getApiUrl } from "./config.js";

/** Default ceiling for a single API request (existing commands included). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface ApiErrorDetails {
	status?: number;
	code?: string;
	retryable: boolean;
}

export class ApiError extends Error {
	readonly status?: number;
	/** Opaque server error code (e.g. `SYNC_EXPIRED`). Never a secret/body. */
	readonly code?: string;
	readonly retryable: boolean;

	constructor(message: string, details: ApiErrorDetails) {
		super(message);
		this.name = "ApiError";
		this.status = details.status;
		this.code = details.code;
		this.retryable = details.retryable;
	}
}

export interface ApiRequestOptions {
	method?: string;
	body?: unknown;
	headers?: Record<string, string>;
	timeoutMs?: number;
	signal?: AbortSignal;
	/** Refuse to send serialized JSON bodies larger than this (bytes). */
	maxBodyBytes?: number;
	/**
	 * Override the Bearer credential for this request only (e.g. a
	 * project-scoped sync token). Never persisted to global config.
	 */
	authToken?: string;
	/** Override the API base URL for this request only. */
	baseUrl?: string;
}

function isRetryableStatus(status: number): boolean {
	return status === 429 || status === 408 || status >= 500;
}

function asServerCode(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function apiRequest<T>(
	path: string,
	options: ApiRequestOptions = {},
): Promise<T> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	const controller = new AbortController();
	let callerAborted = false;
	let timedOut = false;

	const onCallerAbort = () => {
		callerAborted = true;
		controller.abort();
	};
	if (options.signal) {
		if (options.signal.aborted) {
			throw new ApiError("Request aborted", {
				code: "REQUEST_ABORTED",
				retryable: false,
			});
		}
		options.signal.addEventListener("abort", onCallerAbort, { once: true });
	}
	const timer =
		timeoutMs > 0
			? setTimeout(() => {
					timedOut = true;
					controller.abort();
				}, timeoutMs)
			: undefined;

	try {
		let serialized: string | undefined;
		if (options.body !== undefined) {
			serialized = JSON.stringify(options.body);
			if (options.maxBodyBytes !== undefined) {
				const byteLength = new TextEncoder().encode(serialized).length;
				if (byteLength > options.maxBodyBytes) {
					throw new ApiError(
						`Request body ${byteLength} bytes exceeds limit of ${options.maxBodyBytes} bytes`,
						{ code: "REQUEST_TOO_LARGE", retryable: false },
					);
				}
			}
		}

		let res: Response;
		try {
			res = await fetch(`${options.baseUrl ?? getApiUrl()}${path}`, {
				method: options.method ?? (serialized ? "POST" : "GET"),
				headers: {
					Authorization: `Bearer ${options.authToken ?? getApiKey()}`,
					...(serialized ? { "Content-Type": "application/json" } : {}),
					...options.headers,
				},
				body: serialized,
				signal: controller.signal,
			});
		} catch (err) {
			if (timedOut) {
				throw new ApiError(`Request timed out after ${timeoutMs}ms`, {
					code: "REQUEST_TIMEOUT",
					retryable: true,
				});
			}
			if (
				callerAborted ||
				(err instanceof DOMException && err.name === "AbortError")
			) {
				throw new ApiError("Request aborted", {
					code: "REQUEST_ABORTED",
					retryable: false,
				});
			}
			throw new ApiError("Network request failed", {
				code: "NETWORK_ERROR",
				retryable: true,
			});
		}

		if (!res.ok) {
			const body = await res.json().catch(() => null);
			const message =
				(body !== null &&
				typeof body === "object" &&
				typeof (body as { error?: unknown }).error === "string"
					? (body as { error: string }).error
					: null) ?? `API error: ${res.status}`;
			throw new ApiError(message, {
				status: res.status,
				code:
					body !== null && typeof body === "object"
						? asServerCode((body as { code?: unknown }).code)
						: undefined,
				retryable: isRetryableStatus(res.status),
			});
		}
		return (await res.json()) as T;
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		options.signal?.removeEventListener("abort", onCallerAbort);
	}
}

export async function apiGet<T>(path: string): Promise<T> {
	return apiRequest<T>(path, { method: "GET" });
}

export async function apiPost<T>(path: string, data?: unknown): Promise<T> {
	return apiRequest<T>(path, { method: "POST", body: data });
}
