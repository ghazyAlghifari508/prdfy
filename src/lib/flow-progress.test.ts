import { describe, expect, it } from "vitest";
import {
	advanceStep,
	isPrdLocked,
	isTruncatedGeneration,
	isValidHistoryUrl,
	resolveHistoryUrl,
	shouldMarkQuestionStep,
	stepRank,
} from "./flow-progress";

describe("stepRank", () => {
	it("ranks the flow in order", () => {
		expect(stepRank("question")).toBeLessThan(stepRank("prd"));
		expect(stepRank("prd")).toBeLessThan(stepRank("ac"));
		expect(stepRank("ac")).toBeLessThan(stepRank("task"));
	});

	it("treats null/unknown as prd, matching stepToRoute's fallback", () => {
		expect(stepRank(null)).toBe(stepRank("prd"));
		expect(stepRank(undefined)).toBe(stepRank("prd"));
		expect(stepRank("bogus")).toBe(stepRank("prd"));
	});
});

describe("isPrdLocked", () => {
	it("returns false for question, prd, and legacy/null steps", () => {
		expect(isPrdLocked("question")).toBe(false);
		expect(isPrdLocked("prd")).toBe(false);
		expect(isPrdLocked(null)).toBe(false);
		expect(isPrdLocked(undefined)).toBe(false);
	});

	it("returns true once project reaches ac or task stages", () => {
		expect(isPrdLocked("ac")).toBe(true);
		expect(isPrdLocked("task")).toBe(true);
	});
});

describe("advanceStep", () => {
	it("moves forward", () => {
		expect(advanceStep("prd", "ac")).toBe("ac");
		expect(advanceStep("ac", "task")).toBe("task");
		expect(advanceStep("question", "task")).toBe("task");
	});

	it("never rewinds - regenerating AC after Task keeps step at task", () => {
		// The reported bug: AC regen at 03:49 rewound step 'task' -> 'ac',
		// so History routed to /ac despite 6 saved tasks.
		expect(advanceStep("task", "ac")).toBeNull();
		expect(advanceStep("task", "prd")).toBeNull();
		expect(advanceStep("ac", "prd")).toBeNull();
	});

	it("returns null when already at that step (no write needed)", () => {
		expect(advanceStep("ac", "ac")).toBeNull();
		expect(advanceStep("task", "task")).toBeNull();
	});

	it("advances from a null/legacy step", () => {
		expect(advanceStep(null, "ac")).toBe("ac");
		expect(advanceStep(null, "prd")).toBeNull();
	});
});

describe("shouldMarkQuestionStep", () => {
	it("marks pre-artifact projects at or before prd", () => {
		expect(shouldMarkQuestionStep("question", false)).toBe(true);
		expect(shouldMarkQuestionStep("prd", false)).toBe(true);
		expect(shouldMarkQuestionStep(null, false)).toBe(true);
	});

	it("never rewinds progressed projects or ones with a PRD", () => {
		expect(shouldMarkQuestionStep("ac", false)).toBe(false);
		expect(shouldMarkQuestionStep("task", false)).toBe(false);
		expect(shouldMarkQuestionStep("prd", true)).toBe(false);
		expect(shouldMarkQuestionStep("question", true)).toBe(false);
	});
});

describe("isTruncatedGeneration", () => {
	it("rejects output cut off by the token cap", () => {
		expect(isTruncatedGeneration("full doc here", "length")).toBe(true);
	});

	it("rejects aborted output", () => {
		expect(isTruncatedGeneration("partial", "error")).toBe(true);
		expect(isTruncatedGeneration("partial", "content-filter")).toBe(true);
	});

	it("accepts a normally finished generation", () => {
		expect(isTruncatedGeneration("complete doc", "stop")).toBe(false);
	});

	it("rejects content-filtered output", () => {
		expect(isTruncatedGeneration("partial", "content-filter")).toBe(true);
	});

	it('accepts a provider-reported "unknown" reason', () => {
		// ponytail: 9router relays reasons the SDK maps to "unknown". Deny-list,
		// not allow-list - an unrecognised reason must not discard a full document.
		expect(isTruncatedGeneration("complete doc", "unknown")).toBe(false);
	});

	it("accepts tool-call termination", () => {
		expect(isTruncatedGeneration("complete doc", "tool-calls")).toBe(false);
	});

	it("accepts when finishReason is unknown but content exists", () => {
		// ponytail: unknown reason is not evidence of truncation - don't discard
		// a generation the user paid for on a missing signal.
		expect(isTruncatedGeneration("complete doc", undefined)).toBe(false);
	});

	it("rejects empty content regardless of reason", () => {
		expect(isTruncatedGeneration("", "stop")).toBe(true);
		expect(isTruncatedGeneration("   ", "stop")).toBe(true);
	});
});

describe("isValidHistoryUrl", () => {
	const id = "fca689ff-e194-45eb-b6fa-0188cc327759";

	it("accepts valid project-internal URLs that belong to this project", () => {
		expect(isValidHistoryUrl(`/codebase/${id}`, id)).toBe(true);
		expect(isValidHistoryUrl(`/prd/${id}`, id)).toBe(true);
		expect(isValidHistoryUrl(`/ac/${id}`, id)).toBe(true);
		expect(isValidHistoryUrl(`/task/${id}`, id)).toBe(true);
		expect(isValidHistoryUrl(`/ask/${id}`, id)).toBe(true);
		expect(isValidHistoryUrl(`/kanban/${id}`, id)).toBe(true);
	});

	it("rejects URLs whose project ID does not match", () => {
		expect(
			isValidHistoryUrl(`/ac/00000000-0000-0000-0000-000000000000`, id),
		).toBe(false);
	});

	it("rejects URLs outside the project namespace", () => {
		expect(isValidHistoryUrl("/history", id)).toBe(false);
		expect(isValidHistoryUrl("/settings", id)).toBe(false);
		expect(isValidHistoryUrl("/pricing", id)).toBe(false);
		expect(isValidHistoryUrl("/", id)).toBe(false);
	});

	it("rejects malformed or empty input", () => {
		expect(isValidHistoryUrl("", id)).toBe(false);
		expect(isValidHistoryUrl("/ac/", id)).toBe(false);
		expect(isValidHistoryUrl("/ac", id)).toBe(false);
		expect(isValidHistoryUrl("javascript:alert(1)", id)).toBe(false);
	});
});

describe("resolveHistoryUrl", () => {
	const id = "fca689ff-e194-45eb-b6fa-0188cc327759";

	it("prefers a valid lastUrl for this project", () => {
		expect(
			resolveHistoryUrl({ id, step: "prd", lastUrl: `/kanban/${id}` }),
		).toBe(`/kanban/${id}`);
	});

	it("falls back to stepToRoute when lastUrl is null", () => {
		expect(resolveHistoryUrl({ id, step: "ac", lastUrl: null })).toBe(
			`/ac/${id}`,
		);
	});

	it("falls back when lastUrl belongs to another project", () => {
		expect(
			resolveHistoryUrl({
				id,
				step: "task",
				lastUrl: "/ac/00000000-0000-0000-0000-000000000000",
			}),
		).toBe(`/task/${id}`);
	});

	it("falls back when lastUrl is non-project or malformed", () => {
		expect(resolveHistoryUrl({ id, step: "prd", lastUrl: "/history" })).toBe(
			`/prd/${id}`,
		);
		expect(
			resolveHistoryUrl({ id, step: "prd", lastUrl: "javascript:alert(1)" }),
		).toBe(`/prd/${id}`);
	});
});
