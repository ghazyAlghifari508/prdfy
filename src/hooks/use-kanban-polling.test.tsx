// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useKanbanTasks, type KanbanData } from "./use-kanban-polling";

class FakeEventSource {
	static instances: FakeEventSource[] = [];
	onmessage: ((e: { data: string }) => void) | null = null;
	onerror: (() => void) | null = null;
	closed = false;
	constructor(public url: string) {
		FakeEventSource.instances.push(this);
	}
	close() {
		this.closed = true;
	}
}

const boardPayload: KanbanData = {
	columns: { pending: [], in_progress: [], completed: [], failed: [] },
	staleness: "live",
	lastUpdateAt: new Date().toISOString(),
};

type Hook = ReturnType<typeof useKanbanTasks>;

let container: HTMLDivElement;
let root: Root | null = null;
let latest: Hook | null = null;

function Harness({ projectId }: { projectId: string }) {
	latest = useKanbanTasks({ projectId, intervalMs: 50 });
	return null;
}

async function mount(projectId: string) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => {
		root?.render(
			<QueryClientProvider client={client}>
				<Harness projectId={projectId} />
			</QueryClientProvider>,
		);
	});
}

afterEach(() => {
	if (root) {
		const currentRoot = root;
		act(() => {
			currentRoot.unmount();
		});
		root = null;
	}
	container?.remove();
	latest = null;
	FakeEventSource.instances = [];
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("useKanbanTasks", () => {
	it("fails over to polling when the stream emits malformed data", async () => {
		vi.stubGlobal("EventSource", FakeEventSource);
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => boardPayload,
		}));
		vi.stubGlobal("fetch", fetchMock);

		await mount("project-1");
		const stream = FakeEventSource.instances.at(-1);
		expect(stream).toBeDefined();

		await act(async () => {
			stream?.onmessage?.({ data: "not-json{{{" });
		});

		await vi.waitFor(() => {
			expect(fetchMock).toHaveBeenCalled();
		});
		await vi.waitFor(() => {
			expect(latest?.isLoading).toBe(false);
		});
		expect(stream?.closed).toBe(true);
	});

	it("coalesces concurrent manual refreshes into one fetch", async () => {
		vi.stubGlobal("EventSource", FakeEventSource);
		let resolveFetch!: (value: unknown) => void;
		const fetchMock = vi.fn(
			() =>
				new Promise((resolve) => {
					resolveFetch = resolve;
				}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await mount("project-1");

		let first: Promise<void> | undefined;
		let second: Promise<void> | undefined;
		await act(async () => {
			first = latest?.refetch();
			second = latest?.refetch();
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await act(async () => {
			resolveFetch({ ok: true, json: async () => boardPayload });
			await first;
			await second;
		});
	});
});
