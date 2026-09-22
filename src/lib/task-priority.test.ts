import { describe, expect, it } from "vitest";
import {
	DEFAULT_TASK_PRIORITY,
	normalizeTaskPriority,
	storedTaskPriority,
	TASK_PRIORITIES,
} from "./task-priority";

describe("TASK_PRIORITIES", () => {
	it("exposes exactly the three levels the Kanban maps to Utama/Penting/Pendukung", () => {
		expect([...TASK_PRIORITIES]).toEqual(["high", "medium", "low"]);
	});
});

describe("normalizeTaskPriority", () => {
	it("accepts each allowed level", () => {
		expect(normalizeTaskPriority("high")).toBe("high");
		expect(normalizeTaskPriority("medium")).toBe("medium");
		expect(normalizeTaskPriority("low")).toBe("low");
	});

	it("normalizes casing and surrounding whitespace", () => {
		expect(normalizeTaskPriority("  HIGH ")).toBe("high");
		expect(normalizeTaskPriority("Medium")).toBe("medium");
		expect(normalizeTaskPriority("\tLow\n")).toBe("low");
	});

	it("rejects unknown values instead of silently accepting them", () => {
		expect(normalizeTaskPriority("urgent")).toBeNull();
		expect(normalizeTaskPriority("critical")).toBeNull();
		expect(normalizeTaskPriority("tinggi")).toBeNull();
		expect(normalizeTaskPriority("")).toBeNull();
		expect(normalizeTaskPriority("   ")).toBeNull();
	});

	it("rejects non-string input", () => {
		expect(normalizeTaskPriority(null)).toBeNull();
		expect(normalizeTaskPriority(undefined)).toBeNull();
		expect(normalizeTaskPriority(1)).toBeNull();
		expect(normalizeTaskPriority({ priority: "high" })).toBeNull();
		expect(normalizeTaskPriority(["high"])).toBeNull();
	});
});

describe("storedTaskPriority", () => {
	it("returns the stored level when it is valid", () => {
		expect(storedTaskPriority("low")).toBe("low");
		expect(storedTaskPriority("HIGH")).toBe("high");
	});

	it("falls back to the documented default for legacy and invalid rows", () => {
		expect(storedTaskPriority(null)).toBe(DEFAULT_TASK_PRIORITY);
		expect(storedTaskPriority(undefined)).toBe(DEFAULT_TASK_PRIORITY);
		expect(storedTaskPriority("medium")).toBe("medium");
		expect(storedTaskPriority("bukan-level")).toBe(DEFAULT_TASK_PRIORITY);
	});
});
