import { describe, expect, it } from "vitest";
import { CODEBASE_SESSION_ROUTE_PATH } from "./$codebaseId/session";

describe("codebase routes", () => {
	it("exposes the codebase-scoped session path", () => {
		expect(CODEBASE_SESSION_ROUTE_PATH).toBe(
			"/api/codebases/$codebaseId/session",
		);
	});
});
