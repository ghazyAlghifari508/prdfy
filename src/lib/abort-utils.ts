// src/lib/abort-utils.ts
// Abort-aware promise racing for server handlers that hold a generation
// claim across phases which cannot observe request.signal themselves
// (e.g. the Context7 grounding fan-out). Without this, a client disconnect
// during those phases leaves the claim held until the phase's own timeout
// elapses, and any immediate retry answers 409 against a dead generation.
import "@tanstack/react-start/server-only";

/**
 * Reject with an Error whose name is "AbortError" as soon as `signal` fires,
 * without cancelling the underlying work (callers treat it as fire-and-forget).
 */
export async function raceWithAbort<T>(
	promise: Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	if (signal.aborted) {
		// The promise is already running: without an attached handler its
		// later rejection would surface as an unhandled rejection.
		promise.catch(() => {});
		throw Object.assign(new Error("Request aborted"), { name: "AbortError" });
	}
	let onAbort: () => void = () => {};
	const aborted = new Promise<never>((_, reject) => {
		onAbort = () =>
			reject(
				Object.assign(new Error("Request aborted"), { name: "AbortError" }),
			);
		signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([promise, aborted]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}
