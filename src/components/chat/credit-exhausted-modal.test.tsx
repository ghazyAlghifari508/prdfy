// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreditExhaustedModal } from "./credit-exhausted-modal";

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

describe("CreditExhaustedModal", () => {
	it("renders dialog with role, aria-modal, and aria-labelledby", () => {
		act(() => {
			root?.render(
				<QueryClientProvider client={queryClient}>
					<CreditExhaustedModal
						isOpen={true}
						onClose={() => {}}
						errorMessage="Saldo kredit Anda telah habis."
						projectId="proj-123"
						stage="prd"
						title="Kredit Habis"
					/>
				</QueryClientProvider>,
			);
		});

		const dialog = container.querySelector('[role="dialog"]');
		expect(dialog).toBeDefined();
		expect(dialog?.getAttribute("aria-modal")).toBe("true");
		expect(dialog?.getAttribute("aria-labelledby")).toBe(
			"credit-exhausted-modal-title",
		);

		const title = container.querySelector("#credit-exhausted-modal-title");
		expect(title?.textContent).toBe("Kredit Habis");
	});

	it("dismisses on Escape key", () => {
		const onClose = vi.fn();
		act(() => {
			root?.render(
				<QueryClientProvider client={queryClient}>
					<CreditExhaustedModal
						isOpen={true}
						onClose={onClose}
						errorMessage="Kredit habis"
						projectId="proj-123"
						stage="prd"
					/>
				</QueryClientProvider>,
			);
		});

		const escapeEvent = new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			cancelable: true,
		});
		document.dispatchEvent(escapeEvent);
		expect(onClose).toHaveBeenCalled();
	});
});
