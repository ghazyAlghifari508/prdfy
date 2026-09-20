// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button";

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

function renderButton(disabled: boolean | undefined, isLoading: boolean) {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => {
		root?.render(
			<Button disabled={disabled} isLoading={isLoading}>
				Simpan
			</Button>,
		);
	});
	return container.querySelector("button");
}

describe("Button", () => {
	it("stays disabled while loading even when disabled is false", () => {
		expect(renderButton(false, true)?.disabled).toBe(true);
	});

	it("respects an explicit enabled state when idle", () => {
		expect(renderButton(false, false)?.disabled).toBe(false);
	});
});
