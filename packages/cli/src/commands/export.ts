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

/**
 * Product-surface map lives inside User Flow as the `Pages & Screens`
 * subsection. Pulled out verbatim so the generated rules file points the agent
 * at the authoritative list instead of restating it (one source of truth).
 */
function extractProductSurfaces(prd: string): string {
	const lines = prd.split(/\r?\n/);
	const start = lines.findIndex((line) =>
		/^#{3,4}\s*(?:\d+(?:\.\d+)*[.)]?\s*)?Pages\s*&\s*Screens\s*$/i.test(line),
	);
	if (start === -1) return "";

	const captured: string[] = [];
	for (let i = start; i < lines.length; i++) {
		const line = lines[i];
		// The subsection ends at the next heading of level 3 or higher.
		if (i > start && /^#{1,3}\s+/.test(line)) break;
		captured.push(line);
	}
	return captured.join("\n").trim();
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
		const productSurfaces = extractProductSurfaces(prdData.content);
		const projectName = `Project ${projectId}`; // ponytail: PRD name extraction skipped; add when PRD title is reliably structured.

		const md = [
			`# Project Rules: ${projectName}`,
			``,
			`## Tech Stack & Architecture`,
			``,
			techStack,
			``,
			`## Product Surfaces (Pages & Screens)`,
			``,
			productSurfaces ||
				`PRD ini belum memuat sub-section "Pages & Screens" pada User Flow. Baca PRD lengkap (\`prdfy prd ${projectId}\`) dan turunkan seluruh surface yang dibutuhkan requirement sebelum mulai implementasi.`,
			``,
			`## Acceptance Criteria`,
			``,
			acData.content,
			``,
			`## Strict Rules`,
			`- ONLY implement features explicitly listed in Acceptance Criteria above`,
			`- DO NOT add features, pages, endpoints, or roles not mentioned in AC`,
			`- Implement EVERY product surface listed under "Product Surfaces (Pages & Screens)" above. Read the PRD (\`prdfy prd ${projectId}\`) for each surface's purpose, actor, responsibilities, and states.`,
			`- DO NOT drop a required page/screen, and DO NOT merge several distinct surfaces into one page to finish faster. A modal/drawer/inline interaction is valid when the PRD defines it that way or when the interaction semantics genuinely fit better.`,
			`- DO NOT create pages outside the listed surfaces.`,
			`- Product surfaces define WHAT users must be able to reach; the folder structure defines HOW the source code is organized. Satisfy both.`,
			`- Every task declares the AC ids it delivers in its \`covers\` field and the surfaces it touches in its \`surfaces\` field. Implement ALL AC points listed there, not just the happy path (include loading, empty, error, validation, and authorization behavior).`,
			`- DO NOT simplify a requirement to finish faster. A task is not complete just because the happy-path UI renders.`,
			`- DO NOT reduce the product to a minimal prototype: finish every in-scope surface, state, and validation before reporting done.`,
			`- Follow the Tech Stack and folder structure exactly as specified`,
			`- For external credentials/services (API keys, OAuth, Webhooks) that only users can obtain: use clear placeholders in environment files (.env.example/.env.local), complete all integration code and unit tests with mocks, and DO NOT block or fail tasks due to missing real keys. Upon completion, report a structured "External Configuration & Credentials Action Items" guide to the user with official dashboard URLs and exact step-by-step instructions on how to obtain and configure them.`,
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
