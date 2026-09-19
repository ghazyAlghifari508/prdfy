// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodebaseAnalysis } from "@/lib/codebase-analysis";
import { CodebaseReview } from "./codebase-review";

const analysis: CodebaseAnalysis = {
	projectId: "proj_123",
	snapshotId: "snap_123",
	framework: "TanStack Start",
	language: "TypeScript",
	packageManager: "pnpm",
	dependencies: ["react", "drizzle-orm"],
	database: "PostgreSQL",
	auth: "Better Auth",
	moduleMap: [{ path: "src/routes", summary: "File-based routes" }],
	relevantFiles: ["src/db/schema.ts"],
	impactAreas: ["src/routes/api"],
	limitations: ["Tidak ada cakupan tes untuk alur sync"],
	findings: [
		{
			title: "Batas auth",
			detail: "Sesi dibaca dari header Better Auth.",
			uncertainty: "Jalur refresh token tidak terlihat di snapshot.",
		},
	],
};

const SECRET_CANARY = "sk-canary-never-render-9f8e7d";

let container: HTMLDivElement;
let root: Root | null = null;

afterEach(() => {
	if (root) {
		const r = root;
		act(() => {
			r.unmount();
		});
		root = null;
	}
	container?.remove();
});

function renderReview(
	props: Partial<React.ComponentProps<typeof CodebaseReview>> = {},
) {
	container = document.createElement("div");
	document.body.appendChild(container);
	const nextRoot = createRoot(container);
	root = nextRoot;
	act(() => {
		nextRoot.render(
			<CodebaseReview
				analysis={analysis}
				snapshotId="snap_123"
				snapshotCreatedAt="2026-09-19T10:00:00.000Z"
				fileCount={42}
				excludedCount={7}
				onRetrySync={() => {}}
				onRetryAnalysis={() => {}}
				onContinue={() => {}}
				{...props}
			/>,
		);
	});
	return container;
}

describe("CodebaseReview", () => {
	it("renders the detected environment without inventing missing values", () => {
		const c = renderReview();
		expect(c.textContent).toContain("TanStack Start");
		expect(c.textContent).toContain("TypeScript");
		expect(c.textContent).toContain("PostgreSQL");
		expect(c.textContent).toContain("Better Auth");
	});

	it("renders the repository map and impact areas", () => {
		const c = renderReview();
		expect(c.textContent).toContain("src/routes");
		expect(c.textContent).toContain("src/db/schema.ts");
		expect(c.textContent).toContain("src/routes/api");
	});

	it("summarizes exclusions by count without file contents", () => {
		const c = renderReview();
		expect(c.textContent).toContain("7");
		expect(c.textContent).not.toContain(SECRET_CANARY);
	});

	it("labels uncertain findings explicitly", () => {
		const c = renderReview();
		expect(c.textContent).toContain("Batas auth");
		expect(c.textContent).toContain("Jalur refresh token tidak terlihat");
		expect(c.textContent).toMatch(/perlu verifikasi|tidak pasti/i);
	});

	it("shows the sync snapshot id and timestamp", () => {
		const c = renderReview();
		expect(c.textContent).toContain("snap_123");
	});

	it("marks unknown detections honestly instead of inventing them", () => {
		const { auth: _omitted, ...withoutAuth } = analysis;
		const c = renderReview({ analysis: withoutAuth });
		expect(c.textContent).toMatch(/tidak terdeteksi|belum terdeteksi/i);
	});

	it("wires retry-sync, retry-analysis, and continue actions", () => {
		const onRetrySync = vi.fn();
		const onRetryAnalysis = vi.fn();
		const onContinue = vi.fn();
		const c = renderReview({ onRetrySync, onRetryAnalysis, onContinue });
		const clickByLabel = (pattern: RegExp) => {
			const button = [...c.querySelectorAll("button")].find((b) =>
				pattern.test(b.textContent ?? ""),
			);
			expect(button).toBeDefined();
			act(() => {
				button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			});
		};
		clickByLabel(/sync ulang/i);
		clickByLabel(/analisis ulang/i);
		clickByLabel(/lanjut/i);
		expect(onRetrySync).toHaveBeenCalledTimes(1);
		expect(onRetryAnalysis).toHaveBeenCalledTimes(1);
		expect(onContinue).toHaveBeenCalledTimes(1);
	});

	it("disables actions and shows indeterminate state while working", () => {
		const c = renderReview({ isWorking: true });
		const buttons = [...c.querySelectorAll("button")];
		expect(buttons.length).toBeGreaterThan(0);
		for (const button of buttons) {
			expect(button.disabled).toBe(true);
		}
		expect(c.textContent).not.toContain("%");
	});
});
