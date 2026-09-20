import { describe, expect, it } from "vitest";
import {
	ADAPTIVE_CREDIT_PRICING,
	type CreditComplexityMetrics,
	calculateFinalCreditCost,
	estimateCreditQuote,
} from "./adaptive-credit";

const emptyMetrics: CreditComplexityMetrics = {};

describe("adaptive credit pricing", () => {
	it("includes the configured base cost for every billable operation", () => {
		for (const operation of [
			"codebase_analysis",
			"prd_generation",
			"ac_generation",
			"task_generation",
		] as const) {
			const quote = estimateCreditQuote({ operation, metrics: emptyMetrics });

			expect(quote.estimatedCredits).toBe(
				ADAPTIVE_CREDIT_PRICING.operations[operation].baseCredits,
			);
			expect(quote.pricingVersion).toBe(ADAPTIVE_CREDIT_PRICING.version);
		}
	});

	it("adds configured surcharges when measurable metrics cross thresholds", () => {
		const baseQuote = estimateCreditQuote({
			operation: "prd_generation",
			metrics: emptyMetrics,
		});
		const complexQuote = estimateCreditQuote({
			operation: "prd_generation",
			metrics: {
				promptChars: ADAPTIVE_CREDIT_PRICING.thresholds.promptChars,
				project: {
					featureCount: ADAPTIVE_CREDIT_PRICING.thresholds.featureCount,
				},
			},
		});

		expect(complexQuote.estimatedCredits).toBeGreaterThan(
			baseQuote.estimatedCredits,
		);
	});

	it("keeps metrics below their thresholds neutral", () => {
		const baseQuote = estimateCreditQuote({
			operation: "prd_generation",
			metrics: emptyMetrics,
		});
		const belowThresholdQuote = estimateCreditQuote({
			operation: "prd_generation",
			metrics: {
				promptChars: ADAPTIVE_CREDIT_PRICING.thresholds.promptChars - 1,
				project: {
					featureCount: ADAPTIVE_CREDIT_PRICING.thresholds.featureCount - 1,
				},
			},
		});

		expect(belowThresholdQuote.estimatedCredits).toBe(
			baseQuote.estimatedCredits,
		);
	});

	it("rounds fractional measured cost upward to an integer credit", () => {
		const finalCost = calculateFinalCreditCost({
			operation: "task_generation",
			usage: { measuredUnits: 1.01 },
			maximumCredits:
				ADAPTIVE_CREDIT_PRICING.operations.task_generation.maximumCredits,
		});

		expect(finalCost).toBe(2);
	});

	it("keeps the configured maximum charge at or above the estimate", () => {
		for (const operation of [
			"codebase_analysis",
			"prd_generation",
			"ac_generation",
			"task_generation",
		] as const) {
			const quote = estimateCreditQuote({
				operation,
				metrics: {
					promptChars: Number.MAX_SAFE_INTEGER,
					project: { featureCount: Number.MAX_SAFE_INTEGER },
					codebase: {
						fileCount: Number.MAX_SAFE_INTEGER,
						sourceBytes: Number.MAX_SAFE_INTEGER,
						languageCount: Number.MAX_SAFE_INTEGER,
						dependencyCount: Number.MAX_SAFE_INTEGER,
						relationshipCount: Number.MAX_SAFE_INTEGER,
					},
				},
			});

			expect(quote.maximumCredits).toBe(
				ADAPTIVE_CREDIT_PRICING.operations[operation].maximumCredits,
			);
			expect(quote.maximumCredits).toBeGreaterThanOrEqual(
				quote.estimatedCredits,
			);
		}
	});

	it("uses zero for omitted optional metrics", () => {
		const omitted = estimateCreditQuote({
			operation: "codebase_analysis",
			metrics: {},
		});
		const explicitNeutral = estimateCreditQuote({
			operation: "codebase_analysis",
			metrics: {
				project: {
					featureCount: 0,
					personaCount: 0,
					workflowCount: 0,
					requirementCount: 0,
					constraintCount: 0,
				},
				promptChars: 0,
				prdSourceChars: 0,
				taskCount: 0,
				codebase: {
					fileCount: 0,
					sourceBytes: 0,
					languageCount: 0,
					dependencyCount: 0,
					relationshipCount: 0,
				},
				hasCodebaseContext: false,
			},
		});

		expect(omitted.estimatedCredits).toBe(explicitNeutral.estimatedCredits);
	});

	it("caps final cost and rounds validated real usage upward", () => {
		const finalCost = calculateFinalCreditCost({
			operation: "prd_generation",
			usage: { measuredUnits: 1.01 },
			maximumCredits: 3,
		});

		expect(finalCost).toBe(2);
		expect(
			calculateFinalCreditCost({
				operation: "prd_generation",
				usage: { measuredUnits: 99 },
				maximumCredits: 3,
			}),
		).toBe(3);
	});

	it("never accepts a caller cap above the configured operation maximum", () => {
		expect(
			calculateFinalCreditCost({
				operation: "prd_generation",
				usage: { measuredUnits: 99 },
				maximumCredits: 99,
			}),
		).toBe(ADAPTIVE_CREDIT_PRICING.operations.prd_generation.maximumCredits);
	});
});
