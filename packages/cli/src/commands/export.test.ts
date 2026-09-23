import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/api-client.js", () => ({
	apiGet: vi.fn(),
}));

vi.mock("node:fs", () => ({
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
	existsSync: vi.fn(() => true),
}));

import { writeFileSync } from "node:fs";
import { apiGet } from "../lib/api-client.js";
import { exportRulesCommand } from "./export.js";

const PRD = `# PRD

## Tech Stack
- Frontend: React 19
- Backend: TanStack Start

## Struktur Folder
src/routes/
src/components/

## Arsitektur
Monorepo dengan pnpm.
`;

const AC = `# Acceptance Criteria

## Fitur Utama

### Login
- [ ] User bisa login via Google OAuth
- [ ] User bisa login via GitHub OAuth

### PRD Generation
- [ ] System generate PRD 8 section
`;

describe("exportRulesCommand", () => {
	it("writes .claude/rules/project-spec.md with PRD stack + AC", async () => {
		vi.mocked(apiGet)
			.mockResolvedValueOnce({ content: PRD, version: 1 })
			.mockResolvedValueOnce({ content: AC, version: 1 });

		await exportRulesCommand("proj-1");

		expect(apiGet).toHaveBeenCalledWith("/api/v1/projects/proj-1/prd");
		expect(apiGet).toHaveBeenCalledWith("/api/v1/projects/proj-1/ac");
		expect(writeFileSync).toHaveBeenCalled();

		const [path, content] = vi.mocked(writeFileSync).mock.calls[0];
		expect(String(path).replace(/\\/g, "/")).toBe(
			".claude/rules/project-spec.md",
		);
		const md = content as string;
		expect(md).toContain("# Project Rules");
		expect(md).toContain("## Tech Stack & Architecture");
		expect(md).toContain("## Acceptance Criteria");
		expect(md).toContain("## Strict Rules");
		expect(md).toContain("React 19");
		expect(md).toContain("User bisa login via Google OAuth");
		expect(md).toContain("ONLY implement features explicitly listed");
		expect(md).toContain("DO NOT add features");
		expect(md).toContain("external credentials/services");
	});

	it("falls back to first 50 lines of PRD when no stack/arch section found", async () => {
		const plainPRD = "# Just a plain PRD\nNo sections here.\nLine 3\n";
		vi.mocked(apiGet)
			.mockResolvedValueOnce({ content: plainPRD, version: 1 })
			.mockResolvedValueOnce({ content: AC, version: 1 });

		vi.mocked(writeFileSync).mockClear();
		await exportRulesCommand("proj-1");

		const [, content] = vi.mocked(writeFileSync).mock.calls[0];
		expect(content).toContain("Just a plain PRD");
	});

	it("does not duplicate matched headings in tech stack output", async () => {
		vi.mocked(apiGet)
			.mockResolvedValueOnce({ content: PRD, version: 1 })
			.mockResolvedValueOnce({ content: AC, version: 1 });

		vi.mocked(writeFileSync).mockClear();
		await exportRulesCommand("proj-1");

		const [, content] = vi.mocked(writeFileSync).mock.calls[0];
		const md = content as string;
		// ponytail: each heading appears exactly once — the dedup fix.
		// Use exact line match so `## Tech Stack & Architecture` (template) doesn't count.
		expect((md.match(/^## Tech Stack$/gm) || []).length).toBe(1);
		expect((md.match(/^## Struktur Folder$/gm) || []).length).toBe(1);
		expect((md.match(/^## Arsitektur$/gm) || []).length).toBe(1);
	});

	it("writes .cursorrules when --format cursor is passed", async () => {
		vi.mocked(apiGet)
			.mockResolvedValueOnce({ content: PRD, version: 1 })
			.mockResolvedValueOnce({ content: AC, version: 1 });

		vi.mocked(writeFileSync).mockClear();
		await exportRulesCommand("proj-1", { format: "cursor" });

		const [path, content] = vi.mocked(writeFileSync).mock.calls[0];
		expect(String(path)).toBe(".cursorrules");
		const md = content as string;
		expect(md).toContain("# Project Rules");
		expect(md).toContain("React 19");
		expect(md).toContain("User bisa login via Google OAuth");
	});

	it("writes AGENTS.md when --format agents is passed", async () => {
		vi.mocked(apiGet)
			.mockResolvedValueOnce({ content: PRD, version: 1 })
			.mockResolvedValueOnce({ content: AC, version: 1 });

		vi.mocked(writeFileSync).mockClear();
		await exportRulesCommand("proj-1", { format: "agents" });

		const [path, content] = vi.mocked(writeFileSync).mock.calls[0];
		expect(String(path).replace(/\\/g, "/")).toBe("AGENTS.md");
		const md = content as string;
		expect(md).toContain("# Project Rules");
		expect(md).toContain("React 19");
		expect(md).toContain("User bisa login via Google OAuth");
		expect(md).toContain("ONLY implement features explicitly listed");
	});

	it("preserves ### sub-headings inside matched sections", async () => {
		const subPRD = `# PRD

## Tech Stack
Some intro text
### Build Tools
- Vite
- TypeScript
### Runtime
- Node.js

## Struktur Folder
src/routes/
### Nested
src/components/
`;
		vi.mocked(apiGet)
			.mockResolvedValueOnce({ content: subPRD, version: 1 })
			.mockResolvedValueOnce({ content: AC, version: 1 });

		vi.mocked(writeFileSync).mockClear();
		await exportRulesCommand("proj-1");

		const [, content] = vi.mocked(writeFileSync).mock.calls[0];
		const md = content as string;
		// sub-headings captured, not truncated
		expect(md).toContain("### Build Tools");
		expect(md).toContain("### Runtime");
		expect(md).toContain("- Vite");
		expect(md).toContain("- Node.js");
		expect(md).toContain("### Nested");
		// next top-level section boundary still honored
		expect(md).toContain("## Struktur Folder");
	});

	it("defaults to claude format when --format is omitted", async () => {
		vi.mocked(apiGet)
			.mockResolvedValueOnce({ content: PRD, version: 1 })
			.mockResolvedValueOnce({ content: AC, version: 1 });

		vi.mocked(writeFileSync).mockClear();
		await exportRulesCommand("proj-1", {});

		const [path] = vi.mocked(writeFileSync).mock.calls[0];
		expect(String(path).replace(/\\/g, "/")).toBe(
			".claude/rules/project-spec.md",
		);
	});
});
