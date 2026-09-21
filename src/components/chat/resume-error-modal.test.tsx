// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResumeErrorModal } from "./resume-error-modal";

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
	(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
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
});

describe("ResumeErrorModal", () => {
	it("renders with dialog role, aria-modal, and accessible labels", () => {
		act(() => {
			root?.render(
				<ResumeErrorModal
					isOpen={true}
					onClose={() => {}}
					onResume={() => {}}
					errorMessage="Gagal melanjutkan PRD"
				/>,
			);
		});

		const dialog = container.querySelector('[role="dialog"]');
		expect(dialog).toBeDefined();
		expect(dialog?.getAttribute("aria-modal")).toBe("true");
		expect(dialog?.getAttribute("aria-labelledby")).toBe("resume-error-title");
		expect(dialog?.getAttribute("aria-describedby")).toBe(
			"resume-error-description",
		);

		const title = container.querySelector("#resume-error-title");
		expect(title?.textContent).toContain("AI Sedang Sibuk / Terputus");

		const desc = container.querySelector("#resume-error-description");
		expect(desc?.textContent).toContain("Gagal melanjutkan PRD");

		const closeBtn = container.querySelector('button[aria-label="Tutup"]');
		expect(closeBtn).toBeDefined();
	});

	it("handles resume and close button clicks", () => {
		const onClose = vi.fn();
		const onResume = vi.fn();

		act(() => {
			root?.render(
				<ResumeErrorModal
					isOpen={true}
					onClose={onClose}
					onResume={onResume}
					errorMessage="Koneksi terputus"
				/>,
			);
		});

		const resumeBtn = [...container.querySelectorAll("button")].find((b) =>
			/lanjutkan/i.test(b.textContent ?? ""),
		);
		const cancelBtn = [...container.querySelectorAll("button")].find((b) =>
			/batal/i.test(b.textContent ?? ""),
		);

		act(() => {
			resumeBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onResume).toHaveBeenCalledTimes(1);

		act(() => {
			cancelBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("dismisses on Escape key", () => {
		const onClose = vi.fn();

		act(() => {
			root?.render(
				<ResumeErrorModal
					isOpen={true}
					onClose={onClose}
					onResume={() => {}}
					errorMessage="Error"
				/>,
			);
		});

		const escapeEvent = new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			cancelable: true,
		});
		document.dispatchEvent(escapeEvent);
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
