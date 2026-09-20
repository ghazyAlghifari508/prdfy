import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
	assertCompletePrdOutput,
	countPrdSectionMarkers,
	generateShareToken,
} from "./prd-service";

describe("generateShareToken", () => {
	it("returns a 12 character string", () => {
		const token = generateShareToken();
		expect(token).toHaveLength(12);
	});

	it("generates unique tokens", () => {
		const tokens = new Set(
			Array.from({ length: 100 }, () => generateShareToken()),
		);
		expect(tokens.size).toBe(100);
	});
});

describe("countPrdSectionMarkers", () => {
	it("counts unique section markers", () => {
		const content = [
			"<!-- SECTION: Overview -->",
			"<!-- SECTION: Goals -->",
			"<!-- SECTION: Goals -->",
		].join("\n");
		expect(countPrdSectionMarkers(content)).toBe(2);
	});
});

describe("assertCompletePrdOutput", () => {
	function eightSections(): string {
		return Array.from(
			{ length: 8 },
			(_, index) => `<!-- SECTION: Section ${index + 1} -->`,
		).join("\n");
	}

	it("accepts a document carrying all eight unique sections", () => {
		expect(() => assertCompletePrdOutput(eightSections())).not.toThrow();
	});

	it("rejects a truncated document with fewer than eight sections", () => {
		const truncated = eightSections().split("\n").slice(0, 4).join("\n");
		expect(() => assertCompletePrdOutput(truncated)).toThrow(/8 section/i);
	});

	it("accepts empty content so the caller can decide", () => {
		expect(() => assertCompletePrdOutput("")).not.toThrow();
	});
});

describe("savePrdVersion contract", () => {
	it("validates output and serializes version allocation before touching the share token", async () => {
		const source = await readFile(
			new URL("./prd-service.ts", import.meta.url),
			"utf8",
		);
		const validationIndex = source.indexOf(
			"assertCompletePrdOutput(cleanContent)",
		);
		const transactionIndex = source.indexOf('.for("update")');
		const shareTokenIndex = source.indexOf("projectUpdate.shareToken");
		const retryIndex = source.indexOf("23505");

		expect(validationIndex).toBeGreaterThan(-1);
		expect(transactionIndex).toBeGreaterThan(validationIndex);
		expect(shareTokenIndex).toBeGreaterThan(transactionIndex);
		// The message-string retry heuristic is gone: allocation is serialized
		// by the project row lock instead.
		expect(retryIndex).toBe(-1);
	});
});
