import { describe, expect, it } from "vitest";
import { parseTaskJson } from "./task-service";

describe("parseTaskJson", () => {
	it("parses a tree with structured coverage", () => {
		const parsed = parseTaskJson(
			JSON.stringify({
				features: [
					{
						name: "Checkout",
						tasks: [
							{
								name: "Cart state",
								description: "State keranjang",
								priority: "high",
								covers: ["AC-1.1", "AC-1.2"],
								subtasks: [
									{
										name: "Store",
										description: "Store keranjang",
										details: ["Buat store dengan items dan total"],
									},
								],
							},
						],
					},
				],
			}),
		);
		expect(parsed).not.toBeNull();
		expect(parsed?.features[0].tasks[0].covers).toEqual(["AC-1.1", "AC-1.2"]);
	});

	it("normalizes coverage identifiers to uppercase and de-duplicates", () => {
		const parsed = parseTaskJson(
			JSON.stringify({
				features: [
					{
						name: "Fitur",
						tasks: [
							{
								name: "Task",
								description: "d",
								priority: "medium",
								covers: ["ac-1.1", "AC-1.1", "AC-2.3"],
								subtasks: [],
							},
						],
					},
				],
			}),
		);
		expect(parsed?.features[0].tasks[0].covers).toEqual(["AC-1.1", "AC-2.3"]);
	});

	it("falls back to prose references for a legacy tree without covers", () => {
		const parsed = parseTaskJson(
			JSON.stringify({
				features: [
					{
						name: "Fitur",
						tasks: [
							{
								name: "Task lama",
								description: "Mengerjakan sesuatu. (Cover AC-3.1, AC-3.2)",
								priority: "low",
								subtasks: [],
							},
						],
					},
				],
			}),
		);
		expect(parsed?.features[0].tasks[0].covers).toEqual(["AC-3.1", "AC-3.2"]);
	});

	it("yields empty coverage for a task with no references", () => {
		const parsed = parseTaskJson(
			JSON.stringify({
				features: [
					{
						name: "Fitur",
						tasks: [
							{
								name: "Task",
								description: "Tanpa referensi",
								priority: "medium",
								subtasks: [],
							},
						],
					},
				],
			}),
		);
		expect(parsed?.features[0].tasks[0].covers).toEqual([]);
	});

	it("drops coverage entries that are not AC identifiers", () => {
		const parsed = parseTaskJson(
			JSON.stringify({
				features: [
					{
						name: "Fitur",
						tasks: [
							{
								name: "Task",
								description: "d",
								priority: "medium",
								covers: ["AC-1.1", "bukan-id", ""],
								subtasks: [],
							},
						],
					},
				],
			}),
		);
		expect(parsed?.features[0].tasks[0].covers).toEqual(["AC-1.1"]);
	});

	it("rejects malformed JSON", () => {
		expect(parseTaskJson("{ not json")).toBeNull();
	});

	it("rejects a payload with no features", () => {
		expect(parseTaskJson(JSON.stringify({ features: [] }))).toBeNull();
		expect(parseTaskJson(JSON.stringify({}))).toBeNull();
	});

	it("rejects a non-array covers field", () => {
		expect(
			parseTaskJson(
				JSON.stringify({
					features: [
						{
							name: "Fitur",
							tasks: [
								{
									name: "Task",
									description: "d",
									priority: "medium",
									covers: "AC-1.1",
									subtasks: [],
								},
							],
						},
					],
				}),
			),
		).toBeNull();
	});

	it("rejects a non-string entry inside covers", () => {
		expect(
			parseTaskJson(
				JSON.stringify({
					features: [
						{
							name: "Fitur",
							tasks: [
								{
									name: "Task",
									description: "d",
									priority: "medium",
									covers: ["AC-1.1", 42],
									subtasks: [],
								},
							],
						},
					],
				}),
			),
		).toBeNull();
	});

	it("preserves many tasks without truncation", () => {
		const features = Array.from({ length: 3 }, (_, fi) => ({
			name: `Fitur ${fi + 1}`,
			tasks: Array.from({ length: 20 }, (_, ti) => ({
				name: `Task ${fi + 1}.${ti + 1}`,
				description: "d",
				priority: "medium",
				covers: [`AC-${fi + 1}.${ti + 1}`],
				subtasks: [{ name: "s", description: "d", details: ["langkah"] }],
			})),
		}));
		const parsed = parseTaskJson(JSON.stringify({ features }));
		const total = parsed?.features.reduce((sum, f) => sum + f.tasks.length, 0);
		expect(total).toBe(60);
	});

	it("keeps empty subtask lists valid when details are absent", () => {
		const parsed = parseTaskJson(
			JSON.stringify({
				features: [
					{
						name: "Fitur",
						tasks: [
							{
								name: "Task",
								description: "d",
								priority: "medium",
								covers: ["AC-1.1"],
								subtasks: [{ name: "Sub", description: "d" }],
							},
						],
					},
				],
			}),
		);
		expect(parsed?.features[0].tasks[0].subtasks[0].details).toEqual([]);
	});
});
