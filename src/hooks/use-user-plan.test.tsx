// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUserPlan } from "./use-user-plan";

vi.mock("@/lib/auth-client", () => ({
	authClient: { useSession: () => ({ data: null }) },
}));

let container: HTMLDivElement;
let root: Root | null = null;
let seen: unknown[] = [];

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
	seen = [];
});

function Probe() {
	const query = useUserPlan();
	seen.push({ data: query.data, error: query.error, isError: query.isError });
	return null;
}

async function renderProbe() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => {
		root?.render(
			<QueryClientProvider client={client}>
				<Probe />
			</QueryClientProvider>,
		);
	});
}

describe("useUserPlan", () => {
	it("falls back to unauthenticated free state on 401", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("{}", { status: 401 })),
		);
		await renderProbe();
		await vi.waitFor(() => {
			const last = seen.at(-1) as { data?: { authenticated: boolean } };
			expect(last.data?.authenticated).toBe(false);
		});
	});

	it("surfaces server failures as errors instead of fake free data", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("{}", { status: 500 })),
		);
		await renderProbe();
		await vi.waitFor(() => {
			const last = seen.at(-1) as { isError: boolean };
			expect(last.isError).toBe(true);
		});
	});
});
