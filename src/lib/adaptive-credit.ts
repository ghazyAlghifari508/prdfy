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

const metricWeights = {
	promptChars: 0.25,
	prdSourceChars: 0.5,
	taskCount: 0.5,
	featureCount: 0.5,
	personaCount: 0.25,
	workflowCount: 0.5,
	requirementCount: 0.25,
	constraintCount: 0.25,
	fileCount: 0.5,
	sourceBytes: 0.5,
	languageCount: 0.25,
	dependencyCount: 0.25,
	relationshipCount: 0.25,
} as const;

function nonNegativeFinite(value: number | undefined): number {
	return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

function thresholdUnits(value: number | undefined, threshold: number): number {
	return Math.ceil(nonNegativeFinite(value) / threshold);
}

function surcharge(metrics: CreditComplexityMetrics): number {
	const thresholds = ADAPTIVE_CREDIT_PRICING.thresholds;
	const project = metrics.project ?? {};
	const codebase = metrics.codebase ?? {};

	return (
		thresholdUnits(metrics.promptChars, thresholds.promptChars) *
			metricWeights.promptChars +
		thresholdUnits(metrics.prdSourceChars, thresholds.prdSourceChars) *
			metricWeights.prdSourceChars +
		thresholdUnits(metrics.taskCount, thresholds.taskCount) *
			metricWeights.taskCount +
		thresholdUnits(project.featureCount, thresholds.featureCount) *
			metricWeights.featureCount +
		thresholdUnits(project.personaCount, thresholds.personaCount) *
			metricWeights.personaCount +
		thresholdUnits(project.workflowCount, thresholds.workflowCount) *
			metricWeights.workflowCount +
		thresholdUnits(project.requirementCount, thresholds.requirementCount) *
			metricWeights.requirementCount +
		thresholdUnits(project.constraintCount, thresholds.constraintCount) *
			metricWeights.constraintCount +
		thresholdUnits(codebase.fileCount, thresholds.fileCount) *
			metricWeights.fileCount +
		thresholdUnits(codebase.sourceBytes, thresholds.sourceBytes) *
			metricWeights.sourceBytes +
		thresholdUnits(codebase.languageCount, thresholds.languageCount) *
			metricWeights.languageCount +
		thresholdUnits(codebase.dependencyCount, thresholds.dependencyCount) *
			metricWeights.dependencyCount +
		thresholdUnits(codebase.relationshipCount, thresholds.relationshipCount) *
			metricWeights.relationshipCount +
		(metrics.hasCodebaseContext === true ? 0.5 : 0)
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
	const maximumCredits = Math.max(0, Math.floor(input.maximumCredits));
	const measuredUnits = nonNegativeFinite(input.usage.measuredUnits);
	return Math.min(maximumCredits, Math.ceil(measuredUnits));
}
