import type {
	CodebaseAnalysis,
	CodebaseAnalysisFinding,
} from "./codebase-analysis";
import type { SnapshotContext } from "./codebase-sync";

// === Generation context ===
// Snapshot identity is linked to generated output through this
// project-owned context record instead of changing existing AC/task version
// semantics. Every stage (Ask, PRD, AC, Task) receives the same six sections:
// feature request, user answers, codebase analysis, relevant module/file
// paths, known constraints, and the source snapshot identifier.

export interface GenerationContextInput {
	featurePrompt: string;
	userAnswers?: string[];
	analysis: CodebaseAnalysis;
	snapshot: SnapshotContext;
}

export interface SnapshotGenerationContext {
	projectId: string;
	snapshotId: string;
	analysisId?: string;
	featurePrompt: string;
	userAnswers: string[];
	relevantPaths: string[];
	constraints: string[];
	uncertainFindings: CodebaseAnalysisFinding[];
}

export function buildGenerationContext(
	input: GenerationContextInput,
): SnapshotGenerationContext {
	const { featurePrompt, userAnswers = [], analysis, snapshot } = input;
	const relevantPaths = [
		...(analysis.relevantFiles ?? []),
		...(analysis.moduleMap?.map((entry) => entry.path) ?? []),
		...(snapshot.relevantPaths ?? []),
	];
	const constraints = [...(analysis.limitations ?? [])];
	const uncertainFindings = (analysis.findings ?? []).filter(
		(finding) => finding.uncertainty && finding.uncertainty.length > 0,
	);
	return {
		projectId: snapshot.projectId,
		snapshotId: snapshot.snapshotId,
		featurePrompt,
		userAnswers,
		relevantPaths: [...new Set(relevantPaths)],
		constraints,
		uncertainFindings,
	};
}

export function formatGenerationContext(
	context: SnapshotGenerationContext,
): string {
	const lines = [
		`Feature request: ${context.featurePrompt}`,
		`User answers: ${context.userAnswers.length > 0 ? context.userAnswers.join(" | ") : "-"}`,
		`Relevant modules/files: ${context.relevantPaths.length > 0 ? context.relevantPaths.join(", ") : "-"}`,
		`Known constraints: ${context.constraints.length > 0 ? context.constraints.join(" | ") : "-"}`,
		...context.uncertainFindings.map(
			(finding) =>
				`Assumption to verify [${finding.title}]: ${finding.uncertainty}`,
		),
		`Source snapshot: ${context.snapshotId}`,
	];
	return lines.join("\n");
}
