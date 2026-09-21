// src/lib/context7-client.ts
// Minimal Context7 MCP client over HTTP JSON-RPC. No SDK.
// Context7 serves SSE-framed JSON-RPC responses (event: message / data: {...}).
// Optional CONTEXT7_API_KEY sent as Bearer auth for higher rate limits
// (Context7 streamable-HTTP MCP docs: Authorization: Bearer <key>).
import "@tanstack/react-start/server-only";

// ponytail: URL only from env — no hardcoded endpoint, no fallback string.
function getMcpUrl(): string | null {
	return process.env.CONTEXT7_MCP_URL ?? null;
}

function getAuthHeaders(): Record<string, string> {
	const key = process.env.CONTEXT7_API_KEY;
	return key ? { Authorization: `Bearer ${key}` } : {};
}

const PROTOCOL_VERSION = "2025-11-25";
export const DEFAULT_TIMEOUT_MS = 3000;
// ponytail: static safety ceiling — bound the response we buffer in memory so a
// hostile/oversized Context7 body can't exhaust process memory. 1,000,000 bytes.
const MAX_RESPONSE_BYTES = 1_000_000;

/**
 * Split an SSE body into event payloads. One event ends at a blank line; each
 * `data:` line contributes to that event's payload (joined by "\n"). Returns
 * combined payload strings so a JSON-RPC message spanning multiple data lines survives.
 */
function parseSseEvents(body: string): string[] {
	const payloads: string[] = [];
	let current: string[] = [];
	for (const raw of body.split("\n")) {
		const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
		if (line === "") {
			if (current.length) payloads.push(current.join("\n"));
			current = [];
			continue;
		}
		if (line.startsWith("data:")) {
			const value = line.slice(5);
			current.push(value.startsWith(" ") ? value.slice(1) : value);
		}
		// event:/id:/comment lines are not payload; ignored implicitly.
	}
	if (current.length) payloads.push(current.join("\n"));
	return payloads;
}

interface McpContent {
	type?: string;
	text?: string;
}

interface McpResult {
	content?: McpContent[];
	tools?: Array<{ name: string }>;
}

interface McpMessage {
	result?: McpResult;
	error?: { message: string };
}

/**
 * Read a response body with a hard byte ceiling. Reads incrementally via the
 * stream reader and stops (canceling the reader) the moment the cumulative byte
 * count exceeds MAX_RESPONSE_BYTES — so we never buffer an unbounded body.
 * Returns null on oversize, stream/read/cancel error, or incompatible Response.
 */
async function readResponseText(res: Response): Promise<string | null> {
	// Native/synthetic test doubles often expose only text(); fall back to it,
	// then enforce the byte ceiling on the decoded result. Real fetch Responses
	// carry a readable body stream.
	if (!res.body) {
		try {
			const fallback = await res.text();
			return new TextEncoder().encode(fallback).byteLength > MAX_RESPONSE_BYTES
				? null
				: fallback;
		} catch {
			return null;
		}
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let total = 0;
	let text = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_RESPONSE_BYTES) {
				// ponytail: nonblocking — don't await the cancel promise; an
				// adversarial stream could hang it. Fire-and-forget, return null.
				void reader.cancel().catch(() => {});
				return null;
			}
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
		return text;
	} catch {
		// Nonblocking best-effort cleanup; the cancel result itself is irrelevant.
		void reader.cancel().catch(() => {});
		return null;
	}
}

