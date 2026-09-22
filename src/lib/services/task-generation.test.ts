import { describe, expect, it, vi } from "vitest";
import {
	buildTaskSystemPrompt,
	MAX_TASK_COVERAGE_REPAIR_ATTEMPTS,
	repairTaskCoverage,
} from "./task-generation";
import type { TaskTree } from "./task-service";

const AC = [
	"## 1. Checkout",
	"### AC-1.1 Cart state",
	"### AC-1.2 Quantity validation",
	"### AC-1.3 Stock validation",
	"## 2. Pembayaran",
	"### AC-2.1 Payment initiation",
	"### AC-2.2 Payment callback",
].join("\n");

function task(
	name: string,
	covers: string[],
	priority: TaskTree["features"][number]["tasks"][number]["priority"] = "medium",
	surfaces: string[] = [],
): TaskTree["features"][number]["tasks"][number] {
	return {
		name,
		description: `${name} description`,
		priority,
		covers,
		surfaces,
		subtasks: [
			{
				name: `${name} subtask`,
				description: "detail",
				details: ["langkah 1"],
			},
		],
	};
}

function tree(...features: TaskTree["features"]): TaskTree {
	return { features };
}

describe("buildTaskSystemPrompt", () => {
	it("includes both the PRD context and the AC document", () => {
		const prompt = buildTaskSystemPrompt({
			acMarkdown: AC,
			prdContent: [
				"## 6. Architecture & Tech Stack",
				"### 6.2 Tech Stack",
				"| Layer | Technology |",
				"| --- | --- |",
				"| DB | PostgreSQL |",
			].join("\n"),
			grounded: "",
			codebaseBlock: "",
			language: "id",
		});
		expect(prompt).toContain("PostgreSQL");
		expect(prompt).toContain("AC-1.1");
		expect(prompt).toContain("covers");
	});

	it("states the priority contract and the surfaces contract", () => {
		const prompt = buildTaskSystemPrompt({
			acMarkdown: AC,
			prdContent: "## 5. User Flow\n### 5.3 Pages & Screens\n#### Cart",
			grounded: "",
			codebaseBlock: "",
			language: "id",
		});
		expect(prompt).toContain("priority");
		expect(prompt).toContain('"high"');
		expect(prompt).toContain('"medium"');
		expect(prompt).toContain('"low"');
		expect(prompt).toContain("surfaces");
		expect(prompt).toContain("Pages & Screens");
		// No distribution or quota may be demanded.
		expect(prompt).toMatch(/JANGAN memakai distribusi atau kuota/i);
	});

	it("still produces a usable prompt when the PRD is absent", () => {
		const prompt = buildTaskSystemPrompt({
			acMarkdown: AC,
			prdContent: "",
			grounded: "",
			codebaseBlock: "",
			language: "id",
		});
		expect(prompt).toContain("AC-1.1");
		// No empty PRD frame should be emitted.
		expect(prompt).not.toContain("--- PRD (PRODUCT CONTEXT) ---");
	});
});

