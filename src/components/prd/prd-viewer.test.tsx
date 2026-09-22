// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrdViewer } from "./prd-viewer";

// The viewer imports TanStack Router hooks via VersionHistory; stub them so the
// component renders in isolation.
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => () => {},
	Link: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/hooks/use-panel-resize", () => ({
	usePanelResize: () => ({
		leftWidth: 260,
		onStartDragLeft: () => {},
		isDraggingLeft: false,
	}),
}));

let container: HTMLDivElement;
let root: Root | null = null;
let queryClient: QueryClient;

const VERSIONS = [
	{
		id: "v1",
		version: 1,
		content: "## 1. Ringkasan\n\nVersi pertama",
		change_summary: null,
		created_at: "2026-09-01T00:00:00.000Z",
	},
	{
		id: "v2",
		version: 2,
		content: "## 1. Ringkasan\n\nVersi kedua",
		change_summary: "Revisi",
		created_at: "2026-09-02T00:00:00.000Z",
	},
];

beforeEach(() => {
	(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	if (root) {
		const r = root;
		act(() => {
			r.unmount();
		});
		root = null;
	}
	container?.remove();
	document.body.innerHTML = "";
	queryClient.clear();
});

function renderViewer(overrides: Partial<Parameters<typeof PrdViewer>[0]> = {}) {
	act(() => {
		root?.render(
			<QueryClientProvider client={queryClient}>
				<PrdViewer
					content="## 1. Ringkasan\n\nVersi kedua"
					versions={VERSIONS}
					currentVersion={2}
					{...overrides}
				/>
			</QueryClientProvider>,
		);
	});
}

describe("PrdViewer toolbar", () => {
	it("renders the preview/diff switch as a single tablist", () => {
		renderViewer();

		const tablist = container.querySelector('[role="tablist"]');
		expect(tablist).not.toBeNull();

		const tabs = container.querySelectorAll('[role="tab"]');
		expect(tabs).toHaveLength(2);
		expect(tabs[0]?.textContent?.trim()).toBe("Pratinjau");
		expect(tabs[1]?.textContent?.trim()).toBe("Diff");
	});

	it("marks the active tab with aria-selected and switches on click", () => {
		renderViewer();

		const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
		expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
		expect(tabs[1]?.getAttribute("aria-selected")).toBe("false");

		act(() => {
			tabs[1]?.click();
		});

		expect(tabs[0]?.getAttribute("aria-selected")).toBe("false");
		expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
	});

	it("omits the Diff tab when there is only one version", () => {
		renderViewer({ versions: [VERSIONS[0]], currentVersion: 1 });

		const tabs = container.querySelectorAll('[role="tab"]');
		expect(tabs).toHaveLength(1);
		expect(tabs[0]?.textContent?.trim()).toBe("Pratinjau");
	});

	it("no longer offers an Export PDF action", () => {
		renderViewer();

		expect(container.textContent).not.toMatch(/Export PDF/i);
		expect(container.textContent).not.toMatch(/Mengekspor/i);
	});

	it("keeps the preview content rendered", () => {
		renderViewer();
		expect(container.textContent).toContain("Versi kedua");
	});
});

describe("Export PDF removal", () => {
	// Vite rewrites import.meta.url to a `/@fs/` URL, so derive the repo root
	// from process.cwd() (vitest runs at the repo root) instead.
	const repoRoot = `${process.cwd()}/`;

	it("keeps no reference to the PDF export feature anywhere in src", async () => {
		// The feature was removed end to end: route, service, util, constants,
		// dependency, and UI. Guard against a partial reintroduction by scanning
		// the source tree directly, without depending on an external git binary.
		const { readdirSync, readFileSync } = await import("node:fs");
		const { join } = await import("node:path");

		const offenders: string[] = [];
		// Paths are compared with forward slashes so the exclusions hold on
		// Windows and POSIX alike.
		const allowlist = new Set([
			"src/lib/template-gallery.ts",
			"src/app/ask/-ask-restore.test.ts",
			"src/components/prd/prd-viewer.test.tsx",
		]);
		const walk = (dir: string) => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const full = join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(full);
					continue;
				}
				if (!/\.(ts|tsx)$/.test(entry.name)) continue;
				const rel = full
					.slice(repoRoot.length)
					.split(/[\\/]/)
					.join("/");
				// This test names the feature on purpose; the prompt templates are
				// example product ideas a user may pick, not a PrdFy export feature.
				if (allowlist.has(rel)) continue;
				const text = readFileSync(full, "utf8");
				if (/pdf/i.test(text)) offenders.push(rel);
			}
		};
		walk(join(repoRoot, "src"));
		expect(offenders).toEqual([]);
	});

	it("no longer declares the jspdf dependency", async () => {
		const pkg = JSON.parse(
			await readFile(`${repoRoot}package.json`, "utf8"),
		) as { dependencies?: Record<string, string> };
		expect(pkg.dependencies?.jspdf).toBeUndefined();
	});
});
