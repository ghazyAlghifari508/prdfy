import { describe, expect, it } from "vitest";
import type { CodebaseAnalysis } from "./codebase-analysis";
import {
	askHandoffSchema,
	buildAnalysisSummary,
	buildAskHandoffPrompt,
	buildCodebasePromptBlock,
	buildGenerationContext,
	buildGenerationLinkRow,
	formatBoundedGenerationContext,
	formatGenerationContext,
	limitGenerationContext,
	parseStoredHandoffAnswers,
	sanitizeAskHandoff,
	sanitizeAskHandoffState,
	selectReadyAnalysis,
	truncateText,
} from "./codebase-generation-context";
import type { SnapshotContext } from "./codebase-sync";
import {
	CODEBASE_ASK_HANDOFF_MAX_ANSWERS,
	CODEBASE_ASK_HANDOFF_MAX_OPTIONS,
	CODEBASE_ASK_HANDOFF_MAX_PROMPT_CHARS,
	CODEBASE_ASK_HANDOFF_MAX_STATE_CHARS,
	CODEBASE_GENERATION_MAX_ANSWER_CHARS,
	CODEBASE_GENERATION_MAX_CONSTRAINTS,
	CODEBASE_GENERATION_MAX_CONTEXT_CHARS,
	CODEBASE_GENERATION_MAX_FINDINGS,
	CODEBASE_GENERATION_MAX_PATHS,
	CODEBASE_GENERATION_MAX_PROMPT_CHARS,
	CODEBASE_GENERATION_MAX_SUMMARY_CHARS,
} from "./constants";

const analysis: CodebaseAnalysis = {
	projectId: "proj_123",
	snapshotId: "snap_123",
	framework: "TanStack Start",
	language: "TypeScript",
	packageManager: "pnpm",
	dependencies: ["react"],
	database: "PostgreSQL",
	auth: "Better Auth",
	moduleMap: [{ path: "src/routes", summary: "File-based routes" }],
	relevantFiles: ["src/routes", "src/db/schema.ts"],
	impactAreas: ["src/routes/api"],
	limitations: ["Sync flow has no test coverage yet"],
	findings: [
		{
			title: "Auth boundary",
			detail: "Session is read from Better Auth headers.",
			uncertainty: "Token refresh path was not observed in the snapshot.",
		},
		{
			title: "Certain module",
			detail: "Router wiring is visible in the snapshot.",
		},
	],
};

const snapshot: SnapshotContext = {
	snapshotId: "snap_123",
	projectId: "proj_123",
	branch: "main",
	fileCount: 10,
	excludedCount: 2,
	relevantPaths: ["src/db/schema.ts", "src/lib/codebase-sync.ts"],
};

describe("buildGenerationContext", () => {
	it("dedupes relevant paths across analysis and snapshot", () => {
		const context = buildGenerationContext({
			featurePrompt: "Tambah mode codebase existing",
			analysis,
			snapshot,
		});
		expect(context.relevantPaths).toEqual([
			"src/routes",
			"src/db/schema.ts",
			"src/lib/codebase-sync.ts",
		]);
	});

	it("extracts known constraints from analysis limitations", () => {
		const context = buildGenerationContext({
			featurePrompt: "prompt",
			analysis,
			snapshot,
		});
		expect(context.constraints).toEqual(["Sync flow has no test coverage yet"]);
	});

	it("keeps only uncertain findings for verification", () => {
		const context = buildGenerationContext({
			featurePrompt: "prompt",
			analysis,
			snapshot,
		});
		expect(context.uncertainFindings).toHaveLength(1);
		expect(context.uncertainFindings[0]?.title).toBe("Auth boundary");
	});

	it("fills the analysis record id from the DB record", () => {
		const context = buildGenerationContext({
			featurePrompt: "prompt",
			analysis,
			snapshot,
			analysisId: "analysis_123",
		});
		expect(context.analysisId).toBe("analysis_123");
	});
});

describe("buildAnalysisSummary", () => {
	it("compacts framework, language, package, database, auth, and modules", () => {
		const summary = buildAnalysisSummary(analysis);
		expect(summary).toContain("TanStack Start");
		expect(summary).toContain("TypeScript");
		expect(summary).toContain("pnpm");
		expect(summary).toContain("PostgreSQL");
		expect(summary).toContain("Better Auth");
		expect(summary).toContain("src/routes");
	});

	it("falls back to a placeholder when nothing was detected", () => {
		expect(buildAnalysisSummary({ projectId: "p", snapshotId: "s" })).toBe("-");
	});
});

