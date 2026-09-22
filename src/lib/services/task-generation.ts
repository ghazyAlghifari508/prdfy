/**
 * Task generation orchestration: prompt composition + coverage repair loop.
 *
 * Kept separate from the SSE route so the guarantee "a task tree is only saved
 * when every authoritative Acceptance Criterion is covered" is unit-testable
 * without an HTTP client or a live model.
 */
import type { AcCoverageReport } from "@/lib/ac-coverage";
import { getLanguageDirective, type OutputLanguage } from "@/lib/language";
import { depthDirective } from "@/lib/prompt-depth";
import {
	buildTaskRepairPrompt,
	TASK_GENERATION_PROMPT,
} from "@/lib/prompts-task";
import {
	evaluateTaskCoverage,
	type TaskTree,
} from "@/lib/services/task-service";
import { buildTaskPrdContext } from "@/lib/task-context";

export interface TaskPromptInput {
	acMarkdown: string;
	prdContent: string;
	/** Context7-grounded external facts, already framed. "" when unavailable. */
	grounded: string;
	/** Existing-codebase context block, already framed. "" for greenfield. */
	codebaseBlock: string;
	language: OutputLanguage;
}

/** Maximum repair rounds. One is the intended path; the second absorbs a
 *  partially-useful repair answer without allowing an unbounded retry loop. */
export const MAX_TASK_COVERAGE_REPAIR_ATTEMPTS = 2;

/**
 * Compose the Task system prompt.
 *
 * PRD and AC are both present because they carry different information: the
 * PRD supplies product/architecture/data context, the AC supplies the
 * definition of correct behavior. The AC is the authority for scope and for
 * requirement identifiers, so it is stated last and explicitly.
 */
export function buildTaskSystemPrompt(input: TaskPromptInput): string {
	const parts = [
		TASK_GENERATION_PROMPT,
		depthDirective("task"),
		getLanguageDirective(input.language, "task"),
		input.grounded,
		input.codebaseBlock,
	];
	const prdBlock = buildTaskPrdContext(input.prdContent);
	if (prdBlock) parts.push(`\n\n${prdBlock}`);
	parts.push(
		`\n\n--- ACCEPTANCE CRITERIA (AUTHORITATIVE SCOPE + IDs) ---\n${input.acMarkdown}`,
	);
	return parts.filter((part) => part.trim()).join("\n");
}

export const TASK_FIRST_PASS_USER_MESSAGE =
	'Generate the task tree JSON based on the PRD and Acceptance Criteria above. Every AC id must appear in a task\'s "covers" array.';

export interface CoverageRepairInput {
	acMarkdown: string;
	/** Tree from the first generation pass. */
	initialTree: TaskTree;
	/**
	 * Ask the model for additional tasks covering exactly `missing`.
	 * Returns the raw model text, or "" when nothing usable came back.
	 */
	requestRepair: (missing: string[]) => Promise<string>;
	/** Parse raw model text into a tree; returns null when unusable. */
	parse: (raw: string) => TaskTree | null;
	/** Maximum repair rounds. */
	maxAttempts: number;
	/** Called before each repair round so the UI can report progress. */
	onRepair?: (attempt: number, missing: string[]) => void;
	/** Stops the loop when the request is cancelled. */
	isAborted?: () => boolean;
}

export type CoverageRepairResult =
	| { ok: true; tree: TaskTree; report: AcCoverageReport; repairRounds: number }
	| { ok: false; report: AcCoverageReport; repairRounds: number };

/**
 * Close coverage gaps with bounded, deterministic repair.
 *
 * The tree is returned as valid only when nothing is missing and no task
 * references a non-existent requirement. Each round asks for the missing ids
 * only and merges the answer without duplicating tasks; a round that adds
 * nothing new ends the loop early, because repeating it cannot help.
 */
export async function repairTaskCoverage(
	input: CoverageRepairInput,
): Promise<CoverageRepairResult> {
	const evaluate = (tree: TaskTree) =>
		evaluateTaskCoverage(tree, input.acMarkdown);

	let tree = input.initialTree;
	let report = evaluate(tree);
	let repairRounds = 0;

	while (
		!report.complete &&
		repairRounds < input.maxAttempts &&
		!input.isAborted?.()
	) {
		// Unknown references cannot be repaired by adding work: the model
		// pointed at a requirement that does not exist. Drop nothing, but stop
		// asking for more when there is nothing missing to fetch.
		if (report.missing.length === 0) break;

		repairRounds++;
		input.onRepair?.(repairRounds, report.missing);

		const raw = await input.requestRepair(report.missing);
		if (input.isAborted?.()) break;
		const repairTree = raw ? input.parse(raw) : null;
		if (!repairTree) break;

		const merged = mergeRepair(tree, repairTree);
		if (merged.addedCount === 0) break;

		tree = merged.tree;
		report = evaluate(tree);
	}

	return report.complete
		? { ok: true, tree, report, repairRounds }
		: { ok: false, report, repairRounds };
}

/**
 * Fold repair tasks into the tree without duplicating existing work. Coverage
 * is unioned onto an existing task when the repair repeats a task name inside
 * the same feature, so no declared requirement is dropped.
 */
function mergeRepair(
	original: TaskTree,
	repair: TaskTree,
): { tree: TaskTree; addedCount: number } {
	const normalize = (value: string) => value.trim().toLowerCase();
	const tree: TaskTree = {
		features: original.features.map((feature) => ({
			name: feature.name,
			tasks: feature.tasks.map((task) => ({
				name: task.name,
				description: task.description,
				covers: [...task.covers],
				subtasks: task.subtasks.map((subtask) => ({
					name: subtask.name,
					description: subtask.description,
					details: [...subtask.details],
				})),
			})),
		})),
	};

	const featureIndex = new Map<string, number>();
	tree.features.forEach((feature, index) => {
		featureIndex.set(normalize(feature.name), index);
	});

	let addedCount = 0;

	for (const incomingFeature of repair.features) {
		let index = featureIndex.get(normalize(incomingFeature.name));
		if (index === undefined) {
			index = tree.features.length;
			featureIndex.set(normalize(incomingFeature.name), index);
			tree.features.push({ name: incomingFeature.name, tasks: [] });
		}
		const feature = tree.features[index];

		for (const incomingTask of incomingFeature.tasks) {
			const existing = feature.tasks.find(
				(task) => normalize(task.name) === normalize(incomingTask.name),
			);
			if (existing) {
				for (const id of incomingTask.covers) {
					if (!existing.covers.includes(id)) existing.covers.push(id);
				}
				continue;
			}
			addedCount++;
			feature.tasks.push({
				name: incomingTask.name,
				description: incomingTask.description,
				covers: [...incomingTask.covers],
				subtasks: incomingTask.subtasks.map((subtask) => ({
					name: subtask.name,
					description: subtask.description,
					details: [...subtask.details],
				})),
			});
		}
	}

	// Drop groups that ended up empty so the persisted tree stays clean.
	tree.features = tree.features.filter((feature) => feature.tasks.length > 0);

	return { tree, addedCount };
}

export function buildTaskRepairUserMessage(missing: string[]): string {
	return buildTaskRepairPrompt(missing);
}
