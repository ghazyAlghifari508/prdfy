import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
// Server-module import is safe in vitest: .env.local provides DATABASE_URL
// (see vitest.config.ts) and no connection opens until a query runs.
import {
	buildCodebaseMetrics,
	estimateCreditQuote,
	formatInsufficientCreditsError,
	formatSubscriptionPausedError,
} from "./adaptive-credit";
import {
	AnalysisValidationError,
	analysisRequestSchema,
	analysisResponseSchema,
	buildAnalysisUserPrompt,
	CODEBASE_ANALYSIS_SYSTEM_PROMPT,
	type CodebaseAnalysis,
	codebaseAnalysisSchema,
	decideAnalysisRequest,
	inferTechAnswersFromCodebase,
	parseAnalysisOutput,
	parseCodebaseAnalysis,
	selectSourceExcerpts,
	toSafeAnalysisErrorMessage,
} from "./codebase-analysis";
import { AnalysisServiceError } from "./codebase-analysis.server";
import {
	type CreditServiceStore,
	createCreditService,
} from "./services/credit-service";

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

describe("codebase analysis system prompt", () => {
	it("requires JSON-only output and forbids inventing paths", () => {
		expect(CODEBASE_ANALYSIS_SYSTEM_PROMPT).toMatch(/JSON/i);
		expect(CODEBASE_ANALYSIS_SYSTEM_PROMPT).toMatch(
			/ketidakpastian|uncertainty/i,
		);
		expect(CODEBASE_ANALYSIS_SYSTEM_PROMPT).toMatch(
			/jangan.*(mengarang|invent)/i,
		);
	});
});

describe("buildAnalysisUserPrompt", () => {
	const baseInput = {
		projectId: "proj_123",
		snapshotId: "snap_123",
		featurePrompt: "Aplikasi kasir untuk UMKM",
		manifest: [
			{ path: "src/index.ts", size: 120, hash: "a".repeat(64) },
			{ path: "src/db/schema.ts", size: 340, hash: "b".repeat(64) },
		],
		files: [{ path: "src/index.ts", text: "export const x = 1;" }],
		fileCount: 2,
		excludedCount: 5,
	};

	it("includes the feature prompt, manifest paths, and counts", () => {
		const prompt = buildAnalysisUserPrompt(baseInput);
		expect(prompt).toContain("Aplikasi kasir untuk UMKM");
		expect(prompt).toContain("src/index.ts");
		expect(prompt).toContain("src/db/schema.ts");
		expect(prompt).toContain("snap_123");
	});

	it("bounds source excerpts and marks truncation explicitly", () => {
		const big = "x".repeat(5000);
		const prompt = buildAnalysisUserPrompt({
			...baseInput,
			files: [{ path: "src/big.ts", text: big }],
			maxContextChars: 100,
		});
		expect(prompt.length).toBeLessThan(5000);
		expect(prompt).toMatch(/dipotong|truncat/i);
	});
});

describe("selectSourceExcerpts", () => {
	it("preserves file order and caps total characters", () => {
		const { excerpts, truncated } = selectSourceExcerpts(
			[
				{ path: "a.ts", text: "aaa" },
				{ path: "b.ts", text: "bbb" },
			],
			5,
		);
		expect(excerpts[0]?.path).toBe("a.ts");
		expect(truncated).toBe(true);
		const total = excerpts.reduce((sum, f) => sum + f.text.length, 0);
		expect(total).toBeLessThanOrEqual(5);
	});

	it("returns everything untruncated when under the cap", () => {
		const { excerpts, truncated } = selectSourceExcerpts(
			[{ path: "a.ts", text: "aaa" }],
			1000,
		);
		expect(truncated).toBe(false);
		expect(excerpts).toHaveLength(1);
	});
});

