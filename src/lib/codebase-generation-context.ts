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
	/** Analysis DB record id, filled by the caller loading from storage. */
	analysisId?: string;
}

export interface SnapshotGenerationContext {
	projectId: string;
	snapshotId: string;
	analysisId?: string;
	featurePrompt: string;
	userAnswers: string[];
	analysisSummary: string;
	relevantPaths: string[];
	constraints: string[];
	uncertainFindings: CodebaseAnalysisFinding[];
}

export function buildAnalysisSummary(analysis: CodebaseAnalysis): string {
	const parts: string[] = [];
	if (analysis.framework) parts.push(`framework ${analysis.framework}`);
	if (analysis.language) parts.push(`language ${analysis.language}`);
	if (analysis.packageManager)
		parts.push(`package manager ${analysis.packageManager}`);
	if (analysis.dependencies && analysis.dependencies.length > 0)
		parts.push(`dependencies ${analysis.dependencies.join(", ")}`);
	if (analysis.database) parts.push(`database ${analysis.database}`);
	if (analysis.auth) parts.push(`auth ${analysis.auth}`);
	for (const entry of analysis.moduleMap ?? []) {
		parts.push(`${entry.path} (${entry.summary})`);
	}
	return parts.length > 0 ? parts.join("; ") : "-";
}

export function buildGenerationContext(
	input: GenerationContextInput,
): SnapshotGenerationContext {
	const {
		featurePrompt,
		userAnswers = [],
		analysis,
		snapshot,
		analysisId,
	} = input;
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
		analysisId,
		featurePrompt,
		userAnswers,
		analysisSummary: buildAnalysisSummary(analysis),
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
		`Codebase analysis: ${context.analysisSummary}`,
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
