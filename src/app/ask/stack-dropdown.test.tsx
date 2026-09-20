// @vitest-environment jsdom
import { Database } from "lucide-react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StackDropdown } from "./stack-dropdown";

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

function renderDropdown(onChange: (value: string | undefined) => void) {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => {
		root?.render(
			<StackDropdown
				label="<sample label>"
				subtitle="<sample subtitle>"
				icon={Database}
				accent="#000000"
				placeholder="<sample placeholder>"
				options={["<option a>", "<option b>"]}
				value={undefined}
				disabled={false}
				onChange={onChange}
			/>,
		);
	});
	return container;
}

describe("StackDropdown", () => {
	it("activates a focused option with Enter", () => {
		const onChange = vi.fn();
		const rendered = renderDropdown(onChange);
		const trigger = rendered.querySelector("button");
		expect(trigger).not.toBeNull();
		act(() => {
			trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		const options = rendered.querySelectorAll('[role="option"]');
		expect(options.length).toBeGreaterThan(0);
		const first = options[0] as HTMLElement;
		act(() => {
			first.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		});

		expect(onChange).toHaveBeenCalledWith("<option a>");
	});

	it("activates a focused option with Space", () => {
		const onChange = vi.fn();
		const rendered = renderDropdown(onChange);
		const trigger = rendered.querySelector("button");
		act(() => {
			trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		const options = rendered.querySelectorAll('[role="option"]');
		const second = options[1] as HTMLElement;
		act(() => {
			second.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
		});

		expect(onChange).toHaveBeenCalledWith("<option b>");
	});
});
