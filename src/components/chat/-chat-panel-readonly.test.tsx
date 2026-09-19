// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "./chat-panel";

// Mock router hooks
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	useLocation: () => ({ pathname: "/prd/test-id", searchStr: "" }),
	useRouter: () => ({ invalidate: vi.fn() }),
}));

let container: HTMLDivElement;
let root: Root | null = null;
const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
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
});

function renderPanel(props: React.ComponentProps<typeof ChatPanel>) {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => {
		root!.render(
			<QueryClientProvider client={queryClient}>
				<ChatPanel {...props} />
			</QueryClientProvider>,
		);
	});
	return container;
}

describe("ChatPanel read-only mode", () => {
	it("renders locked banner and hides textarea when isReadOnly=true", () => {
		const c = renderPanel({
			projectId: "test-proj",
			isReadOnly: true,
			currentPrdContent: "# PRD test",
		});

		expect(c.textContent).toContain("Dokumen PRD Dikunci (Read-Only)");
		expect(c.textContent).toContain(
			"Proyek telah mencapai tahap Acceptance Criteria / Task",
		);
		expect(c.querySelector("textarea")).toBeNull();
	});

	it("renders interactive textarea when isReadOnly=false", () => {
		const c = renderPanel({
			projectId: "test-proj",
			isReadOnly: false,
			currentPrdContent: "# PRD test",
		});

		expect(c.textContent).not.toContain("Dokumen PRD Dikunci (Read-Only)");
		expect(c.querySelector("textarea")).not.toBeNull();
	});
});