/** Send one JSON-RPC request; parse SSE `data:` lines OR application/json. Return first valid message. */
async function rpc(
	method: string,
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<McpMessage | null> {
	const url = getMcpUrl();
	if (!url) return null;

	let res: Response;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				...getAuthHeaders(),
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: Math.floor(Math.random() * 1e9),
				method,
				params,
			}),
			// Reject rather than follow redirects (SSRF/open-redirect hardening).
			redirect: "error",
			signal,
		});
	} catch {
		return null;
	}
	if (!res.ok) return null;

	const text = await readResponseText(res);
	if (text === null) return null;
	// Accumulate `data:` lines per SSE event (one event ends at a blank line),
	// then parse the combined payload — a JSON-RPC message may span many data lines.
	const events = parseSseEvents(text);
	for (const payload of events) {
		try {
			const parsed = JSON.parse(payload) as McpMessage;
			if (parsed.error) return { error: parsed.error };
			if (parsed.result) return { result: parsed.result };
		} catch {
			// ignore malformed event payloads
		}
	}
	// application/json (whole body is the message) fallback.
	try {
		const parsed = JSON.parse(text) as McpMessage;
		if (parsed.error) return { error: parsed.error };
		if (parsed.result) return { result: parsed.result };
	} catch {
		// not JSON at all
	}
	return null;
}

/** Upper-bound a JSON-RPC call so a slow Context7 never stalls generation. */
async function rpcWithTimeout(
	method: string,
	params: Record<string, unknown>,
	ms: number,
	externalSignal?: AbortSignal,
): Promise<McpMessage | null> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), ms);
	// Link an outer cancellation (grounding budget, request abort) so an
	// in-flight RPC is actually cancelled, not merely abandoned.
	const onExternalAbort = () => ctrl.abort();
	if (externalSignal) {
		if (externalSignal.aborted) {
			clearTimeout(timer);
			return null;
		}
		externalSignal.addEventListener("abort", onExternalAbort, {
			once: true,
		});
	}
	try {
		return await rpc(method, params, ctrl.signal);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
		externalSignal?.removeEventListener("abort", onExternalAbort);
	}
}

/**
 * Fuzzy-search a library by free text. Returns the best-matching library ID
 * (e.g. "/example/sdk") or null when nothing matches / call fails.
 */
export async function resolveLibraryId(
	query: string,
	ms = DEFAULT_TIMEOUT_MS,
	signal?: AbortSignal,
): Promise<string | null> {
	if (!getMcpUrl()) return null;

	const init = await rpcWithTimeout(
		"initialize",
		{
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: { name: "prdfy-grounding", version: "0.0.1" },
		},
		ms,
		signal,
	);
	if (!init?.result) return null;

	const call = await rpcWithTimeout(
		"tools/call",
		{ name: "resolve-library-id", arguments: { query, libraryName: query } },
		ms,
		signal,
	);
	const content = call?.result?.content;
	if (!content) return null;
	for (const c of content) {
		if (c.type !== "text" || !c.text) continue;
		// ponytail: current resolve format "Context7-compatible library ID: /org/project"
		const m = c.text.match(/Context7-compatible library ID:\s*(\S+)/);
		if (m) return m[1];
	}
	return null;
}

/**
 * Fetch documentation snippets for a library ID (no version → auto-latest).
 * Returns the raw text content, or "" on failure.
 */
export async function queryDocs(
	libraryId: string,
	query: string,
	ms = DEFAULT_TIMEOUT_MS,
	signal?: AbortSignal,
): Promise<string> {
	if (!getMcpUrl()) return "";
	// Enforce bounded input lengths before serialization/transfer.
	const boundedLibraryId = libraryId.slice(0, 256);
	const boundedQuery = query.slice(0, 512);

	const init = await rpcWithTimeout(
		"initialize",
		{
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: { name: "prdfy-grounding", version: "0.0.1" },
		},
		ms,
		signal,
	);
	if (!init?.result) return "";

	const call = await rpcWithTimeout(
		"tools/call",
		{
			name: "query-docs",
			arguments: { libraryId: boundedLibraryId, query: boundedQuery },
		},
		ms,
		signal,
	);
	const content = call?.result?.content;
	if (!content) return "";
	return content
		.filter((c) => c.type === "text" && c.text)
		.map((c) => c.text)
		.join("\n");
}
