import { describe, expect, it } from "vitest";
import { getSafeRedirectPath } from "@/lib/redirect";

describe("getSafeRedirectPath", () => {
	it("accepts same-origin paths", () => {
		expect(getSafeRedirectPath("/ask/123")).toBe("/ask/123");
		expect(getSafeRedirectPath("/")).toBe("/");
	});

	it("falls back to root for missing or external values", () => {
		for (const value of [
			null,
			undefined,
			"",
			"https://attacker.example",
			"//attacker.example/login",
			"\\\\attacker.example",
			"javascript:alert(1)",
			"/\\attacker.example",
			123,
			{},
		]) {
			expect(getSafeRedirectPath(value)).toBe("/");
		}
	});
});
