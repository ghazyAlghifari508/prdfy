import { expect, test } from "@playwright/test";

/**
 * Browser verification for the sync UX rework (temporary harness, deleted
 * after the run).
 *
 * Loads the REAL app document (so Vite injects the `@vitejs/plugin-react`
 * preamble and the app's module graph is live), then mounts the shipped
 * components into a detached container via dynamic import. The DOM inspected
 * is genuine browser rendering of the shipped component code — not jsdom.
 */

async function mountComponents(page: import("@playwright/test").Page) {
	await page.goto("/");
	await page.waitForLoadState("domcontentloaded");
	return page.evaluate(async () => {
		const React = (await import("/@id/react")).default;
		// CJS interop: the namespace is exposed on `default`.
		const { createRoot } = (await import("/@id/react-dom/client")).default;
		const { SyncStatus } = await import(
			"/src/components/codebase/sync-status.tsx"
		);
		const { ScreenConnect } = await import(
			"/src/components/codebase/screen-connect.tsx"
		);

		const statusRoot = document.createElement("div");
		statusRoot.id = "verify-status";
		document.body.appendChild(statusRoot);

		const connectRoot = document.createElement("div");
		connectRoot.id = "verify-connect";
		document.body.appendChild(connectRoot);

		const payload = {
			projectId: "proj_verify_123",
			apiBaseUrl: "https://prdfy.example.com",
			syncToken: "tok_verify",
			cliMinVersion: "2.0.0",
			syncCommand:
				"prdfy codebase sync --project-id proj_verify_123 --sync-token <token>",
			expiresAt: new Date(Date.now() + 60000).toISOString(),
		};

		createRoot(statusRoot).render(
			React.createElement(SyncStatus, {
				projectId: "proj_verify_123",
				projectName: "Wishlist Fitur",
				status: {
					projectId: "proj_verify_123",
					sessionId: "sess_verify_123",
					status: "uploaded",
					fileCount: 12,
					excludedCount: 3,
					snapshotId: "snap_1",
					analysisStatus: "pending",
				},
			}),
		);

		createRoot(connectRoot).render(
			React.createElement(ScreenConnect, {
				projectName: "Wishlist Fitur",
				payload,
				onAgentStarted: () => {},
			}),
		);

		return true;
	});
}

test.describe("sync UX rework — real browser render", () => {
	test("sync status renders three real-signal stages, no fabricated ones", async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (e) => errors.push(e.message));

		await mountComponents(page);
		const status = page.locator("#verify-status");
		await expect(status).toContainText("CLI terhubung", { timeout: 20000 });

		const text = (await status.innerText()) ?? "";
		expect(text).toContain("Snapshot");
		expect(text).toContain("analisis codebase");
		// Real counts straight from the server payload.
		expect(text).toContain("12");
		expect(text).toContain("3");
		// Never the bookkeeping stages the client cannot observe.
		expect(text).not.toMatch(/memindai/i);
		expect(text).not.toMatch(/filtering/i);
		expect(text).not.toMatch(/package manifest dan framework dibaca/i);
		// No fabricated percentage.
		expect(text).not.toContain("%");
		expect(errors).toEqual([]);
	});

	test("connect screen renders the new objective-oriented prompt", async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (e) => errors.push(e.message));

		await mountComponents(page);
		const connect = page.locator("#verify-connect");
		await expect(connect).toContainText("Sinkronkan codebase repositori ini", {
			timeout: 20000,
		});

		const text = (await connect.innerText()) ?? "";
		expect(text).toContain("proj_verify_123");
		expect(text).toContain("prdfy codebase sync --project-id proj_verify_123");
		expect(text).toContain("Wishlist Fitur");
		expect(text).toContain("deteksi root repositori");
		expect(text).toContain(".prdfyignore");
		// Robotic scaffolding, version gate, and hardcoded ignore lists are gone.
		expect(text).not.toMatch(/Langkah \d/);
		expect(text).not.toContain("2.0.0");
		expect(text).not.toContain("node_modules");
		expect(errors).toEqual([]);
	});
});
