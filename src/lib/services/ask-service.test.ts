import { describe, expect, it } from "vitest";
import { parseAskOptionsJson } from "./ask-service";

describe("parseAskOptionsJson bounds", () => {
	it("rejects whitespace-only ids, questions, and options", () => {
		expect(
			parseAskOptionsJson(
				JSON.stringify({
					questions: [
						{ id: "   ", question: "Valid?", type: "text" },
						{ id: "b", question: "Valid?", type: "text" },
						{ id: "c", question: "Valid?", type: "text" },
					],
				}),
			),
		).toBeNull();
		expect(
			parseAskOptionsJson(
				JSON.stringify({
					questions: [
						{ id: "a", question: "   ", type: "text" },
						{ id: "b", question: "Valid?", type: "text" },
						{ id: "c", question: "Valid?", type: "text" },
					],
				}),
			),
		).toBeNull();
		expect(
			parseAskOptionsJson(
				JSON.stringify({
					questions: [
						{
							id: "a",
							question: "Valid?",
							type: "select",
							options: ["  ", "Real"],
						},
						{ id: "b", question: "Valid?", type: "text" },
						{ id: "c", question: "Valid?", type: "text" },
					],
				}),
			),
		).toBeNull();
	});

	it("rejects option arrays beyond the per-question cap", () => {
		expect(
			parseAskOptionsJson(
				JSON.stringify({
					questions: [
						{
							id: "a",
							question: "Valid?",
							type: "select",
							options: Array.from({ length: 13 }, (_, i) => `opt-${i}`),
						},
						{ id: "b", question: "Valid?", type: "text" },
						{ id: "c", question: "Valid?", type: "text" },
					],
				}),
			),
		).toBeNull();
	});

	it("trims accepted strings", () => {
		expect(
			parseAskOptionsJson(
				JSON.stringify({
					questions: [
						{
							id: "  padded  ",
							question: "  Padded?  ",
							type: "select",
							options: ["  X  "],
						},
						{ id: "b", question: "Valid?", type: "text" },
						{ id: "c", question: "Valid?", type: "text" },
					],
				}),
			),
		).toEqual([
			{
				id: "padded",
				question: "Padded?",
				type: "select",
				options: ["X"],
			},
			{ id: "b", question: "Valid?", type: "text" },
			{ id: "c", question: "Valid?", type: "text" },
		]);
	});
});

describe("parseAskOptionsJson", () => {
	it("parses a valid question list with mixed types", () => {
		const result = parseAskOptionsJson(
			JSON.stringify({
				questions: [
					{
						id: "target_audience",
						question: "Siapa target audiens?",
						type: "select",
						options: ["UMKM", "Enterprise"],
					},
					{ id: "brand_name", question: "Nama brand kamu?", type: "text" },
					{
						id: "features",
						question: "Fitur apa saja yang penting?",
						type: "multiselect",
						options: ["Auth", "Payment", "Chat"],
					},
				],
			}),
		);
		expect(result).toEqual([
			{
				id: "target_audience",
				question: "Siapa target audiens?",
				type: "select",
				options: ["UMKM", "Enterprise"],
			},
			{ id: "brand_name", question: "Nama brand kamu?", type: "text" },
			{
				id: "features",
				question: "Fitur apa saja yang penting?",
				type: "multiselect",
				options: ["Auth", "Payment", "Chat"],
			},
		]);
	});

	it("rejects a question with no type", () => {
		expect(
			parseAskOptionsJson(
				JSON.stringify({
					questions: [{ id: "a", question: "Q?", options: ["X"] }],
				}),
			),
		).toBeNull();
	});

	it("rejects an invalid type", () => {
		expect(
			parseAskOptionsJson(
				JSON.stringify({
					questions: [
						{ id: "a", question: "Q?", type: "slider", options: ["X"] },
					],
				}),
			),
		).toBeNull();
	});

	it("rejects select with no options", () => {
		expect(
			parseAskOptionsJson(
				JSON.stringify({
					questions: [{ id: "a", question: "Q?", type: "select", options: [] }],
				}),
			),
		).toBeNull();
	});

	it("rejects multiselect with no options", () => {
		expect(
			parseAskOptionsJson(
				JSON.stringify({
					questions: [
						{ id: "a", question: "Q?", type: "multiselect", options: [] },
					],
				}),
			),
		).toBeNull();
	});

	it("accepts text type without options", () => {
		const result = parseAskOptionsJson(
			JSON.stringify({
				questions: [
					{ id: "a", question: "Q1?", type: "text" },
					{ id: "b", question: "Q2?", type: "text" },
					{ id: "c", question: "Q3?", type: "text" },
				],
			}),
		);
		expect(result).toHaveLength(3);
	});

	it("rejects non-string options", () => {
		expect(
			parseAskOptionsJson(
				JSON.stringify({
					questions: [
						{ id: "a", question: "Q?", type: "select", options: [1, 2] },
					],
				}),
			),
		).toBeNull();
	});

	it("rejects a missing id", () => {
		expect(
			parseAskOptionsJson(
				JSON.stringify({
					questions: [{ question: "Q?", type: "select", options: ["X"] }],
				}),
			),
		).toBeNull();
	});

	it("rejects an empty question list", () => {
		expect(parseAskOptionsJson(JSON.stringify({ questions: [] }))).toBeNull();
	});

	it("rejects malformed JSON", () => {
		expect(parseAskOptionsJson("not json")).toBeNull();
	});

	it("rejects fewer than 3 questions", () => {
		expect(
			parseAskOptionsJson(
				JSON.stringify({
					questions: [
						{ id: "a", question: "Q1?", type: "select", options: ["X"] },
						{ id: "b", question: "Q2?", type: "select", options: ["Y"] },
					],
				}),
			),
		).toBeNull();
	});

	it("rejects more than 10 questions", () => {
		const questions = Array.from({ length: 11 }, (_, i) => ({
			id: `q${i}`,
			question: `Q${i}?`,
			type: "select",
			options: ["A"],
		}));
		expect(parseAskOptionsJson(JSON.stringify({ questions }))).toBeNull();
	});
});
