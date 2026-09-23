import { describe, expect, it } from "vitest";
import { depthDirective } from "./prompt-depth";

describe("depthDirective", () => {
	const kinds = ["prd", "ac", "task"] as const;

	it("returns a non-empty directive for every kind", () => {
		for (const kind of kinds) {
			expect(depthDirective(kind).length).toBeGreaterThan(0);
		}
	});

	it("returns the adaptive-depth directive for each doc kind", () => {
		for (const kind of kinds) {
			expect(depthDirective(kind)).toContain("MODE KEDALAMAN: ADAPTIF");
		}
	});

	it("scales depth to complexity instead of forcing one fixed maximal tier", () => {
		const prd = depthDirective("prd");
		expect(prd).toMatch(/kompleksitas/i);
		expect(prd).not.toMatch(/MAKSIMAL|EXHAUSTIVE/);
	});
});

describe("depthDirective('task')", () => {
	it("mandates deep, uncompressed structural decomposition without skipping layers", () => {
		const directive = depthDirective("task");
		expect(directive).toContain("KOMPLEKSITAS");
		expect(directive).toContain(
			"JANGAN mengurangi task atau menggabungkan requirement berbeda",
		);
		expect(directive).toContain("5-layer");
		expect(directive).toContain("Fase 0");
	});
});
