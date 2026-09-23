import { describe, expect, it } from "vitest";
import { TASK_GENERATION_PROMPT } from "./prompts-task";

describe("TASK_GENERATION_PROMPT", () => {
	it("mandates Phase 0 scaffolding as the first feature group", () => {
		expect(TASK_GENERATION_PROMPT).toContain(
			"FASE 0: INISIALISASI & FONDASI INFRASTRUKTUR",
		);
		expect(TASK_GENERATION_PROMPT).toContain(
			"Scaffolding Repositori & Konfigurasi Environtment",
		);
		expect(TASK_GENERATION_PROMPT).toContain("Koneksi Database");
	});

	it("enforces 5-layer decomposition per feature", () => {
		expect(TASK_GENERATION_PROMPT).toContain("5-LAYER DEKOMPOSISI TEKNIS");
		expect(TASK_GENERATION_PROMPT).toContain("Layer Data & Storage");
		expect(TASK_GENERATION_PROMPT).toContain("Layer Domain & Business Logic");
		expect(TASK_GENERATION_PROMPT).toContain("Layer API & Network Contract");
		expect(TASK_GENERATION_PROMPT).toContain("Layer UI Dedicated Screen");
		expect(TASK_GENERATION_PROMPT).toContain("Layer UI States & Interaction");
	});

	it("strictly forbids merging UI and backend into a single task", () => {
		expect(TASK_GENERATION_PROMPT).toContain(
			"DILARANG menggabungkan backend dan UI ke dalam satu task",
		);
		expect(TASK_GENERATION_PROMPT).not.toContain(
			"Jika satu deliverable kecil memang mencakup UI + handler-nya, biarkan tetap satu task",
		);
	});

	it("mandates 1:1 mapping to PRD Section 5.3 Pages & Screens and 4 UI states", () => {
		expect(TASK_GENERATION_PROMPT).toContain(
			"1:1 MAPPING TERHADAP PAGES & SCREENS",
		);
		expect(TASK_GENERATION_PROMPT).toContain("4 STATE WAJIB");
		expect(TASK_GENERATION_PROMPT).toContain("Loading State");
		expect(TASK_GENERATION_PROMPT).toContain("Empty State");
		expect(TASK_GENERATION_PROMPT).toContain("Error State");
		expect(TASK_GENERATION_PROMPT).toContain("Success State");
	});
});
