import { describe, expect, it } from "vitest";
import {
	ERROR_REPORT_MAX_CONTEXT_CHARS,
	ERROR_REPORT_MAX_MESSAGE_CHARS,
} from "@/lib/constants";
import { parseErrorReportBody } from "@/lib/error-report";

describe("parseErrorReportBody", () => {
	it("defaults a missing error to Unknown error with null context", () => {
		expect(parseErrorReportBody({})).toEqual({
			errorMessage: "Unknown error",
			context: null,
		});
		expect(parseErrorReportBody(undefined)).toEqual({
			errorMessage: "Unknown error",
			context: null,
		});
	});

	it("accepts bounded string error and context", () => {
		expect(
			parseErrorReportBody({
				error: "<sample error>",
				context: "<sample context>",
			}),
		).toEqual({ errorMessage: "<sample error>", context: "<sample context>" });
	});

	it("rejects non-object payloads", () => {
		for (const body of [[], "text", 123, true]) {
			expect(() => parseErrorReportBody(body)).toThrow();
		}
	});

	it("rejects non-string error and context values", () => {
		expect(() => parseErrorReportBody({ error: 123 })).toThrow();
		expect(() => parseErrorReportBody({ error: {} })).toThrow();
		expect(() => parseErrorReportBody({ context: 123 })).toThrow();
		expect(() => parseErrorReportBody({ context: {} })).toThrow();
	});

	it("rejects oversized error and context values", () => {
		expect(() =>
			parseErrorReportBody({ error: "x".repeat(ERROR_REPORT_MAX_MESSAGE_CHARS + 1) }),
		).toThrow();
		expect(() =>
			parseErrorReportBody({
				context: "x".repeat(ERROR_REPORT_MAX_CONTEXT_CHARS + 1),
			}),
		).toThrow();
	});
});
