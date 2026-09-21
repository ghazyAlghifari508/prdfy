/**
 * prdfy export rules <projectId> — generate .claude/rules/project-spec.md
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apiGet } from "../lib/api-client.js";

interface PrdAcResponse {
	content: string;
	version: number;
}

function extractTechStack(prd: string): string {
	const headings = [
		/^##\s+Tech\s+Stack\s*$/im,
		/^##\s+Struktur\s+Folder\s*$/im,
		/^##\s+Arsitektur\s*$/im,
	];

	const lines = prd.split("\n");
	const found: string[] = [];
	let capture = false;
	let depth = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		let matchedHeading = false;
		for (const h of headings) {
			if (h.test(line)) {
				capture = true;
				depth = 0;
				matchedHeading = true;
				found.push(line);
				break;
			}
		}
		if (matchedHeading) continue;
		if (!capture) continue;
		if (/^##\s/.test(line) && !headings.some((h) => h.test(line))) {
			capture = false;
			depth = 0;
			continue;
		}
		if (capture && depth === 0 && !headings.some((h) => h.test(line))) {
			// first non-heading line after match starts subsection capture
			depth = 1;
		}
		found.push(line);
	}

	if (found.length > 0) return found.join("\n").trim();

	// ponytail: naive fallback. Upgrade to full PRD summarization if users want richer context.
	return lines.slice(0, 50).join("\n").trim();
}

export async function exportRulesCommand(
	projectId: string,
	_options: { format?: string } = {},
) {
	const rawFormat = _options.format ?? "claude";
	const format = rawFormat.toLowerCase();
	if (!["claude", "cursor", "agents"].includes(format)) {
		console.error(
			`Error: Format "${rawFormat}" tidak didukung. Pilihan: claude, cursor, agents`,
		);
		process.exit(1);
	}
	try {
		const [prdData, acData] = await Promise.all([
			apiGet<PrdAcResponse>(
				`/api/v1/projects/${encodeURIComponent(projectId)}/prd`,
			),
			apiGet<PrdAcResponse>(
				`/api/v1/projects/${encodeURIComponent(projectId)}/ac`,
			),
		]);

		const techStack = extractTechStack(prdData.content);
		const projectName = `Project ${projectId}`; // ponytail: PRD name extraction skipped; add when PRD title is reliably structured.

		const md = [
			`# Project Rules: ${projectName}`,
			``,
			`## Tech Stack & Architecture`,
			``,
			techStack,
			``,
			`## Acceptance Criteria`,
			``,
			acData.content,
			``,
			`## Strict Rules`,
			`- ONLY implement features explicitly listed in Acceptance Criteria above`,
			`- DO NOT add features, pages, endpoints, or roles not mentioned in AC`,
			`- Follow the Tech Stack and folder structure exactly as specified`,
			`- All tasks must be tracked via prdfy CLI commands`,
			``,
		].join("\n");

		if (format === "cursor") {
			writeFileSync(".cursorrules", md);
			console.log("✓ Written .cursorrules");
		} else if (format === "agents") {
			writeFileSync("AGENTS.md", md);
			console.log("✓ Written AGENTS.md");
		} else {
			const dir = ".claude/rules";
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
			writeFileSync(join(dir, "project-spec.md"), md);
			console.log(`✓ Written ${dir}/project-spec.md`);
		}
	} catch (err) {
		console.error(`Error: ${err instanceof Error ? err.message : err}`);
		process.exit(1);
	}
}
