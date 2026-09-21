// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFocusTrap } from "./use-focus-trap";

let container: HTMLDivElement;
let root: Root | null = null;

function ModalTestHarness({
	isOpen,
	onEscape,
}: {
	isOpen: boolean;
	onEscape?: () => void;
}) {
	const modalRef = useFocusTrap<HTMLDivElement>({ isOpen, onEscape });

	if (!isOpen) return null;

	return (
		<div ref={modalRef} tabIndex={-1} data-testid="modal">
			<button type="button" data-testid="btn-first">
				First
			</button>
			<input data-testid="input-middle" defaultValue="middle" />
			<button type="button" data-testid="btn-last">
				Last
			</button>
		</div>
	);
}

beforeEach(() => {
	(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
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
	document.body.innerHTML = "";
});

describe("useFocusTrap", () => {
	it("traps focus and cycles with Tab and Shift+Tab", () => {
		const triggerButton = document.createElement("button");
		triggerButton.id = "trigger";
		document.body.appendChild(triggerButton);
		triggerButton.focus();
		expect(document.activeElement).toBe(triggerButton);

		act(() => {
			root?.render(<ModalTestHarness isOpen={true} />);
		});

		const firstBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="btn-first"]',
		);
		const lastBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="btn-last"]',
		);
		expect(firstBtn).toBeDefined();
		expect(lastBtn).toBeDefined();

		// Initially focused on first element
		expect(document.activeElement).toBe(firstBtn);

		// Press Tab while on last element -> wraps to first
		lastBtn?.focus();
		expect(document.activeElement).toBe(lastBtn);

		const tabEvent = new KeyboardEvent("keydown", {
			key: "Tab",
			bubbles: true,
			cancelable: true,
		});
		document.dispatchEvent(tabEvent);
		expect(document.activeElement).toBe(firstBtn);

		// Press Shift+Tab while on first element -> wraps to last
		const shiftTabEvent = new KeyboardEvent("keydown", {
			key: "Tab",
			shiftKey: true,
			bubbles: true,
			cancelable: true,
		});
		document.dispatchEvent(shiftTabEvent);
		expect(document.activeElement).toBe(lastBtn);
	});

	it("handles Escape key by calling onEscape callback", () => {
		const onEscape = vi.fn();
		act(() => {
			root?.render(<ModalTestHarness isOpen={true} onEscape={onEscape} />);
		});

		const escapeEvent = new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			cancelable: true,
		});
		document.dispatchEvent(escapeEvent);
		expect(onEscape).toHaveBeenCalledTimes(1);
	});

	it("restores focus to previously active element on close", () => {
		const triggerButton = document.createElement("button");
		triggerButton.id = "prev-trigger";
		document.body.appendChild(triggerButton);
		triggerButton.focus();
		expect(document.activeElement).toBe(triggerButton);

		act(() => {
			root?.render(<ModalTestHarness isOpen={true} />);
		});

		const firstBtn = container.querySelector<HTMLButtonElement>(
			'[data-testid="btn-first"]',
		);
		expect(document.activeElement).toBe(firstBtn);

		// Close modal
		act(() => {
			root?.render(<ModalTestHarness isOpen={false} />);
		});

		expect(document.activeElement).toBe(triggerButton);
	});
});
