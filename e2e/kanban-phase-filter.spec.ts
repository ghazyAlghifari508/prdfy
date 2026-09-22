import crypto from "node:crypto";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

loadEnv({ path: [".env.local", ".env"] });

const SESSION_TOKEN = process.env.QA_SESSION_TOKEN ?? "";
const PROJECT_ID = process.env.QA_PROJECT_ID ?? "";

// Needs a signed session and a project that owns generated tasks; skipped
// otherwise so a plain `playwright test` run stays green without local env.
test.skip(
	!SESSION_TOKEN || !PROJECT_ID,
	"QA_SESSION_TOKEN and QA_PROJECT_ID are required",
);

test("kanban phase filter has no Reset control", async ({ context, page }) => {
	const url = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000");
	const sig = crypto
		.createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "")
		.update(SESSION_TOKEN)
		.digest("base64");
	await context.addCookies([
		{
			name: "better-auth.session_token",
			value: `${SESSION_TOKEN}.${sig}`,
			domain: url.hostname,
			path: "/",
			httpOnly: true,
			sameSite: "Lax",
		},
	]);

	await page.goto(`/kanban/${PROJECT_ID}`, { waitUntil: "networkidle" });

	const errors: string[] = [];
	page.on("console", (m) => {
		if (m.type() === "error") errors.push(m.text());
	});

	// The phase filter trigger is present.
	const trigger = page.getByRole("button", {
		name: "Filter berdasarkan fase project",
	});
	await expect(trigger).toBeVisible();

	// Selecting a phase must NOT render a Reset control.
	const beforeLabel = (await trigger.textContent())?.trim();
	await trigger.click();
	const options = page.getByRole("menuitem");
	const optionCount = await options.count();
	expect(optionCount).toBeGreaterThan(1);
	await options.nth(1).click();
	await page.waitForTimeout(400);

	const afterLabel = (await trigger.textContent())?.trim();
	expect(afterLabel).not.toBe(beforeLabel);
	await expect(page.getByText("Reset", { exact: true })).toHaveCount(0);
	// Visual evidence for the state where the Reset control used to appear.
	await page.screenshot({
		path: "test-results/kanban-phase-selected.png",
		fullPage: true,
	});

	// Clearing the filter is still reachable through the "Semua" option.
	await trigger.click();
	await page.getByRole("menuitem", { name: "Semua" }).click();
	await page.waitForTimeout(400);
	expect((await trigger.textContent())?.trim()).toBe("Semua");
	await expect(page.getByText("Reset", { exact: true })).toHaveCount(0);

	await page.screenshot({
		path: "test-results/kanban-no-reset.png",
		fullPage: true,
	});
	expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
});
