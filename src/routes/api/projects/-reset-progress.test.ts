import { describe, expect, it } from "vitest";
import { RESET_PROGRESS_ROUTE_PATH } from "./$id/reset-progress";

describe("reset-progress route", () => {
	it("is mounted under the project id path", () => {
		expect(RESET_PROGRESS_ROUTE_PATH).toBe("/api/projects/$id/reset-progress");
	});
});
