// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		useLocation: () => "?redirect=/ask/1",
	};
});

const socialMock = vi.fn();

vi.mock("@/lib/auth-client", () => ({
	authClient: { signIn: { social: (...args: unknown[]) => socialMock(...args) } },
}));

vi.mock("@/components/ui/logo", () => ({
	Logo: () => <div data-testid="logo" />,
}));

import { LoginForm } from "./login-form";

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

function renderForm() {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => {
		root?.render(<LoginForm />);
	});
	return container;
}

describe("LoginForm", () => {
	it("recovers to an enabled state when social sign-in resolves an error", async () => {
		socialMock.mockResolvedValue({ data: null, error: { message: "denied" } });
		const rendered = renderForm();
		const buttons = rendered.querySelectorAll("button");
		expect(buttons).toHaveLength(2);

		await act(async () => {
			buttons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(socialMock).toHaveBeenCalledWith({
			provider: "google",
			callbackURL: "/ask/1",
		});
		expect(rendered.textContent).toContain("Gagal login");
		for (const button of buttons) {
			expect(button.disabled).toBe(false);
		}
	});
});
