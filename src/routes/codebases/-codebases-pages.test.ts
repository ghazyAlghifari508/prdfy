import { describe, expect, it } from "vitest";
import type { CodebaseAnalysis } from "@/lib/codebase-analysis";
import { isValidHistoryUrl } from "@/lib/flow-progress";
import {
	canRenderCodebaseReview,
	decideCodebaseDetailEntry,
	getCodebaseSessionRequestBody,
} from "./$id";

describe("decideCodebaseDetailEntry", () => {
	it("allows a present codebase id", () => {
		expect(decideCodebaseDetailEntry("c1")).toBe("allow");
	});

	it("denies a missing id", () => {
		expect(decideCodebaseDetailEntry(undefined)).toBe("deny");
		expect(decideCodebaseDetailEntry("")).toBe("deny");
	});
});

describe("history url validation after the route change", () => {
	const id = "11111111-1111-1111-1111-111111111111";

	it("still accepts project routes", () => {
		expect(isValidHistoryUrl(`/prd/${id}`, id)).toBe(true);
		expect(isValidHistoryUrl(`/task/${id}`, id)).toBe(true);
	});

	it("rejects the removed singular codebase route", () => {
		expect(isValidHistoryUrl(`/codebase/${id}`, id)).toBe(false);
	});

	it("accepts the new codebases list route", () => {
		expect(isValidHistoryUrl("/codebases", id)).toBe(true);
	});
});

describe("codebase session request actions", () => {
	it("uses an explicit retry action for every retry request", () => {
		expect(getCodebaseSessionRequestBody("retry")).toEqual({
			action: "retry",
		});
	});

	it("keeps initial session creation as an empty request body", () => {
		expect(getCodebaseSessionRequestBody("initial")).toEqual({});
	});
});

describe("codebase review snapshot pairing", () => {
	const output = {
		projectId: "project-1",
		snapshotId: "snapshot-1",
	} satisfies CodebaseAnalysis;
	const analysis = {
		snapshotId: "snapshot-1",
		output,
	};

	it("waits for a usable status snapshot before allowing review", () => {
		expect(canRenderCodebaseReview(analysis, null)).toBe(false);
		expect(
			canRenderCodebaseReview(analysis, {
				status: "waiting_for_cli",
				snapshotId: "snapshot-1",
			}),
		).toBe(false);
	});

	it("requires the analysis and status to refer to the same snapshot", () => {
		expect(
			canRenderCodebaseReview(analysis, {
				status: "uploaded",
				snapshotId: "snapshot-2",
			}),
		).toBe(false);
		expect(
			canRenderCodebaseReview(analysis, {
				status: "uploaded",
				snapshotId: "snapshot-1",
			}),
		).toBe(true);
	});
});
