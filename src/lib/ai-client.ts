/**
 * 9router AI client - Vercel AI SDK v7 streamText + @ai-sdk/openai.
 * 9router exposes an OpenAI-compatible /v1/chat/completions (local, no API key).
 *
 * ponytail: apiKey must be non-empty for createOpenAI (it asserts), but 9router
 * ignores it - send a dummy. If a key is ever required, set 9ROUTER_API_KEY.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, streamText } from "ai";
import {
	AI_STALL_TIMEOUT_MS,
	AI_TOTAL_TIMEOUT_MS,
	ROUTER_BASE_URL,
} from "@/lib/constants";

const provider = createOpenAI({
	baseURL: ROUTER_BASE_URL,
	apiKey: process.env.NINE_ROUTER_API_KEY || "nine-router-local",
});

interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

/**
 * Mutable box the caller passes in to learn WHY the stream ended.
 *
 * ponytail: an out-param, not a return value - streamChat is a generator, so
 * its return channel is already spoken for, and callers only need the reason
 * after the loop drains. Consumed by isTruncatedGeneration in lib/flow-progress
 * to decide whether a generation is safe to persist.
 */
export interface StreamOutcome {
	finishReason?: string;
}

/**
 * Stream chat completion as an AsyncGenerator<string>.
 * Preserves the old raw-fetch streamChat signature so ai-orchestrator + all
 * 5 AI routes port unchanged; `outcome` is optional and additive.
 */
