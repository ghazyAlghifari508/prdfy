import { describe, expect, it } from "vitest";
import { buildCompiledAskPrompt, type TechAnswers } from "./ask-prompt-builder";

describe("buildCompiledAskPrompt", () => {
	it("treats unselected backend and database as Frontend-only when frontend is specified", () => {
		const tech: TechAnswers = {
			frontend: "Vue.js",
		};
		const prompt = buildCompiledAskPrompt({
			platform: "web",
			language: "id",
			rawPrompt: "Aplikasi katalog film",
			nonTechQuestions: [
				{ question: "Target audiens?", answer: "Pecinta film", skipped: false },
			],
			techAnswers: tech,
			skippedTech: new Set(),
		});

		expect(prompt).toContain("Frontend: Vue.js");
		expect(prompt).toContain(
			"Backend: Tidak ada (Murni Frontend / Client-side)",
		);
		expect(prompt).toContain(
			"Database: Tidak ada (Client-side state / External API)",
		);
		expect(prompt).not.toContain("Backend: Biarkan AI yang memilih");
		expect(prompt).not.toContain("Database: Biarkan AI yang memilih");
	});

	it("respects explicit AI decision request when user explicitly skips a field", () => {
		const tech: TechAnswers = {
			frontend: "React (Vite)",
		};
		const prompt = buildCompiledAskPrompt({
			platform: "web",
			language: "id",
			rawPrompt: "Aplikasi film dengan database rekomendasi",
			nonTechQuestions: [],
			techAnswers: tech,
			skippedTech: new Set(["database"]),
		});

		expect(prompt).toContain("Frontend: React (Vite)");
		expect(prompt).toContain(
			"Backend: Tidak ada (Murni Frontend / Client-side)",
		);
		expect(prompt).toContain("Database: Biarkan AI yang memilih");
	});

	it("preserves default choices when user leaves all tech stack unselected (greenfield non-technical)", () => {
		const tech: TechAnswers = {};
		const prompt = buildCompiledAskPrompt({
			platform: "web",
			language: "id",
			rawPrompt: "Ide aplikasi baru",
			nonTechQuestions: [],
			techAnswers: tech,
			skippedTech: new Set(),
		});

		expect(prompt).toContain("Frontend: Biarkan AI yang memilih");
		expect(prompt).toContain("Backend: Biarkan AI yang memilih");
		expect(prompt).toContain("Database: Biarkan AI yang memilih");
		expect(prompt).toContain(
			"Fullstack Framework: Tidak dipakai / Biarkan AI yang memilih",
		);
	});

	it("supports English language output correctly", () => {
		const tech: TechAnswers = {
			frontend: "Svelte",
		};
		const prompt = buildCompiledAskPrompt({
			platform: "web",
			language: "en",
			rawPrompt: "Movie dashboard",
			nonTechQuestions: [
				{ question: "Target audience?", answer: "Movie fans", skipped: false },
			],
			techAnswers: tech,
			skippedTech: new Set(),
		});

		expect(prompt).toContain(
			"Please generate a PRD with the following specifications:",
		);
		expect(prompt).toContain("Frontend: Svelte");
		expect(prompt).toContain(
			"Backend: None (Client-side only / External APIs)",
		);
		expect(prompt).toContain(
			"Database: None (Client-side state / External API)",
		);
	});
});
