import { describe, expect, it } from "vitest";
import {
	hasNonPendingSubtask,
	needsProgressReset,
	normalizeSubtasksForReset,
} from "./task-reset";

describe("normalizeSubtasksForReset", () => {
	it("sets every subtask status to pending and keeps other fields", () => {
		const result = normalizeSubtasksForReset([
			{
				name: "Buat tabel",
				description: "Migrasi drizzle",
				details: ["kolom id", "kolom nama"],
				status: "completed",
			},
		]);
		expect(result).toEqual([
			{
				name: "Buat tabel",
				description: "Migrasi drizzle",
				details: ["kolom id", "kolom nama"],
				status: "pending",
			},
		]);
	});

	it("drops entries that are not objects with a string name", () => {
		const result = normalizeSubtasksForReset([
			null,
			"bukan objek",
			42,
			{ status: "completed" },
			{ name: 123, status: "completed" },
			{ name: "Valid", status: "failed" },
		]);
		expect(result).toEqual([{ name: "Valid", status: "pending" }]);
	});

	it("returns an empty array for non-array input", () => {
		expect(normalizeSubtasksForReset(null)).toEqual([]);
		expect(normalizeSubtasksForReset(undefined)).toEqual([]);
		expect(normalizeSubtasksForReset({})).toEqual([]);
		expect(normalizeSubtasksForReset("x")).toEqual([]);
	});

	it("does not mutate the input array", () => {
		const input = [{ name: "A", status: "completed" }];
		normalizeSubtasksForReset(input);
		expect(input[0].status).toBe("completed");
	});
});

describe("hasNonPendingSubtask", () => {
	it("reads the raw value and reports completed subtasks", () => {
		expect(hasNonPendingSubtask([{ name: "A", status: "completed" }])).toBe(
			true,
		);
		expect(hasNonPendingSubtask([{ name: "A", status: "pending" }])).toBe(
			false,
		);
	});

	it("is false for non-array input", () => {
		expect(hasNonPendingSubtask(null)).toBe(false);
		expect(hasNonPendingSubtask({})).toBe(false);
	});

	it("ignores malformed entries", () => {
		expect(hasNonPendingSubtask([null, "x", { status: "completed" }])).toBe(
			false,
		);
	});

	it("treats a missing status as non-pending", () => {
		expect(hasNonPendingSubtask([{ name: "A" }])).toBe(true);
	});
});

describe("needsProgressReset", () => {
	it("is false for an empty task list", () => {
		expect(needsProgressReset([])).toBe(false);
	});

	it("is false when every task and subtask is pending", () => {
		expect(
			needsProgressReset([
				{ status: "pending", subtasks: [{ name: "A", status: "pending" }] },
			]),
		).toBe(false);
	});

	it("is true when a task status is not pending", () => {
		expect(needsProgressReset([{ status: "completed", subtasks: [] }])).toBe(
			true,
		);
		expect(needsProgressReset([{ status: "in_progress", subtasks: [] }])).toBe(
			true,
		);
		expect(needsProgressReset([{ status: "failed", subtasks: [] }])).toBe(true);
	});

	it("is true when a subtask is not pending even if the task is pending", () => {
		expect(
			needsProgressReset([
				{ status: "pending", subtasks: [{ name: "A", status: "completed" }] },
			]),
		).toBe(true);
	});

	it("treats a null task status as needing reset", () => {
		expect(needsProgressReset([{ status: null, subtasks: [] }])).toBe(true);
	});

	it("ignores malformed subtask entries", () => {
		expect(
			needsProgressReset([
				{ status: "pending", subtasks: [null, "x", { status: "completed" }] },
			]),
		).toBe(false);
	});
});
