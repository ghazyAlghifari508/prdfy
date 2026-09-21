// ponytail: pure step<->route mapping, no client deps. Lives outside the
// "use client" flow-step-nav.tsx so tests + server code can import it without
// dragging next/navigation (→ Buffer) into their graph.

import { stepRank } from "@/lib/flow-progress";

export type FlowStep = "question" | "prd" | "ac" | "task";

export function routeToStep(pathname: string): FlowStep {
	if (pathname.startsWith("/ask/") || pathname === "/ask") return "question";
	if (pathname.startsWith("/ac/") || pathname === "/ac") return "ac";
	if (pathname.startsWith("/task/") || pathname === "/task") return "task";
	if (pathname.startsWith("/kanban/") || pathname === "/kanban") return "task";
	return "prd";
}

export interface FlowStepCta {
	kind: "generate" | "navigate";
	label: string;
	targetStep: FlowStep;
}

/**
 * Derives state-aware CTA for the workspace navbar.
 * Prevents misleading "Generate AC" or "Generate Task" actions when the project
 * has already progressed past that stage (e.g. user opening /prd via browser history).
 */
export function getFlowStepCta(
	currentRouteStep: FlowStep,
	projectStep: string | null | undefined,
	hasPrd?: boolean,
): FlowStepCta | null {
	const dbRank = stepRank(projectStep as FlowStep);

	if (currentRouteStep === "question") {
		if (dbRank >= stepRank("task")) {
			return {
				kind: "navigate",
				label: "Kembali ke Task",
				targetStep: "task",
			};
		}
		if (dbRank >= stepRank("ac")) {
			return {
				kind: "navigate",
				label: "Kembali ke AC",
				targetStep: "ac",
			};
		}
		if (hasPrd) {
			return {
				kind: "navigate",
				label: "Kembali ke PRD",
				targetStep: "prd",
			};
		}
		return {
			kind: "generate",
			label: "Generate PRD",
			targetStep: "prd",
		};
	}

	if (currentRouteStep === "prd") {
		if (dbRank >= stepRank("task")) {
			return {
				kind: "navigate",
				label: "Kembali ke Task",
				targetStep: "task",
			};
		}
		if (dbRank >= stepRank("ac")) {
			return {
				kind: "navigate",
				label: "Lanjut ke AC",
				targetStep: "ac",
			};
		}
		return {
			kind: "generate",
			label: "Generate AC",
			targetStep: "ac",
		};
	}

	if (currentRouteStep === "ac") {
		if (dbRank >= stepRank("task")) {
			return {
				kind: "navigate",
				label: "Kembali ke Task",
				targetStep: "task",
			};
		}
		return {
			kind: "generate",
			label: "Generate Task",
			targetStep: "task",
		};
	}

	return null;
}

// Map a project's persisted DB step to the route that resumes its furthest
// progress. Used by History cards. /prd is the safe landing for null/legacy
// steps - the PRD chat regenerates or restores from prdVersions.
// The id is encoded as an opaque path segment: a value containing / ? # %
// (e.g. from imported history data) must never escape its segment.
export function stepToRoute(
	step: string | null | undefined,
	projectId: string,
): string {
	const id = encodeURIComponent(projectId);
	switch (step) {
		case "question":
			return `/ask/${id}`;
		case "ac":
			return `/ac/${id}`;
		case "task":
			return `/task/${id}`;
		default:
			return `/prd/${id}`;
	}
}
