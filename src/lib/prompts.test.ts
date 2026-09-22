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

	it("requires a Pages & Screens inventory inside User Flow, not as a top-level section", () => {
		for (const lang of ["id", "en"] as const) {
			const prompt = PRD_SYSTEM_PROMPT(lang);
			const userFlowStart = prompt.indexOf("<!-- SECTION: User Flow -->");
			const userFlowEnd = prompt.indexOf("<!-- /SECTION -->", userFlowStart);
			const userFlow = prompt.slice(userFlowStart, userFlowEnd);
			expect(userFlow).toContain("5.3 Pages & Screens");
			expect(prompt).not.toContain("<!-- SECTION: Pages & Screens -->");
		}
	});

	it("keeps the eight top-level sections in order", () => {
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
		const positions = expectedSections.map((section) =>
			prompt.indexOf(`<!-- SECTION: ${section} -->`),
		);
		for (const position of positions) expect(position).toBeGreaterThan(-1);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
	});

	it("forbids inventing pages and implementation detail in the inventory", () => {
		const prompt = PRD_SYSTEM_PROMPT("id");
		expect(prompt).toMatch(/DILARANG mengarang halaman di luar scope/i);
		expect(prompt).toMatch(/path file, nama komponen, route URL/i);
		expect(prompt).toMatch(/ADAPTIF/i);
	});

	it("keeps architecture consistent with the surface map", () => {
		const prompt = PRD_SYSTEM_PROMPT("id");
		expect(prompt).toContain("KONSISTENSI PRODUCT SURFACE");
		expect(prompt).toMatch(
			/Struktur Folder TIDAK menggantikan Pages & Screens/i,
		);
	});
});

describe("PRD_REVISION_PROMPT", () => {
	it("forbids unsolicited framework switches and database hallucinations during revision", () => {
		expect(PRD_REVISION_PROMPT).toMatch(/HORMATI STACK & ARSITEKTUR ASLI/i);
		expect(PRD_REVISION_PROMPT).toMatch(/JANGAN PERNAH mengubah framework/i);
	});

	it("requires the surface map to stay in sync when a revision touches product surfaces", () => {
		expect(PRD_REVISION_PROMPT).toMatch(/JAGA PETA PRODUCT SURFACE/i);
		expect(PRD_REVISION_PROMPT).toMatch(/:::UPDATE_SECTION\[User Flow\]:::/);
		expect(PRD_REVISION_PROMPT).toMatch(/5\.1, 5\.2, DAN 5\.3/i);
		expect(PRD_REVISION_PROMPT).toMatch(/stale/i);
	});

	it("does not ask for inventory changes when surfaces are unaffected", () => {
		expect(PRD_REVISION_PROMPT).toMatch(
			/TIDAK berdampak pada product surface, JANGAN mengubah isi 5\.3/i,
		);
	});

	it("still requires a natural chat reply before the patch blocks", () => {
		expect(PRD_REVISION_PROMPT).toMatch(/BERIKAN BALASAN CHAT \(WAJIB\)/i);
	});
});
