import { describe, expect, it } from "vitest";
import { AC_GENERATION_PROMPT } from "../prompts-ac";
import { extractFeatureSection } from "./ac-service";

describe("extractFeatureSection", () => {
	const md = `# Acceptance Criteria - PrdFy

## Glossary / Konvensi
Some conventions here.

## Login & Auth
### AC-1.1 Login via Google
Content for login.

### AC-1.2 Logout
More content.

## Dashboard
### AC-2.1 View stats
Dashboard content.
`;

	it("extracts exact heading match", () => {
		const result = extractFeatureSection(md, "Dashboard");
		expect(result).toContain("AC-2.1 View stats");
		expect(result).toContain("Dashboard content.");
	});

	it("matches case-insensitively", () => {
		const result = extractFeatureSection(md, "login & auth");
		expect(result).toContain("AC-1.1 Login via Google");
	});

	it("returns null when no heading matches", () => {
		expect(extractFeatureSection(md, "Nonexistent Feature")).toBeNull();
	});

	it("stops extraction at the next ## heading", () => {
		const result = extractFeatureSection(md, "Login & Auth");
		expect(result).toContain("AC-1.2 Logout");
		expect(result).not.toContain("Dashboard content.");
		expect(result).not.toContain("## Dashboard");
	});

	it("stops at end of string when it is the last feature", () => {
		const result = extractFeatureSection(md, "Dashboard");
		expect(result?.trim().endsWith("Dashboard content.")).toBe(true);
	});
});

describe("AC_GENERATION_PROMPT", () => {
	it("supports external API contracts and forbids backend invention on frontend-only", () => {
		const prompt = AC_GENERATION_PROMPT("id");
		expect(prompt).toContain("KONTRAK DATA & API");
		expect(prompt).toContain("Frontend-Only");
		expect(prompt).toMatch(
			/DILARANG mengarang endpoint backend internal fiktif/i,
		);
	});

	it("supports English localization", () => {
		const prompt = AC_GENERATION_PROMPT("en");
		expect(prompt).toContain("# Acceptance Criteria - [Project Name]");
		expect(prompt).toContain("KONTRAK DATA & API");
	});
});
