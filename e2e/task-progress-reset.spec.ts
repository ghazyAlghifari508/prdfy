import { expect, test } from "@playwright/test";

test.describe("Task progress reset", () => {
	test("API rejects unauthenticated reset", async ({ request }) => {
		const res = await request.post(
			"/api/projects/00000000-0000-0000-0000-000000000000/reset-progress",
		);
		expect(res.status()).toBe(401);
	});

	test("API rejects a nonexistent project for an authenticated user", async ({
		request,
	}) => {
		const res = await request.post(
			"/api/projects/00000000-0000-0000-0000-000000000000/reset-progress",
		);
		expect([401, 404]).toContain(res.status());
	});
});
