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
	| "quarantined"
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

export type CreditPricingVersion =
	| typeof ADAPTIVE_CREDIT_PRICING.version
	| "2026-09-20";

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

export function surcharge(metrics: CreditComplexityMetrics): number {
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

function normalizeCodebaseMetrics(
	codebase:
		| {
				sourceBytes?: number;
				contentSize?: number;
				fileCount?: number;
				languageCount?: number;
				dependencyCount?: number;
				relationshipCount?: number;
		  }
		| null
		| undefined,
): CreditComplexityMetrics["codebase"] {
	if (!codebase) return undefined;
	const sourceBytes =
		codebase.sourceBytes !== undefined
			? nonNegativeFinite(codebase.sourceBytes)
			: codebase.contentSize !== undefined
				? nonNegativeFinite(codebase.contentSize)
				: undefined;
	const fileCount =
		codebase.fileCount !== undefined
			? nonNegativeFinite(codebase.fileCount)
			: undefined;
	const languageCount =
		codebase.languageCount !== undefined
			? nonNegativeFinite(codebase.languageCount)
			: undefined;
	const dependencyCount =
		codebase.dependencyCount !== undefined
			? nonNegativeFinite(codebase.dependencyCount)
			: undefined;
	const relationshipCount =
		codebase.relationshipCount !== undefined
			? nonNegativeFinite(codebase.relationshipCount)
			: undefined;

	const result: NonNullable<CreditComplexityMetrics["codebase"]> = {
		...(fileCount !== undefined ? { fileCount } : {}),
		...(sourceBytes !== undefined ? { sourceBytes } : {}),
		...(languageCount !== undefined ? { languageCount } : {}),
		...(dependencyCount !== undefined ? { dependencyCount } : {}),
		...(relationshipCount !== undefined ? { relationshipCount } : {}),
	};
	return Object.keys(result).length > 0 ? result : undefined;
}

export interface BuildPrdMetricsInput {
	prompt?: string;
	promptChars?: number;
	hasCodebaseContext?: boolean;
	codebase?: {
		sourceBytes?: number;
		contentSize?: number;
		fileCount?: number;
		languageCount?: number;
		dependencyCount?: number;
		relationshipCount?: number;
	} | null;
	project?: CreditComplexityMetrics["project"];
}

export function buildPrdMetrics(
	input: BuildPrdMetricsInput,
): CreditComplexityMetrics {
	const promptChars =
		input.promptChars !== undefined
			? nonNegativeFinite(input.promptChars)
			: input.prompt
				? input.prompt.length
				: 0;
	const codebase = normalizeCodebaseMetrics(input.codebase);
	return {
		promptChars,
		hasCodebaseContext: Boolean(input.hasCodebaseContext),
		...(codebase ? { codebase } : {}),
		...(input.project ? { project: input.project } : {}),
	};
}

export interface BuildAcMetricsInput {
	prdSource?: string;
	prdSourceChars?: number;
	hasCodebaseContext?: boolean;
	codebase?: {
		sourceBytes?: number;
		contentSize?: number;
		fileCount?: number;
		languageCount?: number;
		dependencyCount?: number;
		relationshipCount?: number;
	} | null;
	project?: CreditComplexityMetrics["project"];
}

export function buildAcMetrics(
	input: BuildAcMetricsInput,
): CreditComplexityMetrics {
	const prdSourceChars =
		input.prdSourceChars !== undefined
			? nonNegativeFinite(input.prdSourceChars)
			: input.prdSource
				? input.prdSource.length
				: 0;
	const codebase = normalizeCodebaseMetrics(input.codebase);
	return {
		prdSourceChars,
		hasCodebaseContext: Boolean(input.hasCodebaseContext),
		...(codebase ? { codebase } : {}),
		...(input.project ? { project: input.project } : {}),
	};
}

export interface BuildTaskMetricsInput {
	prdSource?: string;
	prdSourceChars?: number;
	taskCount?: number;
	hasCodebaseContext?: boolean;
	codebase?: {
		sourceBytes?: number;
		contentSize?: number;
		fileCount?: number;
		languageCount?: number;
		dependencyCount?: number;
		relationshipCount?: number;
	} | null;
	project?: CreditComplexityMetrics["project"];
}

export function buildTaskMetrics(
	input: BuildTaskMetricsInput,
): CreditComplexityMetrics {
	const prdSourceChars =
		input.prdSourceChars !== undefined
			? nonNegativeFinite(input.prdSourceChars)
			: input.prdSource
				? input.prdSource.length
				: 0;
	const taskCount =
		input.taskCount !== undefined
			? nonNegativeFinite(input.taskCount)
			: undefined;
	const codebase = normalizeCodebaseMetrics(input.codebase);
	return {
		prdSourceChars,
		...(taskCount !== undefined ? { taskCount } : {}),
		hasCodebaseContext: Boolean(input.hasCodebaseContext),
		...(codebase ? { codebase } : {}),
		...(input.project ? { project: input.project } : {}),
	};
}

export function formatInsufficientCreditsError(input: {
	quote: CreditQuote;
	availableCredits: number;
	stageLabel: string;
}) {
	return {
		error: `Kredit kamu tidak mencukupi untuk ${input.stageLabel}. Dibutuhkan maksimal ${input.quote.maximumCredits} kredit, saldo tersedia: ${input.availableCredits} kredit.`,
		code: "NO_CREDITS" as const,
		quote: input.quote,
		requiredCredits: input.quote.maximumCredits,
		availableCredits: input.availableCredits,
		topUpInstructions:
			"Silakan top up kredit atau upgrade paket Anda melalui menu Billing.",
	};
}

export function formatSubscriptionPausedError(input: {
	quote: CreditQuote;
	availableCredits: number;
	stageLabel: string;
}) {
	return {
		error: `Masa aktif langgananmu sudah habis. Perpanjang di halaman Pricing untuk ${input.stageLabel}.`,
		code: "SUBSCRIPTION_PAUSED" as const,
		quote: input.quote,
		requiredCredits: input.quote.maximumCredits,
		availableCredits: input.availableCredits,
		topUpInstructions: "Perpanjang paket langganan Anda melalui menu Billing.",
	};
}
