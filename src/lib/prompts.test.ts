import { describe, expect, it } from "vitest";
import { PRD_REVISION_PROMPT, PRD_SYSTEM_PROMPT } from "./prompts";

describe("PRD_SYSTEM_PROMPT", () => {
	it("contains zero-assumption stack lock instructions", () => {
		const prompt = PRD_SYSTEM_PROMPT("id");
		expect(prompt).toContain("HORMATI STACK & BAHASA ASLI PROYEK");
		expect(prompt).toMatch(/Vue/i);
		expect(prompt).toMatch(/dilarang keras mengalihkan/i);
	});

	it("contains adaptive section 7 anti-hallucination database rules", () => {
		const prompt = PRD_SYSTEM_PROMPT("id");
		expect(prompt).toContain("SECTION 7 ADAPTIF");
		expect(prompt).toMatch(/dilarang keras mengarang.*tabel sql/i);
		expect(prompt).toContain("sequenceDiagram");
	});

	it("preserves all 8 exact section boundary tags for parser compatibility", () => {
		const prompt = PRD_SYSTEM_PROMPT("id");
		const expectedSections = [
			"Overview",
			"Goals & Success Metrics",
			"Requirements",
			"Core Features",
			"User Flow",
			"Architecture & Tech Stack",
			"Database Schema",
			"Design & Technical Constraints",
		];
		for (const section of expectedSections) {
			expect(prompt).toContain(`<!-- SECTION: ${section} -->`);
			expect(prompt).toContain("<!-- /SECTION -->");
		}
	});

	it("supports english output language", () => {
		const prompt = PRD_SYSTEM_PROMPT("en");
		expect(prompt).toContain("<!-- SECTION: Database Schema -->");
		expect(prompt).toContain("Tables / Collections");
	});
});

describe("PRD_REVISION_PROMPT", () => {
	it("forbids unsolicited framework switches and database hallucinations during revision", () => {
		expect(PRD_REVISION_PROMPT).toMatch(/HORMATI STACK & ARSITEKTUR ASLI/i);
		expect(PRD_REVISION_PROMPT).toMatch(/JANGAN PERNAH mengubah framework/i);
	});
});
