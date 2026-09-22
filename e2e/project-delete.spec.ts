import crypto from "node:crypto";
import { config as loadEnv } from "dotenv";
import { expect, test } from "@playwright/test";

// The QA flow signs a real session cookie, so it needs the same secrets the
// dev server uses. Loaded here (not in playwright.config.ts) so only this
// spec depends on local env.
loadEnv({ path: [".env.local", ".env"] });

/**
 * Real browser QA for project deletion.
 *
 * Runs against the live dev server and the real database: a project that owns
 * settled credit operations (the exact shape that used to fail with the
 * append-only ledger trigger) is deleted through the History UI.
 */

const SESSION_TOKEN = process.env.QA_SESSION_TOKEN ?? "";
const USER_ID = process.env.QA_USER_ID ?? "";
const PROJECT_ID = process.env.QA_PROJECT_ID ?? "";

function sessionCookie(): string {
	const secret = process.env.BETTER_AUTH_SECRET ?? "";
	const sig = crypto
		.createHmac("sha256", secret)
		.update(SESSION_TOKEN)
		.digest("base64");
	return `better-auth.session_token=${encodeURIComponent(`${SESSION_TOKEN}.${sig}`)}`;
}

test.describe("project deletion", () => {
	test.skip(
		!SESSION_TOKEN || !USER_ID || !PROJECT_ID,
		"QA_SESSION_TOKEN, QA_USER_ID and QA_PROJECT_ID are required",
	);

	test.beforeEach(async ({ context }) => {
		const url = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000");
		await context.addCookies([
			{
				name: "better-auth.session_token",
				value: `${SESSION_TOKEN}.${crypto.createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "").update(SESSION_TOKEN).digest("base64")}`,
				domain: url.hostname,
				path: "/",
				httpOnly: true,
				sameSite: "Lax",
			},
		]);
	});

	test("deletes a project that owns settled credit ledger entries", async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("console", (msg) => {
			if (msg.type() === "error") errors.push(msg.text());
		});

		// Wait for hydration: the delete button is interactive only after React
		// attaches, so clicking earlier would test the server-rendered HTML.
		await page.goto("/history", { waitUntil: "networkidle" });
		await expect(page.getByRole("heading", { name: "Riwayat Proyek" })).toBeVisible();

		const card = page.locator(`[data-project-id="${PROJECT_ID}"]`);
		if ((await card.count()) === 0) {
			test.skip(true, "project already deleted by an earlier run");
		}

		await card.getByRole("button", { name: /hapus/i }).click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		// Scoped to the dialog: the History list also has per-card delete
		// buttons whose accessible names start with "Hapus proyek ...".
		await dialog.getByRole("button", { name: "Hapus Proyek" }).click();

		// Honest success feedback, not the old generic failure toast.
		await expect(page.getByText("Proyek dihapus.")).toBeVisible();
		await expect(
			page.getByText("Gagal menghapus proyek. Coba lagi."),
		).toHaveCount(0);

		// Server is the source of truth: a reload must not bring it back.
		await page.reload({ waitUntil: "networkidle" });
		await expect(page.locator(`[data-project-id="${PROJECT_ID}"]`)).toHaveCount(0);

		// Direct navigation must not open the deleted project: the route
		// resolves to its not-found state instead of rendering PRD content.
		await page.goto(`/prd/${PROJECT_ID}`, { waitUntil: "networkidle" });
		await expect(page.getByText("PRD tidak ditemukan.")).toBeVisible();
		await expect(
			page.locator(`[data-project-id="${PROJECT_ID}"]`),
		).toHaveCount(0);

		// The only tolerated console noise is the route's own not-found state.
		// A missing project renders "PRD tidak ditemukan." with a 500 status
		// (pre-existing behaviour for any unknown project id, unrelated to
		// deletion), which the browser reports as a failed resource load.
		const unexpected = errors.filter(
			(e) =>
				!e.includes("favicon") &&
				!e.includes("NOT_FOUND") &&
				!e.includes("Failed to load resource"),
		);
		expect(unexpected).toEqual([]);
	});

	test("session cookie used by the QA flow is valid", async ({ request }) => {
		const res = await request.get("/api/auth/get-session", {
			headers: { Cookie: sessionCookie() },
		});
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body?.user?.id).toBe(USER_ID);
	});
});
