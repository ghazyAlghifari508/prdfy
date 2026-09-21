// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForbiddenPage } from "./forbidden-page";

vi.mock("@tanstack/react-router", () => ({
	Link: React.forwardRef<
		HTMLAnchorElement,
		{ to: string; children: React.ReactNode; className?: string }
	>(({ to, children, className, ...props }, ref) => (
		<a ref={ref} href={to} className={className} {...props}>
			{children}
		</a>
	)),
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
});

describe("ForbiddenPage", () => {
	it("renders 403 Forbidden with proper Indonesian message and workspace link", () => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		act(() => {
			root?.render(<ForbiddenPage />);
		});

		expect(container.textContent).toContain("403 Forbidden");
		expect(container.textContent).toContain("Akses Ditolak");
		expect(container.textContent).toContain(
			"Akun ini tidak memiliki izin untuk mengakses halaman admin.",
		);
		const links = container.querySelectorAll("a");
		const backLink = links[links.length - 1];
		expect(backLink?.getAttribute("href")).toBe("/");
		expect(backLink?.textContent).toContain("Kembali ke Workspace");
	});

	it("does not leak admin emails or sensitive authorization details", () => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		act(() => {
			root?.render(<ForbiddenPage />);
		});

		expect(container.textContent).not.toContain("@");
		expect(container.textContent).not.toContain("alghifarighazy508");
		expect(container.textContent).not.toContain("database");
		expect(container.textContent).not.toContain("isAdmin");
	});
});
