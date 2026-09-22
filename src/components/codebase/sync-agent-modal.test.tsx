// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SyncPromptPayload } from "@/lib/codebase-sync";
import { buildAgentPrompt, SyncAgentModal } from "./sync-agent-modal";

const payload: SyncPromptPayload = {
	projectId: "proj_123",
	apiBaseUrl: "https://prdfy.example.com",
	syncToken: "token-rahasia-abc123",
	cliMinVersion: "2.0.0",
	syncCommand: "prdfy codebase sync --project-id proj_123 --sync-token <token>",
	expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
};

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
	vi.unstubAllGlobals();
});

function renderModal(
	props: Partial<React.ComponentProps<typeof SyncAgentModal>> = {},
) {
	container = document.createElement("div");
	document.body.appendChild(container);
	const nextRoot = createRoot(container);
	root = nextRoot;
	act(() => {
		nextRoot.render(
			<SyncAgentModal open onClose={() => {}} payload={payload} {...props} />,
		);
	});
	return container;
}

describe("buildAgentPrompt", () => {
	it("states the objective, session details, sync command, and CLI-owned prep", () => {
		const prompt = buildAgentPrompt(payload);
		// Objective-oriented opening, not a numbered procedure.
		expect(prompt).toContain("Sinkronkan codebase repositori ini");
		// Required session context.
		expect(prompt).toContain("proj_123");
		expect(prompt).toContain("https://prdfy.example.com");
		expect(prompt).toContain("token-rahasia-abc123");
		// The command that actually performs the sync.
		expect(prompt).toContain("prdfy codebase sync --project-id proj_123");
		// Preparation the CLI owns, stated as automatic rather than as steps.
		expect(prompt).toContain(".prdfyignore");
		expect(prompt).toContain("deteksi root repositori");
		expect(prompt).toContain("validasi versi minimum");
		// Security rules.
		expect(prompt).toMatch(/jangan mengubah source code/i);
		expect(prompt).toMatch(/jangan menulis sync token/i);
	});

	it("omits robotic step scaffolding, version numbers, and hardcoded ignore lists", () => {
		const prompt = buildAgentPrompt(payload);
		// The old checklist form is gone.
		expect(prompt).not.toMatch(/Langkah \d/);
		// No version-gate copy: the CLI enforces the minimum and prints the
		// update notice, so the prompt must not carry a version number.
		expect(prompt).not.toContain("2.0.0");
		expect(prompt).not.toContain("prdfy --version");
		// No enumerated ignore list (a hardcoded ignore list in UI copy would
		// rot and could contradict the CLI's built-ins).
		expect(prompt).not.toContain("node_modules");
		expect(prompt).not.toContain("*.pem");
		expect(prompt).not.toContain(".env");
	});

	it("embeds the real credential only in the copyable prompt", () => {
		const prompt = buildAgentPrompt(payload);
		expect(prompt).toContain("token-rahasia-abc123");
	});

	it("includes the project name when provided", () => {
		const prompt = buildAgentPrompt(payload, { projectName: "Wishlist Fitur" });
		expect(prompt).toContain("Wishlist Fitur");
	});
});

describe("SyncAgentModal", () => {
	it("shows the credential ONLY inside the copyable textarea", () => {
		const c = renderModal();
		const textarea = c.querySelector("textarea");
		expect(textarea?.value).toContain("token-rahasia-abc123");
		const outside = (c.textContent ?? "").replace(textarea?.value ?? "", "");
		expect(outside).not.toContain("token-rahasia-abc123");
		expect(outside).toContain("<token>");
	});

	it("copies the full prompt and confirms in Bahasa Indonesia", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", {
			...navigator,
			clipboard: { writeText },
		});
		const c = renderModal();
		const copyButton = [...c.querySelectorAll("button")].find((b) =>
			/alin/i.test(b.textContent ?? ""),
		);
		expect(copyButton).toBeDefined();
		await act(async () => {
			copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(writeText).toHaveBeenCalledTimes(1);
		expect(writeText.mock.calls[0]?.[0]).toContain("token-rahasia-abc123");
		expect(c.textContent).toMatch(/tersalin/i);
	});

	it("supports close and retry actions", () => {
		const onClose = vi.fn();
		const onRetry = vi.fn();
		const c = renderModal({ onClose, onRetry });
		const closeButton = [...c.querySelectorAll("button")].find((b) =>
			/utup/i.test(b.textContent ?? ""),
		);
		const retryButton = [...c.querySelectorAll("button")].find((b) =>
			/coba lagi|buat sesi baru/i.test(b.textContent ?? ""),
		);
		act(() => {
			closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("renders an indeterminate preparing state when payload is missing", () => {
		const c = renderModal({ payload: null });
		expect(c.textContent).toMatch(/menyiapkan/i);
		expect(c.textContent).not.toContain("%");
	});

	it("renders dialog semantics and dismisses on Escape", () => {
		const onClose = vi.fn();
		const c = renderModal({ onClose });
		const dialog = c.querySelector('[role="dialog"]');
		expect(dialog).toBeDefined();
		expect(dialog?.getAttribute("aria-modal")).toBe("true");
		expect(dialog?.getAttribute("aria-labelledby")).toBe(
			"sync-agent-modal-title",
		);

		const escapeEvent = new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			cancelable: true,
		});
		document.dispatchEvent(escapeEvent);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("resets copy status when payload changes", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", {
			...navigator,
			clipboard: { writeText },
		});
		const c = renderModal();
		const copyButton = [...c.querySelectorAll("button")].find((b) =>
			/alin/i.test(b.textContent ?? ""),
		);
		await act(async () => {
			copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(c.textContent).toMatch(/tersalin/i);

		// Now change payload
		act(() => {
			root?.render(
				<SyncAgentModal
					open
					onClose={() => {}}
					payload={{
						...payload,
						syncToken: "new-token-456",
					}}
				/>,
			);
		});
		expect(c.textContent).not.toMatch(/tersalin/i);
	});

	it("renders nothing when closed", () => {
		const c = renderModal({ open: false });
		expect(c.textContent).toBe("");
	});
});
