import { describe, expect, it } from "vitest";
import { hasFullWorkflow } from "@/lib/credits";

function decideWorkflowRouteAccess(plan: "free" | "pro" | "hengker"): {
	allow: boolean;
	redirectTo?: string;
} {
	if (!hasFullWorkflow(plan)) {
		return { allow: false, redirectTo: "/prd/$id" };
	}
	return { allow: true };
}

describe("decideWorkflowRouteAccess", () => {
	it("blocks free users and redirects to PRD", () => {
		expect(decideWorkflowRouteAccess("free")).toEqual({
			allow: false,
			redirectTo: "/prd/$id",
		});
	});

	it("allows pro and hengker users", () => {
		expect(decideWorkflowRouteAccess("pro")).toEqual({ allow: true });
		expect(decideWorkflowRouteAccess("hengker")).toEqual({ allow: true });
	});
});