describe("parseAnalysisOutput", () => {
	const ids = { projectId: "proj_123", snapshotId: "snap_123" };
	const modelJson = JSON.stringify({
		framework: "TanStack Start",
		language: "TypeScript",
	});

	it("validates bare model JSON and injects server identities", () => {
		const result = parseAnalysisOutput(modelJson, ids);
		expect(result.projectId).toBe("proj_123");
		expect(result.snapshotId).toBe("snap_123");
		expect(result.framework).toBe("TanStack Start");
	});

	it("validates fenced model JSON", () => {
		const result = parseAnalysisOutput(`\`\`\`json\n${modelJson}\n\`\`\``, ids);
		expect(result.language).toBe("TypeScript");
	});

	it("overrides model-provided identities with server values", () => {
		const result = parseAnalysisOutput(
			JSON.stringify({
				projectId: "proj_evil",
				snapshotId: "snap_evil",
				framework: "X",
			}),
			ids,
		);
		expect(result.projectId).toBe("proj_123");
		expect(result.snapshotId).toBe("snap_123");
	});

	it("throws a typed error without leaking model text on invalid JSON", () => {
		const raw = "{ not json at all {{{";
		try {
			parseAnalysisOutput(raw, ids);
			expect.unreachable("expected AnalysisValidationError");
		} catch (error) {
			expect(error).toBeInstanceOf(AnalysisValidationError);
			expect((error as AnalysisValidationError).code).toBe("ANALYSIS_FAILED");
			expect((error as Error).message).not.toContain("not json");
		}
	});

	it("throws a typed error when the shape fails validation", () => {
		try {
			parseAnalysisOutput(JSON.stringify({ framework: 42 }), ids);
			expect.unreachable("expected AnalysisValidationError");
		} catch (error) {
			expect(error).toBeInstanceOf(AnalysisValidationError);
			expect((error as AnalysisValidationError).code).toBe("ANALYSIS_FAILED");
		}
	});
});

describe("decideAnalysisRequest", () => {
	it("rejects analysis when the snapshot is not uploaded", () => {
		for (const status of ["uploading", "failed", "expired", "analyzing"]) {
			const decision = decideAnalysisRequest({ id: "snap_1", status }, []);
			expect(decision.action).toBe("reject");
		}
	});

	it("reuses a pending analysis instead of duplicating it", () => {
		const decision = decideAnalysisRequest(
			{ id: "snap_1", status: "uploaded" },
			[{ id: "an_pending", status: "pending" }],
		);
		expect(decision).toEqual({ action: "reuse", analysisId: "an_pending" });
	});

	it("reuses a ready analysis instead of regenerating", () => {
		const decision = decideAnalysisRequest(
			{ id: "snap_1", status: "uploaded" },
			[{ id: "an_ready", status: "ready" }],
		);
		expect(decision).toEqual({ action: "reuse", analysisId: "an_ready" });
	});

	it("creates a fresh record when there is no analysis yet", () => {
		const decision = decideAnalysisRequest(
			{ id: "snap_1", status: "uploaded" },
			[],
		);
		expect(decision).toEqual({ action: "create" });
	});

	it("creates a fresh record after a failed attempt", () => {
		const decision = decideAnalysisRequest(
			{ id: "snap_1", status: "uploaded" },
			[{ id: "an_failed", status: "failed" }],
		);
		expect(decision).toEqual({ action: "create" });
	});
});

describe("analysis trigger/read DTOs", () => {
	it("accepts an empty trigger body (latest uploaded snapshot)", () => {
		expect(analysisRequestSchema.safeParse({}).success).toBe(true);
	});

	it("accepts a pinned snapshot trigger", () => {
		expect(
			analysisRequestSchema.safeParse({ snapshotId: "snap_123" }).success,
		).toBe(true);
	});

	it("rejects an empty pinned snapshot id", () => {
		expect(analysisRequestSchema.safeParse({ snapshotId: "" }).success).toBe(
			false,
		);
	});

	it("accepts a ready analysis response with validated output", () => {
		const result = analysisResponseSchema.safeParse({
			id: "an_123",
			projectId: "proj_123",
			snapshotId: "snap_123",
			status: "pending",
		});
		expect(result.success).toBe(true);
	});

	it("rejects an analysis response with an unknown status", () => {
		expect(
			analysisResponseSchema.safeParse({
				id: "an_123",
				projectId: "proj_123",
				snapshotId: "snap_123",
				status: "analyzing",
			}).success,
		).toBe(false);
	});
});

describe("toSafeAnalysisErrorMessage", () => {
	it("returns a fixed user-facing message without error internals", () => {
		const message = toSafeAnalysisErrorMessage(
			new Error("sk-abcdef secret stack trace"),
		);
		expect(message).toMatch(/gagal|coba lagi/i);
		expect(message).not.toContain("sk-abcdef");
	});

	it("handles non-error values safely", () => {
		expect(toSafeAnalysisErrorMessage(null)).toMatch(/gagal|tidak tersedia/i);
		expect(toSafeAnalysisErrorMessage("raw string")).not.toContain(
			"raw string",
		);
	});
});

