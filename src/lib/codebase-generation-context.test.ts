import { describe, expect, it } from "vitest";
import type { CodebaseAnalysis } from "./codebase-analysis";
import {
	buildAnalysisSummary,
	buildGenerationContext,
	formatGenerationContext,
} from "./codebase-generation-context";
import type { SnapshotContext } from "./codebase-sync";

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
