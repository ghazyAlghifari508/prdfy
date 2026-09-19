/**
 * Flow-step progression + generation-completeness rules.
 *
 * projects.step must reflect the FURTHEST stage a project actually reached.
 * Before this, every writer set step unconditionally, so re-generating AC after
 * Task was done rewound step 'task' -> 'ac' and History sent the user back to
 * the AC page. Step is now monotonic: it only ever moves forward.
 */
import { type FlowStep, stepToRoute } from "@/lib/flow-step";

/** Flow order. Index = progress rank; higher wins. */
const STEP_ORDER: FlowStep[] = ["question", "prd", "ac", "task"];

export function stepRank(step: string | null | undefined): number {
	const i = STEP_ORDER.indexOf(step as FlowStep);
	// ponytail: unknown/null ranks as "prd" (the default landing), matching
	// stepToRoute's fallback so rank and route never disagree.
	return i === -1 ? STEP_ORDER.indexOf("prd") : i;
}

/**
 * True when the project has progressed past the PRD stage (e.g. AC or Task).
 * At this point, PRD content is finalized and locked to prevent downstream
 * desynchronization of AC and tasks.
 */
export function isPrdLocked(step: string | null | undefined): boolean {
	return stepRank(step) > stepRank("prd");
}

/**
 * Furthest of current (DB) and next (what a writer wants to set).
 * Returns null when no write is needed - caller skips the step UPDATE.
 */
export function advanceStep(
	current: string | null | undefined,
	next: FlowStep,
): FlowStep | null {
	return stepRank(next) > stepRank(current) ? next : null;
}

/**
 * True when a streamed generation must NOT be persisted as a new version.
 *
 * A dropped/aborted stream used to be saved anyway, creating a partial version
 * that outranked the complete one (AC v2 = 1440 chars vs v1 = 19818) and became
 * what the viewer showed.
 */
const TRUNCATING_REASONS = new Set(["length", "error", "content-filter"]);

export function isTruncatedGeneration(
	content: string,
	finishReason: string | undefined,
): boolean {
	if (!content || !content.trim()) return true;
	// ponytail: deny-list, not allow-list. undefined/"unknown"/"other" means the provider
	// reported a non-standard finish or completed via custom stop sequence.
	// Only explicit hard failure reasons ("length", "error", "content-filter") discard it.
	return finishReason !== undefined && TRUNCATING_REASONS.has(finishReason);
}

/**
 * True when a URL is a project-internal route for the given project, i.e. a
 * route in the /(ask|prd|ac|task|kanban)/<projectId> namespace. History stores
 * last_url so it can send users back to where they were; this guard makes sure
 * that never lands on an arbitrary path or another project's page (anti-spoof).
 * Rejects non-project routes and `javascript:`/malformed URLs outright.
 */
const HISTORY_URL_RE =
	/^\/(?:ask|prd|ac|task|kanban)\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;

export function isValidHistoryUrl(url: string, projectId: string): boolean {
	const m = HISTORY_URL_RE.exec(url);
	return m !== null && m[1] === projectId;
}

/**
 * URL a History card links to. Prefers last_url when it's a valid
 * project-internal route for this project; falls back to stepToRoute so
 * brand-new projects and cleared/corrupted last_url rows keep working.
 * Lives here (pure module) so the client component can import it without
 * dragging db/pg into the client bundle.
 */
export function resolveHistoryUrl(item: {
	id: string;
	step: string | null | undefined;
	lastUrl: string | null | undefined;
}): string {
	if (item.lastUrl && isValidHistoryUrl(item.lastUrl, item.id)) {
		return item.lastUrl;
	}
	return stepToRoute(item.step, item.id);
}
