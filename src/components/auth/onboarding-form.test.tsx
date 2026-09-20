// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingForm } from "./onboarding-form";

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		useNavigate: () => vi.fn(),
	};
});

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
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

function renderForm() {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => {
		root?.render(<OnboardingForm />);
	});
	return container;
}

function clickByText(rendered: Element, text: string) {
	const el = Array.from(rendered.querySelectorAll("button")).find((b) =>
		b.textContent?.includes(text),
	);
	expect(el).toBeDefined();
	act(() => {
		el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
}

describe("OnboardingForm", () => {
	it("recovers with an error when submit fails on the network", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("offline");
			}),
		);
		const rendered = renderForm();

		const input = rendered.querySelector("input");
		expect(input).not.toBeNull();
		act(() => {
			input?.focus();
			input?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		// Controlled input needs its native setter to register the change.
		const setter = Object.getOwnPropertyDescriptor(
			window.HTMLInputElement.prototype,
			"value",
		)?.set;
		act(() => {
			setter?.call(input, "<sample name>");
			input?.dispatchEvent(new Event("input", { bubbles: true }));
		});

		clickByText(rendered, "Lanjut");
		clickByText(rendered, "Software Developer");
		clickByText(rendered, "Lanjut");
		clickByText(rendered, "Dokumentasi produk");

		await act(async () => {
			clickByText(rendered, "Selesai");
		});

		expect(rendered.textContent).toContain("Gagal menyimpan onboarding.");
		const submit = Array.from(rendered.querySelectorAll("button")).find((b) =>
			b.textContent?.includes("Selesai"),
		);
		expect(submit?.disabled).toBe(false);
	});
});