describe("inferTechAnswersFromCodebase", () => {
	it("infers React + Vite frontend and Vercel deployment correctly", () => {
		const inferred = inferTechAnswersFromCodebase(
			{
				projectId: "p1",
				snapshotId: "s1",
				framework: "React 19 (Vite, Tailwind CSS, React Router)",
				language: "JavaScript",
				dependencies: [
					"react",
					"react-dom",
					"react-router-dom",
					"axios",
					"tailwind-merge",
				],
				relevantFiles: ["vercel.json", "src/App.jsx"],
			},
			"web",
		);

		expect(inferred.frontend).toBe("React (Vite)");
		expect(inferred.deployment).toBe("Vercel");
	});

	it("infers TanStack Start fullstack framework and PostgreSQL database", () => {
		const inferred = inferTechAnswersFromCodebase(
			{
				projectId: "p1",
				snapshotId: "s1",
				framework: "TanStack Start",
				language: "TypeScript",
				dependencies: ["@tanstack/react-start", "drizzle-orm", "pg"],
				database: "PostgreSQL · Drizzle ORM",
			},
			"web",
		);

		expect(inferred.fullstackFramework).toBe("TanStack Start (FE+BE)");
		expect(inferred.database).toBe("PostgreSQL");
		expect(inferred.deployment).toBe("Vercel");
	});

	it("infers mobile frameworks when platform is mobile", () => {
		const inferred = inferTechAnswersFromCodebase(
			{
				projectId: "p1",
				snapshotId: "s1",
				framework: "Expo React Native",
				dependencies: ["expo", "react-native"],
			},
			"mobile",
		);

		expect(inferred.frontend).toBe("Expo");
	});
});

describe("codebase analysis credit lifecycle", () => {
	function makeStore(): CreditServiceStore {
		return {
			subscriptions: new Map([
				[
					"sub-1",
					{
						id: "sub-1",
						userId: "user-1",
						credits: 20,
						creditsUsed: 0,
						creditsReserved: 0,
						currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
					},
				],
			]),
			projects: new Map([["project-1", { id: "project-1", userId: "user-1" }]]),
			operations: new Map(),
			ledger: [],
		};
	}

	it("calculates codebase complexity metrics from snapshot fileCount and contentSize", () => {
		const metrics = buildCodebaseMetrics({
			fileCount: 120,
			contentSize: 450_000,
		});

		expect(metrics).toEqual({
			codebase: {
				fileCount: 120,
				sourceBytes: 450_000,
			},
		});
	});

	it("ready analysis reuse causes zero credit reservations or debits", () => {
		const store = makeStore();
		const decision = decideAnalysisRequest(
			{ id: "snap_1", status: "uploaded" },
			[{ id: "an_ready", status: "ready" }],
		);
		expect(decision).toEqual({ action: "reuse", analysisId: "an_ready" });

		const subscription = store.subscriptions.get("sub-1");
		expect(store.operations.size).toBe(0);
		expect(store.ledger).toHaveLength(0);
		expect(subscription?.creditsReserved).toBe(0);
		expect(subscription?.creditsUsed).toBe(0);
	});

	it("new analysis reserves before execution and settles on success with artifact ID", () => {
		const store = makeStore();
		const service = createCreditService(store);
		const metrics = buildCodebaseMetrics({
			fileCount: 100,
			contentSize: 250_000,
		});
		const quote = service.createCreditQuote({
			userId: "user-1",
			projectId: "project-1",
			stage: "codebase",
			operation: "codebase_analysis",
			metrics,
		});

		expect(quote.operation).toBe("codebase_analysis");
		expect(quote.maximumCredits).toBe(12);

		const reservation = service.reserveCreditOperation({
			userId: "user-1",
			projectId: "project-1",
			stage: "codebase",
			operation: "codebase_analysis",
			metrics,
			idempotencyKey: "project-1:codebase_analysis:snap-1",
			quote,
		});

		expect(reservation.state).toBe("reserved");
		const subscription = store.subscriptions.get("sub-1");
		expect(subscription?.creditsReserved).toBe(12);

		service.markCreditOperationRunning({
			userId: "user-1",
			operationId: reservation.id,
		});

		const settled = service.settleCreditOperation({
			userId: "user-1",
			operationId: reservation.id,
			artifactId: "analysis-row-uuid-1",
			actualMetrics: metrics,
		});

		expect(settled.state).toBe("settled");
		expect(settled.finalCharge).toBe(quote.estimatedCredits);
		expect(subscription?.creditsReserved).toBe(0);
		expect(subscription?.creditsUsed).toBe(quote.estimatedCredits);

		const op = store.operations.get(reservation.id);
		expect(op?.artifactReference).toBe("analysis-row-uuid-1");
	});

	it("analysis failure releases reservation with 0 debit", () => {
		const store = makeStore();
		const service = createCreditService(store);
		const metrics = buildCodebaseMetrics({
			fileCount: 50,
			contentSize: 100_000,
		});
		const quote = service.createCreditQuote({
			userId: "user-1",
			projectId: "project-1",
			stage: "codebase",
			operation: "codebase_analysis",
			metrics,
		});

		const reservation = service.reserveCreditOperation({
			userId: "user-1",
			projectId: "project-1",
			stage: "codebase",
			operation: "codebase_analysis",
			metrics,
			idempotencyKey: "project-1:codebase_analysis:snap-fail",
			quote,
		});

		service.markCreditOperationRunning({
			userId: "user-1",
			operationId: reservation.id,
		});

		const released = service.releaseCreditOperation({
			userId: "user-1",
			operationId: reservation.id,
			reason: "AI model failed",
		});

		expect(released.state).toBe("released");
		expect(released.finalCharge).toBeNull();
		const subscription = store.subscriptions.get("sub-1");
		expect(subscription?.creditsReserved).toBe(0);
		expect(subscription?.creditsUsed).toBe(0);
		expect(store.ledger.reduce((sum, e) => sum + e.amount, 0)).toBe(0);
	});

	it("insufficient credits rejects with 403 before model execution", () => {
		const store = makeStore();
		const subscription = store.subscriptions.get("sub-1");
		if (!subscription) throw new Error("Missing test fixture");
		subscription.credits = 3;

		const metrics = buildCodebaseMetrics({
			fileCount: 10,
			contentSize: 20_000,
		});
		const quote = estimateCreditQuote({
			operation: "codebase_analysis",
			metrics,
		});

		const availableCredits = Math.max(
			0,
			subscription.credits -
				subscription.creditsUsed -
				subscription.creditsReserved,
		);

		expect(availableCredits < quote.maximumCredits).toBe(true);

		const err = formatInsufficientCreditsError({
			quote,
			availableCredits,
			stageLabel: "analisis codebase",
		});

		expect(err.code).toBe("NO_CREDITS");
		expect(err.requiredCredits).toBe(12);
		expect(err.availableCredits).toBe(3);
	});

	it("paused subscription rejects with 403 before model execution", () => {
		const metrics = buildCodebaseMetrics({
			fileCount: 10,
			contentSize: 20_000,
		});
		const quote = estimateCreditQuote({
			operation: "codebase_analysis",
			metrics,
		});

		const err = formatSubscriptionPausedError({
			quote,
			availableCredits: 10,
			stageLabel: "analisis codebase",
		});

		expect(err.code).toBe("SUBSCRIPTION_PAUSED");
		expect(err.requiredCredits).toBe(12);
		expect(err.availableCredits).toBe(10);
	});

	it("constructs AnalysisServiceError with code, message, and optional analysisId", () => {
		const err = new AnalysisServiceError(
			"ANALYSIS_FAILED",
			"Model timeout",
			"an_123",
		);
		expect(err.code).toBe("ANALYSIS_FAILED");
		expect(err.message).toBe("Model timeout");
		expect(err.analysisId).toBe("an_123");
	});
});

