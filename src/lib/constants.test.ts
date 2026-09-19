import { describe, expect, it } from "vitest";
import {
	AI_MODELS,
	CODEBASE_ASK_HANDOFF_SAVE_TIMEOUT_MS,
	CODEBASE_GENERATION_MAX_CONSTRAINTS,
	CODEBASE_GENERATION_MAX_SUMMARY_CHARS,
	HISTORY_PAGE_SIZE,
	HOME_DRAFT_DEBOUNCE_MS,
	MAX_PROMPT_LENGTH,
	MIN_PROMPT_LENGTH,
	PDF_STYLES,
	RATE_LIMIT_WINDOW_MS,
	RATE_LIMITS,
} from "./constants";

describe("AI_MODELS", () => {
	it("has primary model", () => {
		expect(AI_MODELS.primary).toBeTruthy();
		expect(typeof AI_MODELS.primary).toBe("string");
	});

	it("has fallback and premium models", () => {
		expect(AI_MODELS.fallback).toBeTruthy();
		expect(AI_MODELS.premium).toBeTruthy();
	});

	it("all point to combo model", () => {
		expect(AI_MODELS.primary).toBe("prdfy-combo");
		expect(AI_MODELS.fallback).toBe("prdfy-combo");
		expect(AI_MODELS.premium).toBe("prdfy-combo");
	});
});

describe("RATE_LIMITS", () => {
	it("free tier has lowest limit", () => {
		expect(RATE_LIMITS.free).toBe(5);
		expect(RATE_LIMITS.pro).toBeGreaterThan(RATE_LIMITS.free);
		expect(RATE_LIMITS.hengker).toBeGreaterThan(RATE_LIMITS.pro);
	});
});

describe("constants", () => {
	it("has valid RATE_LIMIT_WINDOW_MS", () => {
		expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
	});
});

describe("no-hardcode constants (Task 1)", () => {
	it("constants exist and sane", () => {
		expect(MIN_PROMPT_LENGTH).toBe(20);
		expect(MAX_PROMPT_LENGTH).toBe(3000);
		expect(HISTORY_PAGE_SIZE).toBe(12);
	});

	it("has debounce limit", () => {
		expect(HOME_DRAFT_DEBOUNCE_MS).toBe(300);
	});

	it("has PDF_STYLES", () => {
		expect(PDF_STYLES.font).toBe("Inter");
		expect(PDF_STYLES.headerSize).toBe(14);
		expect(PDF_STYLES.bodySize).toBe(11);
	});

	it("has Task 9 codebase hardening limits (no magic literals)", () => {
		expect(CODEBASE_GENERATION_MAX_SUMMARY_CHARS).toBe(2_000);
		expect(CODEBASE_GENERATION_MAX_CONSTRAINTS).toBe(10);
		expect(CODEBASE_ASK_HANDOFF_SAVE_TIMEOUT_MS).toBe(8_000);
	});
});
