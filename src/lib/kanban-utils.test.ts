import { describe, expect, it } from "vitest";
import {
	computeKanbanProgress,
	computeStatusCounts,
	detectAcChanged,
	extractPhases,
	filterColumnsByPhase,
	getTaskPriorityConfig,
	groupCardsByFeature,
	groupCardsByStatus,
	type TaskCard,
} from "./kanban-utils";

const mockCard = (overrides: Partial<TaskCard> = {}): TaskCard => ({
	id: "test-id",
	type: "task",
	featureName: "Auth",
	name: "Test Task",
	description: "desc",
	status: "pending",
	dependencies: [],
	startedAt: null,
	completedAt: null,
	...overrides,
});

describe("kanban-utils", () => {
	describe("groupCardsByStatus", () => {
		it("groups cards by their status column", () => {
			const cards = [
				mockCard({ id: "1", status: "pending" }),
				mockCard({ id: "2", status: "in_progress" }),
				mockCard({ id: "3", status: "completed" }),
				mockCard({ id: "4", status: "failed" }),
				mockCard({ id: "5", status: "pending" }),
			];

			const columns = groupCardsByStatus(cards);

			expect(columns.pending).toHaveLength(2);
			expect(columns.in_progress).toHaveLength(1);
			expect(columns.completed).toHaveLength(1);
			expect(columns.failed).toHaveLength(1);
		});

		it("returns empty arrays for empty input", () => {
			const columns = groupCardsByStatus([]);
			expect(columns.pending).toHaveLength(0);
			expect(columns.in_progress).toHaveLength(0);
			expect(columns.completed).toHaveLength(0);
			expect(columns.failed).toHaveLength(0);
		});
	});

	describe("groupCardsByFeature", () => {
		it("groups cards by feature name", () => {
			const cards = [
				mockCard({ id: "1", featureName: "Auth" }),
				mockCard({ id: "2", featureName: "Auth" }),
				mockCard({ id: "3", featureName: "Dashboard" }),
			];

			const groups = groupCardsByFeature(cards);

			expect(groups.Auth).toHaveLength(2);
			expect(groups.Dashboard).toHaveLength(1);
		});

		it("uses 'Umum' for empty feature name", () => {
			const cards = [mockCard({ id: "1", featureName: "" })];
			const groups = groupCardsByFeature(cards);
			expect(groups.Umum).toHaveLength(1);
		});

		it("groups prototype-named features as own data without throwing", () => {
			const protoName = "__proto__";
			const ctorName = "constructor";
			const cards = [
				mockCard({ id: "1", featureName: protoName }),
				mockCard({ id: "2", featureName: ctorName }),
			];
			const groups = groupCardsByFeature(cards);
			expect(Object.keys(groups)).toEqual(
				expect.arrayContaining([protoName, ctorName]),
			);
			expect(groups[protoName]).toHaveLength(1);
			expect(groups[ctorName]).toHaveLength(1);
		});
	});

	describe("computeStatusCounts", () => {
		it("counts cards per status", () => {
			const cards = [
				mockCard({ status: "pending" }),
				mockCard({ status: "pending" }),
				mockCard({ status: "in_progress" }),
				mockCard({ status: "completed" }),
			];

			const counts = computeStatusCounts(cards);

			expect(counts.pending).toBe(2);
			expect(counts.in_progress).toBe(1);
			expect(counts.completed).toBe(1);
			expect(counts.failed).toBe(0);
		});
	});

	describe("detectAcChanged", () => {
		it("returns true when AC was updated after tasks", () => {
			const result = detectAcChanged(
				"2026-07-21T12:00:00Z",
				"2026-07-20T10:00:00Z",
			);
			expect(result).toBe(true);
		});

		it("returns false when AC was before tasks", () => {
			const result = detectAcChanged(
				"2026-07-19T10:00:00Z",
				"2026-07-20T10:00:00Z",
			);
			expect(result).toBe(false);
		});

		it("returns false when either is null", () => {
			expect(detectAcChanged(null, "2026-07-20T10:00:00Z")).toBe(false);
			expect(detectAcChanged("2026-07-20T10:00:00Z", null)).toBe(false);
			expect(detectAcChanged(null, null)).toBe(false);
		});

		it("returns false when either is undefined", () => {
			expect(detectAcChanged(undefined, undefined)).toBe(false);
		});
	});

	describe("extractPhases", () => {
		it("extracts distinct phases preserving order with 1-based numbering", () => {
			const columns = {
				pending: [
					mockCard({ id: "1", featureName: "Auth" }),
					mockCard({ id: "2", featureName: "Dashboard" }),
				],
				in_progress: [mockCard({ id: "3", featureName: "Auth" })],
				completed: [mockCard({ id: "4", featureName: "Billing" })],
				failed: [],
			};

			const phases = extractPhases(columns);
			expect(phases).toHaveLength(3);
			expect(phases[0]).toEqual({
				id: "Auth",
				name: "Auth",
				phaseNumber: 1,
				label: "Fase 1: Auth",
			});
			expect(phases[1]).toEqual({
				id: "Dashboard",
				name: "Dashboard",
				phaseNumber: 2,
				label: "Fase 2: Dashboard",
			});
			expect(phases[2]).toEqual({
				id: "Billing",
				name: "Billing",
				phaseNumber: 3,
				label: "Fase 3: Billing",
			});
		});

		it("falls back to 'Umum' if featureName is empty", () => {
			const cards = [mockCard({ id: "1", featureName: "" })];
			const phases = extractPhases(cards);
			expect(phases).toHaveLength(1);
			expect(phases[0]?.name).toBe("Umum");
			expect(phases[0]?.label).toBe("Fase 1: Umum");
		});

		it("returns empty array when there are no tasks", () => {
			expect(extractPhases([])).toEqual([]);
		});
	});

	describe("filterColumnsByPhase", () => {
		const columns = {
			pending: [
				mockCard({ id: "1", status: "pending", featureName: "Auth" }),
				mockCard({ id: "2", status: "pending", featureName: "Dashboard" }),
			],
			in_progress: [
				mockCard({ id: "3", status: "in_progress", featureName: "Auth" }),
			],
			completed: [
				mockCard({ id: "4", status: "completed", featureName: "Billing" }),
			],
			failed: [],
		};

		it("returns all columns unchanged when phase is null, undefined, or 'all'", () => {
			expect(filterColumnsByPhase(columns, null)).toEqual(columns);
			expect(filterColumnsByPhase(columns, undefined)).toEqual(columns);
			expect(filterColumnsByPhase(columns, "all")).toEqual(columns);
		});

		it("filters tasks by selected phase across all columns", () => {
			const filtered = filterColumnsByPhase(columns, "Auth");
			expect(filtered.pending).toHaveLength(1);
			expect(filtered.pending[0]?.id).toBe("1");
			expect(filtered.in_progress).toHaveLength(1);
			expect(filtered.in_progress[0]?.id).toBe("3");
			expect(filtered.completed).toHaveLength(0);
			expect(filtered.failed).toHaveLength(0);
		});

		it("returns empty columns when selected phase has no tasks", () => {
			const filtered = filterColumnsByPhase(columns, "Nonexistent");
			expect(filtered.pending).toHaveLength(0);
			expect(filtered.in_progress).toHaveLength(0);
			expect(filtered.completed).toHaveLength(0);
			expect(filtered.failed).toHaveLength(0);
		});
	});

	describe("computeKanbanProgress", () => {
		it("computes total, done, and percentage correctly", () => {
			const columns = {
				pending: [mockCard({ status: "pending" })],
				in_progress: [mockCard({ status: "in_progress" })],
				completed: [mockCard({ status: "completed" })],
				failed: [mockCard({ status: "failed" })],
			};
			const progress = computeKanbanProgress(columns);
			expect(progress.total).toBe(4);
			expect(progress.done).toBe(2); // completed + failed
			expect(progress.pct).toBe(50);
		});

		it("returns 0 pct for 0 total tasks", () => {
			const progress = computeKanbanProgress({
				pending: [],
				in_progress: [],
				completed: [],
				failed: [],
			});
			expect(progress.total).toBe(0);
			expect(progress.done).toBe(0);
			expect(progress.pct).toBe(0);
		});
	});

	describe("getTaskPriorityConfig", () => {
		it("maps high/utama priority to Utama with 3 bars and amber styling", () => {
			const high = getTaskPriorityConfig("high");
			expect(high.label).toBe("Utama");
			expect(high.level).toBe("utama");
			expect(high.barCount).toBe(3);
			expect(high.barClassName).toContain("amber");
			expect(high.textClassName).toContain("amber");

			const utama = getTaskPriorityConfig("utama");
			expect(utama.label).toBe("Utama");
			expect(utama.barCount).toBe(3);

			const urgent = getTaskPriorityConfig("urgent");
			expect(urgent.label).toBe("Utama");
			expect(urgent.barCount).toBe(3);
		});

		it("maps low/pendukung priority to Pendukung with 1 bar and subtle styling", () => {
			const low = getTaskPriorityConfig("low");
			expect(low.label).toBe("Pendukung");
			expect(low.level).toBe("pendukung");
			expect(low.barCount).toBe(1);
			expect(low.barClassName).toContain("slate");

			const pendukung = getTaskPriorityConfig("pendukung");
			expect(pendukung.label).toBe("Pendukung");
			expect(pendukung.barCount).toBe(1);

			const supporting = getTaskPriorityConfig("supporting");
			expect(supporting.label).toBe("Pendukung");
			expect(supporting.barCount).toBe(1);
		});

		it("maps medium and legacy/null/undefined to Penting as safe default with 2 bars", () => {
			const medium = getTaskPriorityConfig("medium");
			expect(medium.label).toBe("Penting");
			expect(medium.level).toBe("penting");
			expect(medium.barCount).toBe(2);
			expect(medium.barClassName).toContain("indigo");

			const empty = getTaskPriorityConfig(null);
			expect(empty.label).toBe("Penting");
			expect(empty.barCount).toBe(2);

			const undef = getTaskPriorityConfig(undefined);
			expect(undef.label).toBe("Penting");
			expect(undef.barCount).toBe(2);

			const unknown = getTaskPriorityConfig("custom_unknown_val");
			expect(unknown.label).toBe("Penting");
			expect(unknown.barCount).toBe(2);
		});
	});
});