describe("repairTaskCoverage", () => {
	it("accepts a tree that covers every requirement without repairing", async () => {
		const requestRepair = vi.fn();
		const result = await repairTaskCoverage({
			acMarkdown: AC,
			initialTree: tree(
				{
					name: "1. Checkout",
					tasks: [
						task("Cart state", ["AC-1.1"]),
						task("Validasi quantity", ["AC-1.2"]),
						task("Validasi stok", ["AC-1.3"]),
					],
				},
				{
					name: "2. Pembayaran",
					tasks: [task("Pembayaran", ["AC-2.1", "AC-2.2"])],
				},
			),
			requestRepair,
			parse: () => null,
			maxAttempts: MAX_TASK_COVERAGE_REPAIR_ATTEMPTS,
		});
		expect(result.ok).toBe(true);
		expect(result.repairRounds).toBe(0);
		expect(requestRepair).not.toHaveBeenCalled();
	});

	it("repairs a missing requirement and merges without duplicating tasks", async () => {
		const initial = tree({
			name: "1. Checkout",
			tasks: [
				task("Cart state", ["AC-1.1"]),
				task("Validasi quantity", ["AC-1.2"]),
			],
		});
		const repairPayload = tree({
			name: "1. Checkout",
			tasks: [
				// Same name as an existing task: must merge, not duplicate.
				task("Cart state", ["AC-1.3"]),
				task("Inisiasi pembayaran", ["AC-2.1", "AC-2.2"]),
			],
		});

		const result = await repairTaskCoverage({
			acMarkdown: AC,
			initialTree: initial,
			requestRepair: async (missing) => {
				expect(missing).toEqual(["AC-1.3", "AC-2.1", "AC-2.2"]);
				return "{}";
			},
			parse: () => repairPayload,
			maxAttempts: MAX_TASK_COVERAGE_REPAIR_ATTEMPTS,
		});

		expect(result.ok).toBe(true);
		expect(result.repairRounds).toBe(1);
		const tasks = result.ok ? result.tree.features[0].tasks : [];
		// "Cart state" must appear exactly once, with unioned coverage.
		expect(tasks.filter((t) => t.name === "Cart state")).toHaveLength(1);
		expect(tasks.find((t) => t.name === "Cart state")?.covers).toEqual([
			"AC-1.1",
			"AC-1.3",
		]);
		expect(tasks.map((t) => t.name)).toEqual([
			"Cart state",
			"Validasi quantity",
			"Inisiasi pembayaran",
		]);
	});

	it("fails honestly when coverage cannot be completed within the bound", async () => {
		const result = await repairTaskCoverage({
			acMarkdown: AC,
			initialTree: tree({
				name: "1. Checkout",
				tasks: [task("Cart state", ["AC-1.1"])],
			}),
			// Repair keeps returning the same incomplete tree.
			requestRepair: async () => "{}",
			parse: () =>
				tree({ name: "1. Checkout", tasks: [task("Cart state", ["AC-1.1"])] }),
			maxAttempts: MAX_TASK_COVERAGE_REPAIR_ATTEMPTS,
		});
		expect(result.ok).toBe(false);
		expect(result.report.missing).toEqual([
			"AC-1.2",
			"AC-1.3",
			"AC-2.1",
			"AC-2.2",
		]);
	});

	it("stops early when a repair round adds nothing new", async () => {
		const requestRepair = vi.fn(async () => "{}");
		const result = await repairTaskCoverage({
			acMarkdown: AC,
			initialTree: tree({
				name: "1. Checkout",
				tasks: [task("Cart state", ["AC-1.1"])],
			}),
			requestRepair,
			// A repair answer that repeats existing tasks cannot help.
			parse: () =>
				tree({ name: "1. Checkout", tasks: [task("Cart state", ["AC-1.1"])] }),
			maxAttempts: MAX_TASK_COVERAGE_REPAIR_ATTEMPTS,
		});
		expect(result.ok).toBe(false);
		expect(requestRepair).toHaveBeenCalledTimes(1);
	});

	it("rejects a tree referencing a requirement that does not exist", async () => {
		const result = await repairTaskCoverage({
			acMarkdown: AC,
			initialTree: tree({
				name: "1. Checkout",
				tasks: [task("Cart state", ["AC-1.1", "AC-9.9"])],
			}),
			requestRepair: async () => "{}",
			parse: () => null,
			maxAttempts: MAX_TASK_COVERAGE_REPAIR_ATTEMPTS,
		});
		expect(result.ok).toBe(false);
		expect(result.report.unknown).toEqual(["AC-9.9"]);
	});

	it("stops repairing when the request is aborted", async () => {
		const requestRepair = vi.fn(async () => "{}");
		const result = await repairTaskCoverage({
			acMarkdown: AC,
			initialTree: tree({
				name: "1. Checkout",
				tasks: [task("Cart state", ["AC-1.1"])],
			}),
			requestRepair,
			parse: () => null,
			maxAttempts: MAX_TASK_COVERAGE_REPAIR_ATTEMPTS,
			isAborted: () => true,
		});
		expect(result.ok).toBe(false);
		expect(requestRepair).not.toHaveBeenCalled();
	});

	it("handles a feature with many requirements without collapsing them", async () => {
		const manyAc = Array.from(
			{ length: 12 },
			(_, i) => `### AC-1.${i + 1} Requirement ${i + 1}`,
		).join("\n");
		// First pass only covers the first two.
		const initial = tree({
			name: "Fitur besar",
			tasks: [task("Awal", ["AC-1.1", "AC-1.2"])],
		});
		const repairPayload = tree({
			name: "Fitur besar",
			tasks: Array.from({ length: 10 }, (_, i) =>
				task(`Deliverable ${i + 3}`, [`AC-1.${i + 3}`]),
			),
		});
		const result = await repairTaskCoverage({
			acMarkdown: manyAc,
			initialTree: initial,
			requestRepair: async () => "{}",
			parse: () => repairPayload,
			maxAttempts: MAX_TASK_COVERAGE_REPAIR_ATTEMPTS,
		});
		expect(result.ok).toBe(true);
		const totalTasks = result.ok
			? result.tree.features.reduce((sum, f) => sum + f.tasks.length, 0)
			: 0;
		// 12 requirements must not collapse into a couple of meaningless tasks.
		expect(totalTasks).toBe(11);
	});

	it("accepts a small project with a single requirement", async () => {
		const result = await repairTaskCoverage({
			acMarkdown: "### AC-1.1 Satu-satunya requirement",
			initialTree: tree({ name: "Fitur", tasks: [task("Satu", ["AC-1.1"])] }),
			requestRepair: async () => "{}",
			parse: () => null,
			maxAttempts: MAX_TASK_COVERAGE_REPAIR_ATTEMPTS,
		});
		expect(result.ok).toBe(true);
	});

	it("preserves the priority of repair-generated tasks", async () => {
		const result = await repairTaskCoverage({
			acMarkdown: AC,
			initialTree: tree({
				name: "1. Checkout",
				tasks: [task("Cart state", ["AC-1.1"], "high")],
			}),
			requestRepair: async () => "{}",
			parse: () =>
				tree({
					name: "1. Checkout",
					tasks: [
						task("Validasi quantity", ["AC-1.2"], "medium"),
						task("Validasi stok", ["AC-1.3"], "low"),
						task("Pembayaran", ["AC-2.1", "AC-2.2"], "high"),
					],
				}),
			maxAttempts: MAX_TASK_COVERAGE_REPAIR_ATTEMPTS,
		});
		expect(result.ok).toBe(true);
		const tasks = result.ok ? result.tree.features[0].tasks : [];
		expect(tasks.map((t) => [t.name, t.priority])).toEqual([
			["Cart state", "high"],
			["Validasi quantity", "medium"],
			["Validasi stok", "low"],
			["Pembayaran", "high"],
		]);
	});

	it("keeps the existing task priority when a repair merges coverage into it", async () => {
		const result = await repairTaskCoverage({
			acMarkdown: AC,
			initialTree: tree({
				name: "1. Checkout",
				tasks: [task("Cart state", ["AC-1.1"], "low")],
			}),
			requestRepair: async () => "{}",
			parse: () =>
				tree(
					{
						name: "1. Checkout",
						tasks: [
							// Same name as the existing task: coverage merges into it and
							// its original classification must survive.
							task("Cart state", ["AC-1.2"], "high"),
							task("Validasi stok", ["AC-1.3"], "medium"),
						],
					},
					{
						name: "2. Pembayaran",
						tasks: [task("Pembayaran", ["AC-2.1", "AC-2.2"], "high")],
					},
				),
			maxAttempts: MAX_TASK_COVERAGE_REPAIR_ATTEMPTS,
		});
		expect(result.ok).toBe(true);
		const tasks = result.ok ? result.tree.features[0].tasks : [];
		expect(tasks.map((t) => [t.name, t.priority])).toEqual([
			["Cart state", "low"],
			["Validasi stok", "medium"],
		]);
	});

	it("preserves and unions surface references across a repair", async () => {
		const result = await repairTaskCoverage({
			acMarkdown: AC,
			initialTree: tree({
				name: "1. Checkout",
				tasks: [task("Cart state", ["AC-1.1"], "high", ["Product Detail"])],
			}),
			requestRepair: async () => "{}",
			parse: () =>
				tree(
					{
						name: "1. Checkout",
						tasks: [
							// Same task name: merges, so surfaces must be unioned.
							task("Cart state", ["AC-1.2"], "medium", [
								"product detail",
								"Cart",
							]),
							task("Validasi stok", ["AC-1.3"], "medium"),
						],
					},
					{
						name: "2. Pembayaran",
						tasks: [
							task("Pembayaran", ["AC-2.1", "AC-2.2"], "high", ["Checkout"]),
						],
					},
				),
			maxAttempts: MAX_TASK_COVERAGE_REPAIR_ATTEMPTS,
		});
		expect(result.ok).toBe(true);
		const tasks = result.ok
			? result.tree.features.flatMap((feature) => feature.tasks)
			: [];
		expect(tasks.find((t) => t.name === "Cart state")?.surfaces).toEqual([
			"Product Detail",
			"Cart",
		]);
		expect(tasks.find((t) => t.name === "Pembayaran")?.surfaces).toEqual([
			"Checkout",
		]);
		expect(tasks.find((t) => t.name === "Validasi stok")?.surfaces).toEqual([]);
	});

	it("is complete for an AC document with no identifiers", async () => {
		const result = await repairTaskCoverage({
			acMarkdown: "## Fitur tanpa penomoran",
			initialTree: tree({ name: "Fitur", tasks: [task("Kerjakan", [])] }),
			requestRepair: async () => "{}",
			parse: () => null,
			maxAttempts: MAX_TASK_COVERAGE_REPAIR_ATTEMPTS,
		});
		expect(result.ok).toBe(true);
	});
});
