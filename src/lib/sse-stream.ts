export interface SseEvent {
	data: string;
}

/**
 * Incrementally parses an SSE byte stream into `data:` payload strings.
 * Flushes the trailing buffer (with flush=true) when the reader closes so a
 * final event without a trailing newline is never dropped, and normalizes
 * `\r` line endings.
 */
export function createSseLineParser() {
	const decoder = new TextDecoder();
	let buffer = "";

	return {
		feed(chunk: Uint8Array, flush = false): string[] {
			buffer += decoder.decode(chunk, { stream: !flush });
			if (flush) buffer += decoder.decode();
			const parts = buffer.split(/\r?\n/);
			buffer = flush ? "" : (parts.pop() ?? "");
			return parts
				.filter((line) => line.startsWith("data: "))
				.map((line) => line.slice(6));
		},
		end(): string[] {
			return this.feed(new Uint8Array(), true);
		},
	};
}

/**
 * Reads a fetch `ReadableStream` of SSE frames and yields every `data:`
 * payload string, including a final frame that lacks a trailing newline.
 */
export async function* readSseStream(
	body: ReadableStream<Uint8Array> | null | undefined,
): AsyncGenerator<string, void> {
	if (!body) return;
	const reader = body.getReader();
	const parser = createSseLineParser();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			for (const data of parser.feed(value)) yield data;
		}
		for (const data of parser.end()) yield data;
	} finally {
		reader.releaseLock();
	}
}