describe("task 8 generation-context bounds", () => {
	it("exposes sane CODEBASE_* limit constants (no magic literals)", () => {
		expect(CODEBASE_GENERATION_MAX_CONTEXT_CHARS).toBe(6_000);
		expect(CODEBASE_GENERATION_MAX_PATHS).toBe(40);
		expect(CODEBASE_GENERATION_MAX_FINDINGS).toBe(5);
		expect(CODEBASE_GENERATION_MAX_PROMPT_CHARS).toBe(2_000);
		expect(CODEBASE_GENERATION_MAX_ANSWER_CHARS).toBe(1_000);
		expect(CODEBASE_GENERATION_MAX_SUMMARY_CHARS).toBe(2_000);
		expect(CODEBASE_GENERATION_MAX_CONSTRAINTS).toBe(10);
		expect(CODEBASE_ASK_HANDOFF_MAX_PROMPT_CHARS).toBe(8_000);
		expect(CODEBASE_ASK_HANDOFF_MAX_ANSWERS).toBe(60);
	});

	it("truncateText returns short values untouched and caps long ones", () => {
		expect(truncateText("abc", 10)).toBe("abc");
		expect(truncateText("abcdef", 4)).toBe("abcd");
		expect(truncateText("", 4)).toBe("");
	});

	it("limitGenerationContext slices paths/findings and truncates text", () => {
		const big = buildGenerationContext({
			featurePrompt: "x".repeat(CODEBASE_GENERATION_MAX_PROMPT_CHARS + 100),
			userAnswers: ["y".repeat(CODEBASE_GENERATION_MAX_ANSWER_CHARS + 50)],
			analysis: {
				...analysis,
				relevantFiles: Array.from(
					{ length: CODEBASE_GENERATION_MAX_PATHS + 10 },
					(_, i) => `src/file-${i}.ts`,
				),
				findings: Array.from(
					{ length: CODEBASE_GENERATION_MAX_FINDINGS + 3 },
					(_, i) => ({
						title: `Finding ${i}`,
						detail: `detail ${i}`,
						uncertainty: `uncertain ${i}`,
					}),
				),
			},
			snapshot,
		});
		const limited = limitGenerationContext(big);
		expect(limited.relevantPaths.length).toBeLessThanOrEqual(
			CODEBASE_GENERATION_MAX_PATHS,
		);
		expect(limited.uncertainFindings.length).toBeLessThanOrEqual(
			CODEBASE_GENERATION_MAX_FINDINGS,
		);
		expect(limited.featurePrompt.length).toBeLessThanOrEqual(
			CODEBASE_GENERATION_MAX_PROMPT_CHARS,
		);
		expect(limited.userAnswers[0]?.length).toBeLessThanOrEqual(
			CODEBASE_GENERATION_MAX_ANSWER_CHARS,
		);
		// Snapshot identity survives limiting.
		expect(limited.snapshotId).toBe(snapshot.snapshotId);
		expect(limited.projectId).toBe(snapshot.projectId);
	});

	it("limitGenerationContext caps summary chars and constraint count", () => {
		const big = buildGenerationContext({
			featurePrompt: "prompt",
			analysis: {
				...analysis,
				moduleMap: Array.from({ length: 60 }, (_, i) => ({
					path: `src/mod-${i}`,
					summary: `X${"y".repeat(200)}`,
				})),
				limitations: Array.from(
					{ length: CODEBASE_GENERATION_MAX_CONSTRAINTS + 5 },
					(_, i) => `Constraint ${i}`,
				),
			},
			snapshot,
		});
		const limited = limitGenerationContext(big);
		expect(limited.analysisSummary.length).toBeLessThanOrEqual(
			CODEBASE_GENERATION_MAX_SUMMARY_CHARS,
		);
		expect(limited.constraints.length).toBeLessThanOrEqual(
			CODEBASE_GENERATION_MAX_CONSTRAINTS,
		);
		expect(limited.constraints).toEqual(
			big.constraints.slice(0, CODEBASE_GENERATION_MAX_CONSTRAINTS),
		);
		// Identity still survives the new caps.
		expect(limited.snapshotId).toBe(snapshot.snapshotId);
	});

	it("formatBoundedGenerationContext stays within the char budget", () => {
		const formatted = formatBoundedGenerationContext(
			buildGenerationContext({
				featurePrompt: "z".repeat(5000),
				userAnswers: ["w".repeat(3000)],
				analysis,
				snapshot,
			}),
		);
		expect(formatted.length).toBeLessThanOrEqual(
			CODEBASE_GENERATION_MAX_CONTEXT_CHARS,
		);
		expect(formatted).toContain("Source snapshot: snap_123");
	});

	it("buildCodebasePromptBlock is a no-op for null (greenfield byte-identical)", () => {
		expect(buildCodebasePromptBlock(null)).toBe("");
		const base = "system prompt body";
		expect(`${base}${buildCodebasePromptBlock(null)}`).toBe(base);
	});

	it("buildCodebasePromptBlock frames snapshot context and forbids invention", () => {
		const block = buildCodebasePromptBlock(
			buildGenerationContext({
				featurePrompt: "Tambah mode codebase existing",
				userAnswers: ["Jawaban satu"],
				analysis,
				snapshot,
			}),
		);
		expect(block).toContain("snap_123");
		expect(block).toContain("Assumption to verify [Auth boundary]");
		// Model is instructed never to invent paths/architecture.
		expect(block).toMatch(/jangan mengarang/i);
		expect(block.length).toBeLessThanOrEqual(
			CODEBASE_GENERATION_MAX_CONTEXT_CHARS + 1_000,
		);
	});

	it("selectReadyAnalysis picks the latest ready record only", () => {
		const ready = selectReadyAnalysis([
			{ id: "a1", status: "pending", createdAt: "2026-09-19T10:00:00.000Z" },
			{ id: "a2", status: "failed", createdAt: "2026-09-19T11:00:00.000Z" },
			{ id: "a3", status: "ready", createdAt: "2026-09-19T12:00:00.000Z" },
			{ id: "a4", status: "ready", createdAt: "2026-09-19T13:00:00.000Z" },
		]);
		expect(ready?.id).toBe("a4");
	});

	it("selectReadyAnalysis rejects missing/failed/pending analyses", () => {
		expect(selectReadyAnalysis([])).toBeNull();
		expect(
			selectReadyAnalysis([
				{ id: "a1", status: "pending", createdAt: "2026-09-19T10:00:00.000Z" },
				{ id: "a2", status: "failed", createdAt: "2026-09-19T11:00:00.000Z" },
			]),
		).toBeNull();
	});

	it("buildGenerationLinkRow propagates snapshot identity", () => {
		const row = buildGenerationLinkRow({
			projectId: "proj_123",
			snapshotId: "snap_123",
			analysisId: "analysis_123",
		});
		expect(row.projectId).toBe("proj_123");
		expect(row.snapshotId).toBe("snap_123");
		expect(row.analysisId).toBe("analysis_123");
		expect(typeof row.id).toBe("string");
		expect(row.id.length).toBeGreaterThan(0);
	});

	it("askHandoffSchema accepts a bounded handoff", () => {
		const parsed = askHandoffSchema.safeParse({
			projectId: "proj_123",
			answers: [{ question: "Siapa pengguna?", answer: "Tim internal" }],
			compiledPrompt: "Tolong buatkan PRD dengan spesifikasi berikut",
		});
		expect(parsed.success).toBe(true);
	});

	it("sanitizeAskHandoff caps answers and prompt length", () => {
		const sanitized = sanitizeAskHandoff({
			projectId: "proj_123",
			answers: Array.from(
				{ length: CODEBASE_ASK_HANDOFF_MAX_ANSWERS + 10 },
				(_, i) => ({ question: `Q${i}`, answer: "A" }),
			),
			compiledPrompt: "p".repeat(CODEBASE_ASK_HANDOFF_MAX_PROMPT_CHARS + 500),
		});
		expect(sanitized.answers.length).toBeLessThanOrEqual(
			CODEBASE_ASK_HANDOFF_MAX_ANSWERS,
		);
		expect(sanitized.compiledPrompt?.length).toBeLessThanOrEqual(
			CODEBASE_ASK_HANDOFF_MAX_PROMPT_CHARS,
		);
		expect(sanitized.projectId).toBe("proj_123");
	});

	it("buildAskHandoffPrompt keeps neutral placeholders out of secrets", () => {
		const prompt = buildAskHandoffPrompt([
			{ question: "Target?", answer: "Internal" },
		]);
		expect(prompt).toContain("Target?");
		expect(prompt).toContain("Internal");
	});

	it("parseStoredHandoffAnswers drops malformed entries without throwing", () => {
		expect(
			parseStoredHandoffAnswers([
				{ question: "Q?", answer: "A" },
				{ question: "", answer: "empty-q" },
				{ question: "no-answer" },
				null,
				"garbage",
			]),
		).toEqual([{ question: "Q?", answer: "A" }]);
		expect(parseStoredHandoffAnswers(null)).toEqual([]);
		expect(parseStoredHandoffAnswers("nope")).toEqual([]);
	});

	it("sanitizeAskHandoffState bounds questions, options, and total size", () => {
		expect(CODEBASE_ASK_HANDOFF_MAX_STATE_CHARS).toBe(20_000);
		expect(CODEBASE_ASK_HANDOFF_MAX_OPTIONS).toBe(8);
		const clean = sanitizeAskHandoffState({
			prompt: "P".repeat(9_000),
			platform: "web",
			session: 2,
			questions: [
				{
					id: "q1",
					question: "Apa target?",
					type: "select",
					options: Array.from({ length: 20 }, (_, i) => `Opsi ${i}`),
				},
			],
			nonTechAnswers: {
				q1: { value: "x", isCustom: false, skipped: false },
			},
			techAnswers: {},
			skippedTech: ["frontend"],
		});
		expect(clean.questions?.length).toBe(1);
		expect(clean.questions?.[0]?.options?.length).toBeLessThanOrEqual(
			CODEBASE_ASK_HANDOFF_MAX_OPTIONS,
		);
		expect(JSON.stringify(clean).length).toBeLessThanOrEqual(
			CODEBASE_ASK_HANDOFF_MAX_STATE_CHARS,
		);
	});

	it("askHandoffSchema accepts an optional restorable state snapshot", () => {
		const parsed = askHandoffSchema.safeParse({
			projectId: "proj_123",
			answers: [{ question: "Q?", answer: "A" }],
			compiledPrompt: "compiled",
			state: {
				prompt: "ide awal",
				platform: "web",
				session: 1,
				questions: [{ id: "q1", question: "Q?", type: "text" }],
			},
		});
		expect(parsed.success).toBe(true);
	});

	it("askHandoffSchema accepts an in-flight handoff without compiledPrompt", () => {
		const parsed = askHandoffSchema.safeParse({
			projectId: "proj_456",
			state: {
				prompt: "proyek baru",
				platform: "mobile",
				session: 1,
				questions: [],
			},
		});
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.answers).toEqual([]);
			expect(parsed.data.compiledPrompt).toBeUndefined();
		}
	});

	it("sanitizeAskHandoff preserves undefined compiledPrompt for in-flight handoffs", () => {
		const clean = sanitizeAskHandoff({
			projectId: "proj_456",
			answers: [],
			state: {
				prompt: "proyek baru",
				platform: "mobile",
			},
		});
		expect(clean.compiledPrompt).toBeUndefined();
		expect(clean.answers).toEqual([]);
		expect(clean.state?.prompt).toBe("proyek baru");
	});
});

