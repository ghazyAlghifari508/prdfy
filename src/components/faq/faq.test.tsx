// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Faq } from "./faq";

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
});

function renderFaq() {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => {
		root?.render(<Faq />);
	});
	return container;
}

describe("Faq", () => {
	it("keeps each answer linked to its trigger and toggles expanded state", () => {
		const rendered = renderFaq();
		const trigger = rendered.querySelector("button");

		expect(trigger).not.toBeNull();
		expect(trigger?.getAttribute("aria-controls")).toBeTruthy();
		expect(trigger?.getAttribute("aria-expanded")).toBe("false");

		act(() => {
			trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(trigger?.getAttribute("aria-expanded")).toBe("true");
		const answerId = trigger?.getAttribute("aria-controls");
		const answer = answerId ? rendered.querySelector(`#${answerId}`) : null;
		expect(answer?.getAttribute("aria-labelledby")).toBe(trigger?.id);
		expect(answer?.textContent).toContain("PRD");
		expect(answer?.getAttribute("aria-hidden")).toBe("false");
	});
});
