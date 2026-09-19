import { describe, expect, it } from "vitest";
import {
	type CodebaseAnalysis,
	codebaseAnalysisSchema,
	parseCodebaseAnalysis,
} from "./codebase-analysis";

const validAnalysis = {
	projectId: "proj_123",
	snapshotId: "snap_123",
	framework: "TanStack Start",
	language: "TypeScript",
	packageManager: "pnpm",
	dependencies: ["react", "drizzle-orm"],
	database: "PostgreSQL",
	auth: "Better Auth",
	moduleMap: [{ path: "src/routes", summary: "File-based routes" }],
	relevantFiles: ["src/db/schema.ts"],
	impactAreas: ["src/routes/api"],
	limitations: ["No test coverage for sync flow yet"],
	findings: [
		{
			title: "Auth boundary",
			detail: "Session is read from Better Auth headers.",
			uncertainty: "Token refresh path was not observed in the snapshot.",
		},
	],
} satisfies CodebaseAnalysis;

describe("codebase analysis schema", () => {
	it("accepts a complete advisory analysis", () => {
		const result = codebaseAnalysisSchema.safeParse(validAnalysis);
		expect(result.success).toBe(true);
	});

	it("rejects analysis missing project identity", () => {
		const { projectId: _omitted, ...withoutProject } = validAnalysis;
		expect(codebaseAnalysisSchema.safeParse(withoutProject).success).toBe(
			false,
		);
	});

	it("rejects analysis missing snapshot identity", () => {
		const { snapshotId: _omitted, ...withoutSnapshot } = validAnalysis;
		expect(codebaseAnalysisSchema.safeParse(withoutSnapshot).success).toBe(
			false,
		);
	});

	it("accepts an uncertain finding with an explicit uncertainty field", () => {
		const result = codebaseAnalysisSchema.safeParse({
			...validAnalysis,
			findings: [
				{
					title: "Uncertain dependency",
					detail: "A background worker may exist outside the snapshot.",
					uncertainty: "Not visible in the uploaded manifest.",
				},
			],
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.findings?.[0]?.uncertainty).toContain("Not visible");
		}
	});

	it("rejects findings with an empty claim", () => {
		const result = codebaseAnalysisSchema.safeParse({
			...validAnalysis,
			findings: [{ title: "", detail: "Missing title." }],
		});
		expect(result.success).toBe(false);
	});
});

describe("parseCodebaseAnalysis", () => {
	it("returns validated analysis for valid input", () => {
		expect(parseCodebaseAnalysis(validAnalysis).snapshotId).toBe("snap_123");
	});

	it("throws on invalid input", () => {
		expect(() => parseCodebaseAnalysis({ projectId: "only" })).toThrow();
	});
});
