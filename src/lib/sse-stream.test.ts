import { describe, expect, it } from "vitest";
import { createSseLineParser, readSseStream } from "./sse-stream";

describe("createSseLineParser", () => {
	it("parses single data line with trailing newline", () => {
		const parser = createSseLineParser();
		const enc = new TextEncoder();
		const lines = parser.feed(enc.encode('data: {"type":"started"}\n\n'));
		expect(lines).toEqual(['{"type":"started"}']);
		expect(parser.end()).toEqual([]);
	});

	it("flushes trailing line when end() is called without trailing newline", () => {
		const parser = createSseLineParser();
		const enc = new TextEncoder();
		// Final chunk arriving without trailing \n
		const lines = parser.feed(enc.encode('data: {"type":"done"}'));
		expect(lines).toEqual([]);
		// end() flushes the buffer
		expect(parser.end()).toEqual(['{"type":"done"}']);
	});

	it("handles chunk split across data line and payload", () => {
		const parser = createSseLineParser();
		const enc = new TextEncoder();
		expect(parser.feed(enc.encode("data: " + '{"type":"thi'))).toEqual([]);
		expect(parser.feed(enc.encode('nking","content":"abc"}\n\n'))).toEqual([
			'{"type":"thinking","content":"abc"}',
		]);
		expect(parser.end()).toEqual([]);
	});

	it("normalizes CRLF line endings", () => {
		const parser = createSseLineParser();
		const enc = new TextEncoder();
		const lines = parser.feed(enc.encode('data: {"msg":"ok"}\r\n\r\n'));
		expect(lines).toEqual(['{"msg":"ok"}']);
	});
});

describe("readSseStream", () => {
	it("yields all frames including final un-terminated frame", async () => {
		const enc = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(enc.encode('data: {"type":"started"}\n\n'));
				controller.enqueue(enc.encode('data: {"type":"delta","c":"1"}\n'));
				// Final event without newline before close
				controller.enqueue(enc.encode('data: {"type":"done"}'));
				controller.close();
			},
		});

		const events: string[] = [];
		for await (const data of readSseStream(stream)) {
			events.push(data);
		}

		expect(events).toEqual([
			'{"type":"started"}',
			'{"type":"delta","c":"1"}',
			'{"type":"done"}',
		]);
	});

	it("returns gracefully if stream is null or undefined", async () => {
		const events: string[] = [];
		for await (const data of readSseStream(null)) {
			events.push(data);
		}
		expect(events).toEqual([]);
	});
});
