import { describe, expect, it } from "vitest";
import { buildRevisionAssistantReply, stripSectionMarkers } from "./revision-reply";

const MARKER = ":::UPDATE_SECTION";

describe("stripSectionMarkers", () => {
	it("removes the boundary comments the protocol asks the model to repeat", () => {
		const body = [
			"<!-- SECTION: Overview -->",
			"## 1. Overview",
			"### 1.1 Latar Belakang",
			"Isi section.",
			"<!-- /SECTION -->",
		].join("\n");
		expect(stripSectionMarkers(body)).toBe(
			"## 1. Overview\n### 1.1 Latar Belakang\nIsi section.",
		);
	});

	it("is idempotent and leaves plain markdown untouched", () => {
		const body = "## 6. Architecture & Tech Stack\n### 6.1 High-Level";
		expect(stripSectionMarkers(body)).toBe(body);
		expect(stripSectionMarkers(stripSectionMarkers(body))).toBe(body);
	});

	it("tolerates spacing and a missing closing tag", () => {
		expect(stripSectionMarkers("<!--SECTION: User Flow-->isi")).toBe("isi");
		expect(stripSectionMarkers("isi<!-- /SECTION -->")).toBe("isi");
	});

	it("strips markers regardless of the section name they carry", () => {
		// A patch body never owns boundary comments: the merge writes the
		// canonical pair for the section it replaces.
		const body = "<!-- SECTION: Requirements -->\ntext";
		expect(stripSectionMarkers(body)).toBe("text");
	});
});

describe("buildRevisionAssistantReply", () => {
	it("returns a plain answer untouched when no patch block is present", () => {
		const raw =
			"PRD kamu sudah memuat aturan validasi stok di bagian Requirements.";
		expect(
			buildRevisionAssistantReply({
				rawResponse: raw,
				patchedSections: [],
				language: "id",
			}),
		).toBe(raw);
	});

	it("never leaves a dangling introducer when the preamble ends with a colon", () => {
		const reply = buildRevisionAssistantReply({
			rawResponse: `Berikut adalah pembaruan untuk seksi-seksi yang terdampak:\n\n${MARKER}[Database Schema]:::\nisi\n:::END_UPDATE:::`,
			patchedSections: ["Database Schema"],
			language: "id",
		});
		expect(reply.endsWith(":")).toBe(false);
		expect(reply).toContain("Database Schema");
		expect(reply.trim().length).toBeGreaterThan(0);
	});

	it("names every section that actually changed, in merge order", () => {
		const reply = buildRevisionAssistantReply({
			rawResponse: `${MARKER}[Architecture & Tech Stack]:::\nx\n:::END_UPDATE:::\n${MARKER}[Database Schema]:::\ny\n:::END_UPDATE:::`,
			patchedSections: ["Architecture & Tech Stack", "Database Schema"],
			language: "id",
		});
		expect(reply).toContain("Architecture & Tech Stack, Database Schema");
	});

	it("keeps a complete preamble and appends the applied-sections clause", () => {
		const preamble = "Baik, pergantian ORM sudah saya terapkan.";
		const reply = buildRevisionAssistantReply({
			rawResponse: `${preamble}\n\n${MARKER}[Requirements]:::\nx\n:::END_UPDATE:::`,
			patchedSections: ["Requirements"],
			language: "id",
		});
		expect(reply.startsWith(preamble)).toBe(true);
		expect(reply).toContain("Requirements");
	});

	it("is non-empty when the model emits only patch blocks", () => {
		const reply = buildRevisionAssistantReply({
			rawResponse: `${MARKER}[Overview]:::\nx\n:::END_UPDATE:::`,
			patchedSections: ["Overview"],
			language: "id",
		});
		expect(reply.trim().length).toBeGreaterThan(0);
		expect(reply).toContain("Overview");
	});

	it("never exposes protocol markers or raw section tags", () => {
		const replies = [
			buildRevisionAssistantReply({
				rawResponse: `Pembaruan:\n${MARKER}[Overview]:::\n<!-- SECTION: Overview -->\n## 1. Overview\n<!-- /SECTION -->\n:::END_UPDATE:::`,
				patchedSections: ["Overview"],
				language: "id",
			}),
			buildRevisionAssistantReply({
				rawResponse: `${MARKER}[Overview]:::\nx\n:::END_UPDATE:::`,
				patchedSections: ["Overview"],
				language: "en",
			}),
		];
		for (const reply of replies) {
			expect(reply).not.toContain(":::UPDATE_SECTION");
			expect(reply).not.toContain(":::END_UPDATE:::");
			expect(reply).not.toContain("<!-- SECTION");
		}
	});

	it("does not claim a change when no patch merged", () => {
		const reply = buildRevisionAssistantReply({
			rawResponse: `${MARKER}[Section Tidak Dikenal]:::\nx\n:::END_UPDATE:::`,
			patchedSections: [],
			language: "id",
		});
		expect(reply.trim().length).toBeGreaterThan(0);
		expect(reply).not.toContain("Section Tidak Dikenal");
	});

	it("de-duplicates repeated section names", () => {
		const reply = buildRevisionAssistantReply({
			rawResponse: `${MARKER}[User Flow]:::\nx\n:::END_UPDATE:::`,
			patchedSections: ["User Flow", " User Flow ", "Core Features"],
			language: "id",
		});
		expect(reply).toContain("User Flow, Core Features");
		expect(reply.match(/User Flow/g)).toHaveLength(1);
	});

	it("uses the English clause for English projects", () => {
		const reply = buildRevisionAssistantReply({
			rawResponse: `${MARKER}[Requirements]:::\nx\n:::END_UPDATE:::`,
			patchedSections: ["Requirements"],
			language: "en",
		});
		expect(reply).toContain("Changes were applied");
	});

	it("handles an empty model response without producing an empty reply", () => {
		const reply = buildRevisionAssistantReply({
			rawResponse: "",
			patchedSections: [],
			language: "id",
		});
		expect(reply.trim().length).toBeGreaterThan(0);
	});
});
