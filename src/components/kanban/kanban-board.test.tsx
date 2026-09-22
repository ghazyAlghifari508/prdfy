// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "@/store";
import { KanbanBoard } from "./kanban-board";

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({ children, ...rest }: { children: React.ReactNode }) => (
			<a {...rest}>{children}</a>
		),
		useNavigate: () => vi.fn(),
		useRouter: () => ({ invalidate: vi.fn() }),
	};
});

class FakeEventSource {
	onmessage: ((e: { data: string }) => void) | null = null;
	onerror: (() => void) | null = null;
	closed = false;
	constructor(public url: string) {
		setTimeout(() => {
			if (!this.closed && this.onmessage) {
				this.onmessage({ data: JSON.stringify(mockBoardData) });
			}
		}, 0);
	}
	close() {
		this.closed = true;
	}
}

let container: HTMLDivElement;
let root: Root | null = null;

const mockBoardData = {
	columns: {
		pending: [
			{
				id: "task-1",
				type: "task" as const,
				featureName: "Autentikasi",
				name: "Setup Better Auth OAuth",
				description: "Implementasi login Google dan GitHub",
				status: "pending" as const,
				priority: "high",
				dependencies: [],
				startedAt: null,
				completedAt: null,
				subtaskCount: 2,
				subtaskCompleted: 0,
				subtasks: [
					{ name: "Setup Google client", status: "pending" },
					{ name: "Setup GitHub client", status: "pending" },
				],
			},
			{
				id: "task-2",
				type: "task" as const,
				featureName: "Katalog",
				name: "Query list produk",
				description: "Integrasi database Drizzle",
				status: "pending" as const,
				priority: "medium",
				dependencies: [],
				startedAt: null,
				completedAt: null,
				subtaskCount: 1,
				subtaskCompleted: 0,
			},
			{
				id: "task-3",
				type: "task" as const,
				featureName: "Katalog",
				name: "Helper format mata uang",
				description: "Format Rupiah",
				status: "pending" as const,
				priority: "low",
				dependencies: [],
				startedAt: null,
				completedAt: null,
				subtaskCount: 0,
				subtaskCompleted: 0,
			},
		],
		in_progress: [],
		completed: [],
		failed: [],
	},
	staleness: "live",
	lastUpdateAt: new Date().toISOString(),
};

beforeEach(() => {
	vi.stubGlobal("EventSource", FakeEventSource);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({
			ok: true,
			json: async () => mockBoardData,
		})),
	);
	useUIStore.setState({ isProjectDrawerOpen: false });
});

afterEach(() => {
	if (root) {
		const currentRoot = root;
		act(() => {
			currentRoot.unmount();
		});
		root = null;
	}
	container?.remove();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

function renderBoard(
	props: Partial<React.ComponentProps<typeof KanbanBoard>> = {},
) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	const nextRoot = createRoot(container);
	root = nextRoot;
	act(() => {
		nextRoot.render(
			<QueryClientProvider client={queryClient}>
				<KanbanBoard
					projectId="test-proj-123"
					projectName="Test Kanban App"
					latestPrdContent="# PRD Content Test"
					latestAcContent="# AC Content Test"
					{...props}
				/>
			</QueryClientProvider>,
		);
	});
	return container;
}

describe("KanbanBoard", () => {
	it("renders header with title and integrated CLI status metadata", async () => {
		const c = renderBoard();

		await vi.waitFor(() => {
			expect(c.textContent).toContain("Kanban - Test Kanban App");
			expect(c.textContent).toContain(
				"Belum ada update status · Jalankan PrdFy CLI untuk update otomatis",
			);
		});

		// Header contains both title and status within <header>
		const header = c.querySelector("header");
		expect(header).toBeDefined();
		expect(header?.textContent).toContain("Kanban - Test Kanban App");
		expect(header?.textContent).toContain(
			"Belum ada update status · Jalankan PrdFy CLI untuk update otomatis",
		);
	});

	it("renders toolbar with compact phase filter and wide progress track", async () => {
		const c = renderBoard();

		await vi.waitFor(() => {
			expect(c.textContent).toContain("Fase:");
			expect(c.textContent).toContain("task selesai");
		});

		const progressbar = c.querySelector('[role="progressbar"]');
		expect(progressbar).toBeDefined();
		expect(progressbar?.getAttribute("aria-valuenow")).toBe("0"); // 0 of 3 completed
	});

	it("renders task importance indicators (Utama, Penting, Pendukung) with bars", async () => {
		const c = renderBoard();

		await vi.waitFor(() => {
			expect(c.textContent).toContain("Setup Better Auth OAuth");
		});

		expect(c.textContent).toContain("Utama");
		expect(c.textContent).toContain("Penting");
		expect(c.textContent).toContain("Pendukung");

		// Priority indicators should NOT have pill or badge border classes
		const badgeClass = c.querySelector(".rounded-full.border-amber");
		expect(badgeClass).toBeNull();
	});

	it("opens project documents drawer when triggered by UI store (hamburger integration)", async () => {
		const c = renderBoard();

		await vi.waitFor(() => {
			expect(c.textContent).toContain("Test Kanban App");
		});

		// Initially closed
		expect(document.body.textContent).not.toContain("Dokumen Proyek");

		// Simulate hamburger button click from Navbar via useUIStore
		act(() => {
			useUIStore.getState().setProjectDrawerOpen(true);
		});

		expect(document.body.textContent).toContain("Dokumen Proyek");
		expect(document.body.textContent).toContain("Product Requirements (PRD)");
		expect(document.body.textContent).toContain("Acceptance Criteria (AC)");

		// Close drawer
		act(() => {
			useUIStore.getState().setProjectDrawerOpen(false);
		});
	});
});
