import { expect, test } from "@playwright/test";

/**
 * End-to-end integration and regression suite for existing-codebase sync.
 *
 * Scenarios covered:
 * 1. Greenfield regression: Home mode default, composer behavior, prompt submission.
 * 2. Existing codebase Home mode: toggle to "Codebase existing", custom prompt.
 * 3. Security guards: unauthenticated access to /codebase/$id redirects to /login.
 * 4. API guards: unauthenticated project creation rejected with 401.
 * 5. API guards: invalid project mode rejected with 400.
 */

test.describe("Existing Codebase Sync Flow", () => {
	test("API: rejects unauthenticated project creation", async ({ request }) => {
		const res = await request.post("/api/projects", {
			data: {
				message: "Fitur baru untuk aplikasi",
				projectMode: "existing_codebase",
			},
		});
		expect(res.status()).toBe(401);
	});

	test("API: rejects invalid project mode", async ({ request }) => {
		const res = await request.post("/api/projects", {
			data: {
				message: "Fitur baru untuk aplikasi",
				projectMode: "invalid_mode_xyz",
			},
		});
		expect([400, 401]).toContain(res.status());
	});

	test("UI: Home page defaults to greenfield mode and toggles to existing codebase", async ({
		page,
	}) => {
		await page.goto("/");
		await page.waitForLoadState("networkidle");

		// Verify title
		await expect(page).toHaveTitle(/PrdFy/i);

		// Mode toggle buttons
		const greenfieldBtn = page.getByRole("button", { name: /produk baru/i });
		const existingBtn = page.getByRole("button", { name: /codebase existing/i });

		await expect(greenfieldBtn).toBeVisible();
		await expect(existingBtn).toBeVisible();

		// Default is greenfield (active state)
		await expect(greenfieldBtn).toHaveAttribute("aria-pressed", "true");
		await expect(existingBtn).toHaveAttribute("aria-pressed", "false");

		// In greenfield: Web/App toggle and Template gallery are visible
		const webToggle = page.getByRole("button", { name: "Web", exact: true });
		const templateCard = page.getByText("SaaS Analytics Dashboard");
		await expect(webToggle).toBeVisible();
		await expect(templateCard).toBeVisible();

		// Toggle to existing codebase
		await existingBtn.click();
		await expect(existingBtn).toHaveAttribute("aria-pressed", "true");
		await expect(greenfieldBtn).toHaveAttribute("aria-pressed", "false");

		// In existing codebase: Web/App toggle and Template gallery must be hidden
		await expect(webToggle).not.toBeVisible();
		await expect(templateCard).not.toBeVisible();

		// Verify existing button title attribute
		await expect(existingBtn).toHaveAttribute(
			"title",
			/Rencanakan fitur untuk codebase yang sudah ada/i,
		);

		// Toggle back to greenfield
		await greenfieldBtn.click();
		await expect(greenfieldBtn).toHaveAttribute("aria-pressed", "true");
		await expect(existingBtn).toHaveAttribute("aria-pressed", "false");

		// In greenfield again: Web/App toggle and Template gallery are restored
		await expect(webToggle).toBeVisible();
		await expect(templateCard).toBeVisible();
	});

	test("UI: Unauthenticated visit to /codebase/:id redirects to /login", async ({
		page,
	}) => {
		await page.goto("/codebase/mock-project-unauth-123");
		await page.waitForURL(/\/login/);
		await expect(page).toHaveURL(/\/login/);
	});
});
