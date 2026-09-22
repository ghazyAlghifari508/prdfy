/**
 * Prompt context composition for the Task stage.
 *
 * The PRD and the AC answer different questions: the PRD describes the product
 * (flows, requirements, data/domain, architecture, stack, UX expectations,
 * scope), the AC defines when a feature is correct. Task generation needs both.
 *
 * Composition rule: the PRD is injected in full and the AC in full, in clearly
 * labelled blocks that state which document owns which decision. Selecting
 * "non-overlapping" PRD sections was rejected deliberately: the overlap is a
 * single feature-narrative section (~5% of the prompt) while the cost of
 * omitting a section the AC happened not to restate is a silently lost
 * requirement, which is the exact failure this pipeline must not have.
 */

/**
 * Frame the PRD as product context. Returns "" for an empty PRD so the prompt
 * degrades to AC-only instead of carrying an empty frame.
 */
export function buildTaskPrdContext(prdContent: string): string {
	const body = prdContent.trim();
	if (!body) return "";
	return [
		"--- PRD (PRODUCT CONTEXT: behavior, flows, data, architecture, stack, constraints) ---",
		body,
		"--- END PRD ---",
	].join("\n");
}
