import { describe, expect, it } from "vitest";
import { extractJson } from "./json-extract";

describe("extractJson", () => {
	it("extracts JSON from a fenced block", () => {
		const raw = '```json\n{"a": 1}\n```';
		expect(JSON.parse(extractJson(raw))).toEqual({ a: 1 });
	});

	it("does not truncate when a JSON string value itself contains a code fence", () => {
		// Root cause of the "Gagal generate task tree" bug: a non-greedy fence
		// regex stopped at the FIRST ``` it saw, which can live inside a task's
		// "details" string (e.g. a shell command), cutting the JSON mid-object.
		const raw = '```json\n{"details": ["run ```pnpm install```"]}\n```';
		const parsed = JSON.parse(extractJson(raw));
		expect(parsed.details[0]).toContain("pnpm install");
	});

	it("falls back to brace-slicing when there is no fence", () => {
		const raw = 'noise before {"a": 1} noise after';
		expect(JSON.parse(extractJson(raw))).toEqual({ a: 1 });
	});

	it("prefers the valid fence when a later unrelated fence exists", () => {
		const raw =
			'```json\n{"a": 1}\n```\n\nSome closing notes:\n```text\nbye\n```';
		expect(JSON.parse(extractJson(raw))).toEqual({ a: 1 });
	});

	it("ignores braces inside prose and JSON strings when scanning", () => {
		const raw = 'Use `{foo}` and return {"ok":true} trailing';
		expect(JSON.parse(extractJson(raw))).toEqual({ ok: true });
	});
});
