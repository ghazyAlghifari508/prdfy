import { describe, expect, it } from "vitest";
import { shouldConfirmReset } from "./implementation-options";

describe("shouldConfirmReset", () => {
	it("asks for confirmation when progress exists", () => {
		expect(shouldConfirmReset(true)).toBe(true);
	});

	it("skips confirmation when nothing has been worked on", () => {
		expect(shouldConfirmReset(false)).toBe(false);
	});
});
