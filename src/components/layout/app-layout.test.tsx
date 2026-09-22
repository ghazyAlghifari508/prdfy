// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "./app-layout";

vi.mock("@tanstack/react-router", () => ({
	useLocation: ({ select }: { select?: (l: { pathname: string }) => unknown }) =>
		select ? select({ pathname: "/ask/proj-1" }) : { pathname: "/ask/proj-1" },
	Link: ({ children }: { children: React.ReactNode }) => children,
	useNavigate: () => () => {},
	useMatches: () => [],
	useRouter: () => ({ navigate: () => {} }),
	useRouterState: () => ({ location: { pathname: "/ask/proj-1" } }),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		useSession: () => ({ data: null, isPending: false }),
		signOut: async () => {},
	},
}));

let container: HTMLDivElement;
let root: Root | null = null;
let queryClient: QueryClient;

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

describe("AppLayout workspace scroll ownership", () => {
	it("sizes the workspace shell to the visible viewport, not 100vh", () => {
		act(() => {
			root?.render(
				<QueryClientProvider client={queryClient}>
					<AppLayout>
						<div>konten</div>
					</AppLayout>
				</QueryClientProvider>,
			);
		});

		const shell = container.querySelector<HTMLElement>(
			"[data-workspace-shell]",
		);
		expect(shell).not.toBeNull();

		// 100vh resolves to the LARGE mobile viewport (URL bar collapsed), so a
		// full-height workspace overflows the visible area while body scroll is
		// locked, and the bottom of the content becomes unreachable. The shell
		// must therefore use a dynamic viewport unit.
		const className = shell?.className ?? "";
		expect(className).toMatch(/\bh-dvh\b/);
		expect(className).not.toMatch(/\bh-screen\b/);
	});

	it("keeps the navbar offset as padding so content starts below it", () => {
		act(() => {
			root?.render(
				<QueryClientProvider client={queryClient}>
					<AppLayout>
						<div>konten</div>
					</AppLayout>
				</QueryClientProvider>,
			);
		});

		const shell = container.querySelector<HTMLElement>(
			"[data-workspace-shell]",
		);
		expect(shell?.className).toMatch(/\bpt-14\b/);
	});
});

describe("scrollable region contract", () => {
	it("lets the Ask flow own its scrolling inside the locked shell", async () => {
		// The shell locks body scroll, so the route content must be the element
		// that scrolls; otherwise the Next button can never be reached.
		// Vite rewrites import.meta.url to a /@fs/ URL, so read from cwd.
		const source = await readFile(
			`${process.cwd()}/src/app/ask/ask-flow.tsx`,
			"utf8",
		);
		expect(source).toMatch(/overflow-y-auto/);
		// The scroll container must be allowed to shrink below its content
		// height, which requires min-h-0 in a flex column.
		expect(source).toMatch(/min-h-0/);
	});
});
