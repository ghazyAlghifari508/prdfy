// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryPage } from "./history-page";

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({ children, ...rest }: { children: React.ReactNode }) => (
			<a {...rest}>{children}</a>
		),
		useNavigate: () => vi.fn(),
		useRouter: () => ({ invalidate: vi.fn() }),
	};
});

vi.mock("@/hooks/use-user-plan", () => ({
	useUserPlan: () => ({ refetch: vi.fn() }),
}));

let container: HTMLDivElement;
let root: Root | null = null;

afterEach(() => {
	if (root) {
		const currentRoot = root;
		act(() => {
			currentRoot.unmount();
		});
		root = null;
	}
	container?.remove();
	vi.clearAllMocks();
});

const item = {
	id: "project-1",
	name: "<sample project>",
	step: "prd",
	lastUrl: null,
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	preview: null,
	acStatus: null,
	taskStatus: null,
};

describe("HistoryPage", () => {
	it("renders the delete action as a sibling of the navigation link", () => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		act(() => {
			root?.render(<HistoryPage items={[item]} />);
		});

		const deleteButton = container.querySelector(
			'button[aria-label="Hapus proyek <sample project>"]',
		);
		expect(deleteButton).not.toBeNull();
		expect(deleteButton?.closest("a")).toBeNull();
		expect(
			container.querySelector("li > a, li > div > a, li a"),
		).not.toBeNull();
	});
});
