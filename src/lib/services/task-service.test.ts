import { describe, expect, it } from "vitest";
import { parseTaskJson } from "./task-service";

const validTree = {
	features: [
		{
			name: "Auth",
			tasks: [
				{
					name: "Login",
					description: "OAuth login",
					priority: "high",
					subtasks: [
						{ name: "UI", description: "form", details: ["a", "b"] },
						{ name: "Callback" },
					],
				},
			],
		},
	],
};

describe("parseTaskJson", () => {
	it("accepts a well-formed tree and defaults missing details", () => {
		expect(parseTaskJson(JSON.stringify(validTree))).toEqual({
			features: [
				{
					name: "Auth",
					tasks: [
						{
							name: "Login",
							description: "OAuth login",
							priority: "high",
							// Legacy tree: coverage is recovered from the description,
							// which carries no references here.
							covers: [],
							// A task without declared surfaces touches no page.
							surfaces: [],
							subtasks: [
								{ name: "UI", description: "form", details: ["a", "b"] },
								{ name: "Callback", description: "", details: [] },
							],
						},
					],
				},
			],
		});
	});

	it("rejects non-string descriptions and details entries", () => {
		const badDesc = structuredClone(validTree);
		(
			badDesc.features[0] as { tasks: Array<{ description: unknown }> }
		).tasks[0].description = { text: "x" };
		expect(parseTaskJson(JSON.stringify(badDesc))).toBeNull();

		const badDetails = structuredClone(validTree);
		(
			badDetails.features[0] as {
				tasks: Array<{ subtasks: Array<{ details: unknown }> }>;
			}
		).tasks[0].subtasks[0].details = ["ok", 42];
		expect(parseTaskJson(JSON.stringify(badDetails))).toBeNull();
	});

	it("rejects blank names and non-record nodes", () => {
		const blank = structuredClone(validTree);
		(blank.features[0] as { name: string }).name = "   ";
		expect(parseTaskJson(JSON.stringify(blank))).toBeNull();
		expect(parseTaskJson(JSON.stringify({ features: [null] }))).toBeNull();
		expect(parseTaskJson("not json")).toBeNull();
		expect(parseTaskJson(JSON.stringify({ features: [] }))).toBeNull();
	});

	it("rejects a task without an explicit priority", () => {
		const noPriority = structuredClone(validTree);
		delete (noPriority.features[0].tasks[0] as { priority?: string }).priority;
		expect(parseTaskJson(JSON.stringify(noPriority))).toBeNull();
	});

	it("rejects an invented priority value instead of accepting arbitrary strings", () => {
		const bad = structuredClone(validTree);
		(bad.features[0].tasks[0] as { priority: string }).priority = "urgent";
		expect(parseTaskJson(JSON.stringify(bad))).toBeNull();
	});

	it("normalizes priority casing and whitespace", () => {
		const mixed = structuredClone(validTree);
		(mixed.features[0].tasks[0] as { priority: string }).priority = "  HIGH ";
		expect(
			parseTaskJson(JSON.stringify(mixed))?.features[0].tasks[0].priority,
		).toBe("high");
	});

	it("parses each allowed priority level", () => {
		for (const priority of ["high", "medium", "low"] as const) {
			const tree = structuredClone(validTree);
			(tree.features[0].tasks[0] as { priority: string }).priority = priority;
			expect(
				parseTaskJson(JSON.stringify(tree))?.features[0].tasks[0].priority,
			).toBe(priority);
		}
	});

	it("reads declared surfaces and drops duplicates and blanks", () => {
		const withSurfaces = structuredClone(validTree);
		(withSurfaces.features[0].tasks[0] as { surfaces?: unknown }).surfaces = [
			"Product List",
			"product list",
			" ",
			"Checkout",
		];
		expect(
			parseTaskJson(JSON.stringify(withSurfaces))?.features[0].tasks[0]
				.surfaces,
		).toEqual(["Product List", "Checkout"]);
	});

	it("rejects a non-array surfaces field", () => {
		const bad = structuredClone(validTree);
		(bad.features[0].tasks[0] as { surfaces?: unknown }).surfaces =
			"Product List";
		expect(parseTaskJson(JSON.stringify(bad))).toBeNull();
	});
});