export async function* streamChat(
	messages: ChatMessage[],
	model?: string,
	signal?: AbortSignal,
	maxTokens = 32768,
	outcome?: StreamOutcome,
	onThinking?: (text: string) => void,
): AsyncGenerator<string, void, undefined> {
	const systemMessages = messages
		.filter((m) => m.role === "system")
		.map((m) => m.content)
		.join("\n\n");
	const nonSystemMessages = messages.filter(
		(m): m is { role: "user" | "assistant"; content: string } =>
			m.role !== "system",
	);

	const result = streamText({
		// ponytail: provider.chat(), not provider(). The v5 default routes to the
		// Responses API, whose stream 9router answers with a chat-completions body;
		// the mismatch makes the SDK report finishReason "other" on a stream that
		// finished cleanly ("stop" on the wire), and isTruncatedGeneration then
		// discards a complete document. .chat() pins /v1/chat/completions.
		model: provider.chat(model || "oc/big-pickle"),
		system: systemMessages || undefined,
		messages: nonSystemMessages,
		abortSignal: signal,
		maxOutputTokens: maxTokens,
		stopSequences: ["<|eot_id|>", "<|end_of_text|>", "===DONE==="],
		onError({ error }) {
			// SDK suppresses stream errors into fullStream `error` parts (handled
			// above), but captures non-stream errors here too. Re-emit so the
			// caller's try/catch sees the real failure reason.
			if (outcome) outcome.finishReason = "error";
			console.error("streamText error:", error);
		},
	});

	// ponytail: single choke-point watchdog. Stall timer races each next() so a
	// zero-chunk upstream (reasoning burst or hang) surfaces as an error instead
	// of an infinite spinner. Total ceiling covers the whole stream.
	let yieldedText = false;
	let lastProgress = Date.now();
	const totalDeadline = Date.now() + AI_TOTAL_TIMEOUT_MS;
	const mkStallError = () =>
		new Error("AI tidak merespons dalam 2 menit. Coba generate ulang.");
	const mkTotalError = () =>
		new Error(
			"Generasi melebihi batas waktu. Coba lagi dengan prompt lebih ringkas.",
		);
	try {
		const iterator = result.fullStream[Symbol.asyncIterator]();
		const done = false;
		while (!done) {
			const now = Date.now();
			if (now >= totalDeadline) throw mkTotalError();
			const remainingTotal = totalDeadline - now;
			// Stall budget counts from the last PROGRESS (reasoning/text),
			// not from the last part of any kind: a provider emitting
			// metadata forever must not keep the generator alive.
			const stallMs = Math.min(
				Math.max(lastProgress + AI_STALL_TIMEOUT_MS - now, 0),
				remainingTotal,
			);
			let stallId: ReturnType<typeof setTimeout> | undefined;
			let totalId: ReturnType<typeof setTimeout> | undefined;
			const stallPromise = new Promise<never>((_, reject) => {
				stallId = setTimeout(() => reject(mkStallError()), stallMs);
			});
			const totalPromise = new Promise<never>((_, reject) => {
				if (remainingTotal < AI_STALL_TIMEOUT_MS) {
					totalId = setTimeout(() => reject(mkTotalError()), remainingTotal);
				}
			});
			let next: IteratorResult<
				typeof result.fullStream extends AsyncIterable<infer U> ? U : never
			>;
			try {
				next = await Promise.race([
					iterator.next(),
					stallPromise,
					totalPromise,
				]);
			} finally {
				if (stallId !== undefined) clearTimeout(stallId);
				if (totalId !== undefined) clearTimeout(totalId);
			}
			if (next.done) break;
			const chunk = next.value as unknown as {
				type: string;
				text?: string;
				error?: unknown;
			};
			if (chunk.type === "reasoning-delta") {
				lastProgress = Date.now();
				onThinking?.(
					(chunk as { type: "reasoning-delta"; text: string }).text ?? "",
				);
				continue;
			}
			if (chunk.type === "text-delta") {
				if (!chunk.text) continue;
				lastProgress = Date.now();
				yieldedText = true;
				yield chunk.text;
				continue;
			}
			if (chunk.type === "error") {
				if (outcome) outcome.finishReason = "error";
				throw (chunk as { error: unknown }).error;
			}
			if (chunk.type === "abort") {
				if (outcome) outcome.finishReason = "aborted";
				throw new Error("AI stream aborted");
			}
			if (chunk.type === "finish") {
				// Capture the provider's terminal reason while consuming so
				// an early consumer exit still leaves an observable outcome.
				// Never clobber an explicit error recorded above.
				const reason = (chunk as { finishReason?: unknown }).finishReason;
				if (outcome && outcome.finishReason === undefined) {
					outcome.finishReason =
						typeof reason === "string" && reason ? reason : "unknown";
				}
			}
			// Other part types (start, finish, etc.) don't count as progress — stall
			// timer is NOT reset, so a stream that only emits non-progress stays bounded.
			if (Date.now() - lastProgress >= AI_STALL_TIMEOUT_MS)
				throw mkStallError();
		}
		if (!yieldedText) {
			if (outcome) outcome.finishReason = "error";
			throw new Error("Respons kosong dari chunk model.");
		}
	} catch (err) {
		if (outcome) {
			// Preserve a caller's intentional abort as "aborted" instead of
			// lumping it with provider failures: downstream credit/error
			// handling must be able to tell the two apart.
			const aborted =
				(signal?.aborted ?? false) ||
				(err instanceof Error && err.name === "AbortError") ||
				(err instanceof Error && err.message === "AI stream aborted");
			outcome.finishReason = aborted ? "aborted" : "error";
		}
		throw err;
	} finally {
		// A consumer that stops iterating early (return/break) never reaches
		// the finish-reason await below; leave whatever terminal signal was
		// actually observed instead of an empty outcome.
		if (outcome && outcome.finishReason === undefined) {
			outcome.finishReason = signal?.aborted ? "aborted" : "unknown";
		}
	}

	if (outcome) {
		// ponytail: PromiseLike, not Promise - no .catch(), so try/catch it.
		try {
			outcome.finishReason = await result.finishReason;
		} catch {
			outcome.finishReason = "error";
		}
	}
}

/**
 * Non-streaming completion. Accumulates streamChat chunks to handle 9router streaming format safely.
 */
export async function completeChat(
	messages: ChatMessage[],
	model?: string,
): Promise<string> {
	let fullText = "";
	for await (const chunk of streamChat(messages, model)) {
		fullText += chunk;
	}
	return fullText;
}
