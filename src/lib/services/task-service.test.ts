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
							// Legacy tree: coverage is recovered from the description,
							// which carries no references here.
							covers: [],
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
});
