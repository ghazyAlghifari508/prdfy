import { describe, expect, it } from "vitest";
import { FEEDBACK_MAX_MESSAGE_CHARS } from "@/lib/constants";
import { parseFeedbackBody } from "@/lib/feedback";

describe("parseFeedbackBody", () => {
	it("accepts a bounded message with default type", () => {
		expect(parseFeedbackBody({ message: "<sample feedback>" })).toEqual({
			message: "<sample feedback>",
			type: "general",
		});
	});

	it("accepts the known feedback types", () => {
		for (const type of ["general", "bug", "feature"] as const) {
			expect(parseFeedbackBody({ message: "<sample>", type })).toEqual({
				message: "<sample>",
				type,
			});
		}
	});

	it("rejects non-object payloads and missing or non-string messages", () => {
		for (const body of [null, [], "text", 123, {}, { message: "" }]) {
			expect(() => parseFeedbackBody(body)).toThrow();
		}
		expect(() => parseFeedbackBody({ message: 123 })).toThrow();
		expect(() => parseFeedbackBody({ message: {} })).toThrow();
	});

	it("rejects unknown types and oversized messages", () => {
		expect(() =>
			parseFeedbackBody({ message: "<sample>", type: "admin" }),
		).toThrow();
		expect(() =>
			parseFeedbackBody({ message: "x".repeat(FEEDBACK_MAX_MESSAGE_CHARS + 1) }),
		).toThrow();
	});
});