describe("formatGenerationContext", () => {
	it("emits all six sections including the analysis body", () => {
		const formatted = formatGenerationContext(
			buildGenerationContext({
				featurePrompt: "Tambah mode codebase existing",
				userAnswers: ["Jawaban satu"],
				analysis,
				snapshot,
			}),
		);
		expect(formatted).toContain("Feature request: Tambah mode codebase");
		expect(formatted).toContain("User answers: Jawaban satu");
		expect(formatted).toContain("TanStack Start");
		expect(formatted).toContain("src/db/schema.ts");
		expect(formatted).toContain("Known constraints:");
		expect(formatted).toContain(
			"Assumption to verify [Auth boundary]: Token refresh path was not observed in the snapshot.",
		);
		expect(formatted).toContain("Source snapshot: snap_123");
	});

	it("uses placeholders for empty sections", () => {
		const formatted = formatGenerationContext(
			buildGenerationContext({
				featurePrompt: "prompt",
				analysis: { projectId: "p", snapshotId: "s" },
				snapshot: { snapshotId: "s", projectId: "p", fileCount: 0 },
			}),
		);
		expect(formatted).toContain("User answers: -");
		expect(formatted).toContain("Relevant modules/files: -");
		expect(formatted).toContain("Known constraints: -");
		expect(formatted).toContain("Codebase analysis: -");
	});
});