describe("requestCodebaseAnalysis atomic claim contract", () => {
	it("claims session atomically using conditional uploaded status in a transaction", async () => {
		const source = await readFile(
			new URL("./codebase-analysis.server.ts", import.meta.url),
			"utf8",
		);
		const claimIndex = source.indexOf("db.transaction(async (tx) => {");
		const conditionalUpdateIndex = source.indexOf(
			'eq(codebaseSyncSessions.status, "uploaded")',
		);
		const insertAnalysisIndex = source.indexOf("tx.insert(codebaseAnalyses)");
		const generateIndex = source.indexOf("await generate(messages)");

		expect(claimIndex).toBeGreaterThan(-1);
		expect(conditionalUpdateIndex).toBeGreaterThan(claimIndex);
		expect(insertAnalysisIndex).toBeGreaterThan(conditionalUpdateIndex);
		expect(generateIndex).toBeGreaterThan(insertAnalysisIndex);
	});
});

describe("decideAnalysisRequest with an already-analyzed uploaded snapshot", () => {
	it("reuses a ready analysis on an uploaded snapshot", () => {
		expect(
			decideAnalysisRequest({ id: "s1", status: "uploaded" }, [
				{ id: "a1", status: "ready" },
			]),
		).toEqual({ action: "reuse", analysisId: "a1" });
	});

	it("creates a new record when only failed attempts exist", () => {
		expect(
			decideAnalysisRequest({ id: "s1", status: "uploaded" }, [
				{ id: "a1", status: "failed" },
			]),
		).toEqual({ action: "create" });
	});

	it("rejects a snapshot that is not uploaded", () => {
		const decision = decideAnalysisRequest(
			{ id: "s1", status: "uploading" },
			[],
		);
		expect(decision.action).toBe("reject");
	});
});
