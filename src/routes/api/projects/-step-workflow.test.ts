import { describe, expect, it } from "vitest";
import { hasFullWorkflow } from "@/lib/credits";

describe("Workflow step permission gate", () => {
	it("denies full workflow for free tier", () => {
		expect(hasFullWorkflow("free")).toBe(false);
	});

	it("allows full workflow for pro and hengker tiers", () => {
		expect(hasFullWorkflow("pro")).toBe(true);
		expect(hasFullWorkflow("hengker")).toBe(true);
	});
});
