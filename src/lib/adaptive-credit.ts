import { ADAPTIVE_CREDIT_PRICING } from "@/lib/constants";

export { ADAPTIVE_CREDIT_PRICING } from "@/lib/constants";

export type CreditOperationKind =
	| "codebase_analysis"
	| "prd_generation"
	| "ac_generation"
	| "task_generation";

export type CreditOperationState =
	| "quoted"
	| "reserved"
	| "running"
	| "settling"
	| "settled"
	| "released"
	| "failed"
	| "refunded";

export type CreditLedgerEntryType =
	| "grant"
	| "reservation"
	| "release"
	| "debit"
	| "refund"
	| "correction";

export type CreditPricingVersion = typeof ADAPTIVE_CREDIT_PRICING.version;

export interface CreditComplexityMetrics {
	promptChars?: number;
	prdSourceChars?: number;
	taskCount?: number;
	hasCodebaseContext?: boolean;
	project?: {
		featureCount?: number;
		personaCount?: number;
		workflowCount?: number;
		requirementCount?: number;
		constraintCount?: number;
	};
	codebase?: {
		fileCount?: number;
		sourceBytes?: number;
		languageCount?: number;
		dependencyCount?: number;
		relationshipCount?: number;
	};
}

export interface CreditQuote {
	operation: CreditOperationKind;
	pricingVersion: CreditPricingVersion;
	estimatedCredits: number;
	maximumCredits: number;
	metrics: CreditComplexityMetrics;
}

export interface CreditEstimateInput {
	operation: CreditOperationKind;
	metrics: CreditComplexityMetrics;
}

export interface CreditUsageInput {
	operation: CreditOperationKind;
	usage: {
		measuredUnits: number;
	};
	maximumCredits: number;
}

function nonNegativeFinite(value: number | undefined): number {
	return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

function thresholdUnits(value: number | undefined, threshold: number): number {
	const normalizedValue = nonNegativeFinite(value);
	return normalizedValue < threshold
		? 0
		: Math.ceil(normalizedValue / threshold);
}

function surcharge(metrics: CreditComplexityMetrics): number {
	const thresholds = ADAPTIVE_CREDIT_PRICING.thresholds;
	const weights = ADAPTIVE_CREDIT_PRICING.weights;
	const project = metrics.project ?? {};
	const codebase = metrics.codebase ?? {};

	return (
		thresholdUnits(metrics.promptChars, thresholds.promptChars) *
			weights.promptChars +
		thresholdUnits(metrics.prdSourceChars, thresholds.prdSourceChars) *
			weights.prdSourceChars +
		thresholdUnits(metrics.taskCount, thresholds.taskCount) *
			weights.taskCount +
		thresholdUnits(project.featureCount, thresholds.featureCount) *
			weights.featureCount +
		thresholdUnits(project.personaCount, thresholds.personaCount) *
			weights.personaCount +
		thresholdUnits(project.workflowCount, thresholds.workflowCount) *
			weights.workflowCount +
		thresholdUnits(project.requirementCount, thresholds.requirementCount) *
			weights.requirementCount +
		thresholdUnits(project.constraintCount, thresholds.constraintCount) *
			weights.constraintCount +
		thresholdUnits(codebase.fileCount, thresholds.fileCount) *
			weights.fileCount +
		thresholdUnits(codebase.sourceBytes, thresholds.sourceBytes) *
			weights.sourceBytes +
		thresholdUnits(codebase.languageCount, thresholds.languageCount) *
			weights.languageCount +
		thresholdUnits(codebase.dependencyCount, thresholds.dependencyCount) *
			weights.dependencyCount +
		thresholdUnits(codebase.relationshipCount, thresholds.relationshipCount) *
			weights.relationshipCount +
		(metrics.hasCodebaseContext === true ? weights.codebaseContext : 0)
	);
}

export function estimateCreditQuote(input: CreditEstimateInput): CreditQuote {
	const pricing = ADAPTIVE_CREDIT_PRICING.operations[input.operation];
	const estimatedCredits = Math.min(
		pricing.maximumCredits,
		Math.max(
			pricing.baseCredits,
			Math.ceil(pricing.baseCredits + surcharge(input.metrics)),
		),
	);

	return {
		operation: input.operation,
		pricingVersion: ADAPTIVE_CREDIT_PRICING.version,
		estimatedCredits,
		maximumCredits: pricing.maximumCredits,
		metrics: input.metrics,
	};
}

export function calculateFinalCreditCost(input: CreditUsageInput): number {
	const configuredMaximum =
		ADAPTIVE_CREDIT_PRICING.operations[input.operation].maximumCredits;
	const maximumCredits = Math.min(
		configuredMaximum,
		Math.max(0, Math.floor(input.maximumCredits)),
	);
	const measuredUnits = nonNegativeFinite(input.usage.measuredUnits);
	return Math.min(maximumCredits, Math.ceil(measuredUnits));
}
