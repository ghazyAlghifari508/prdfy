// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { GenerationProgress } from "./generation-progress";

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

function renderProgress(
	props: React.ComponentProps<typeof GenerationProgress>,
) {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => {
		root?.render(<GenerationProgress {...props} />);
	});
	return container;
}

describe("GenerationProgress", () => {
	it("renders label, elapsed timer, and natural waiting message without reasoning", () => {
		const c = renderProgress({ label: "PRD" });
		expect(c.textContent).toContain("Menyusun PRD");
		expect(c.textContent).toContain("0:00");
		expect(c.textContent).toContain(
			"Sedang menganalisis kebutuhan dan menyusun dokumen",
		);
	});

	it("renders streamed reasoning log when thinkingText is provided", () => {
		const c = renderProgress({
			label: "Acceptance Criteria",
			thinkingText: "Analyzing requirements for watchlist and favorites...",
		});
		expect(c.textContent).toContain("Menyusun Acceptance Criteria");
		expect(c.textContent).toContain("Proses Berpikir Model");
		expect(c.textContent).toContain("Analyzing requirements for watchlist");
	});
});
