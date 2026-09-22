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
	it("renders the eight required sections in order", () => {
		const prompt = buildAgentPrompt(payload, { projectName: "Wishlist Fitur" });
		const headings = [
			"## Informasi Project",
			"## Prasyarat Eksekusi",
			"## Perintah Yang Harus Dieksekusi",
			"## Yang Dilakukan CLI Otomatis",
			"## Aturan Yang Wajib Dipatuhi",
			"## Penanganan Kegagalan",
			"## Format Laporan Akhir",
		];
		let cursor = -1;
		for (const heading of headings) {
			const at = prompt.indexOf(heading);
			expect(at, `missing section: ${heading}`).toBeGreaterThan(-1);
			expect(at, `out of order: ${heading}`).toBeGreaterThan(cursor);
			cursor = at;
		}
		// Section 1 (Tujuan) precedes the first heading.
		const objectiveAt = prompt.indexOf("Sinkronkan codebase repositori lokal");
		expect(objectiveAt).toBeGreaterThan(-1);
		expect(objectiveAt).toBeLessThan(prompt.indexOf("## Informasi Project"));
	});

	it("states the objective as synchronization only", () => {
		const prompt = buildAgentPrompt(payload);
		expect(prompt).toContain(
			"Sinkronkan codebase repositori lokal ini ke project PrdFy menggunakan CLI resmi.",
		);
		expect(prompt).toMatch(/fokus hanya pada proses sinkronisasi/i);
		expect(prompt).toMatch(/jangan melakukan perubahan terhadap source code/i);
	});

	it("lists every project information field as a labelled block", () => {
		const prompt = buildAgentPrompt(payload, { projectName: "Wishlist Fitur" });
		expect(prompt).toContain("Nama Fitur   : Wishlist Fitur");
		expect(prompt).toContain("Project ID   : proj_123");
		expect(prompt).toContain("Server       : https://prdfy.example.com");
		expect(prompt).toContain("Sync Token   : token-rahasia-abc123");
		expect(prompt).toContain(`Expired At   : ${payload.expiresAt}`);
	});

	it("omits the Nama Fitur line when no project name is known", () => {
		const prompt = buildAgentPrompt(payload);
		// An empty placeholder would read as a value the agent should fill in.
		expect(prompt).not.toContain("Nama Fitur");
		// The rest of the block is unaffected.
		expect(prompt).toContain("Project ID   : proj_123");
	});

	it("states root, CLI, and install-as-fallback prerequisites", () => {
		const prompt = buildAgentPrompt(payload);
		expect(prompt).toMatch(/berada di root repositori git/i);
		expect(prompt).toMatch(/gunakan PrdFy CLI/i);
		expect(prompt).toContain("npm i -g @ghazynabiel/prdfy");
		// Install is a fallback, not the main step.
		expect(prompt).toMatch(/jika command `prdfy` tidak tersedia, install/i);
	});

	it("gives exactly one single-line command with inline flags", () => {
		const prompt = buildAgentPrompt(payload);
		const command =
			"prdfy codebase sync --project-id proj_123 --sync-token token-rahasia-abc123";
		expect(prompt).toContain(command);
		// One command only: no alternative invocation and no env var.
		expect(prompt.match(/prdfy codebase sync/g)).toHaveLength(1);
		expect(prompt).not.toContain("PRDFY_SYNC_TOKEN");
		expect(prompt).not.toContain("--api-url");
		// No shell continuation character: a backslash line break is valid in
		// bash/zsh but a parse error in PowerShell and cmd.exe.
		expect(prompt).not.toMatch(/\\\r?\n/);
		expect(command).not.toContain("\n");
	});

	it("describes CLI-owned work as information, not manual steps", () => {
		const prompt = buildAgentPrompt(payload);
		expect(prompt).toMatch(/bersifat informasi/i);
		expect(prompt).toMatch(/jangan kerjakan ulang secara manual/i);
		for (const item of [
			"Deteksi root repository",
			"Validasi versi minimum CLI",
			"Pembuatan `.prdfyignore` jika belum ada",
			"Penggunaan ignore bawaan",
			"Hashing dan upload hanya file yang diizinkan",
		]) {
			expect(prompt, `missing CLI-owned item: ${item}`).toContain(item);
		}
		// Exclusion categories, with `.env` as the concrete example.
		expect(prompt).toMatch(/file rahasia \(termasuk `\.env`\)/i);
		expect(prompt).toMatch(/dependency, build, dan cache/i);
	});

	it("lists every mandatory rule as a checklist item", () => {
		const prompt = buildAgentPrompt(payload);
		for (const rule of [
			"Jangan mengubah source code.",
			"Jangan membuat commit.",
			"Jangan push.",
			"Jangan mengedit `.gitignore`.",
			"Jangan menulis Sync Token ke file proyek.",
			"Jangan menyimpan token ke konfigurasi permanen.",
			"Jangan memodifikasi `.prdfyignore` kecuali diminta user.",
			"Jangan mengklaim sinkronisasi berhasil tanpa output CLI.",
		]) {
			expect(prompt, `missing rule: ${rule}`).toContain(`- [ ] ${rule}`);
		}
	});

	it("instructs honest failure reporting", () => {
		const prompt = buildAgentPrompt(payload);
		expect(prompt).toMatch(/tampilkan error CLI asli tanpa diringkas/i);
		expect(prompt).toMatch(/jangan perbaiki sendiri/i);
		expect(prompt).toMatch(/jangan retry dengan command berbeda/i);
		expect(prompt).toMatch(/jangan mengarang penyebab/i);
		expect(prompt).toMatch(/laporkan hanya hasil nyata/i);
	});

	it("defines a fixed final report format", () => {
		const prompt = buildAgentPrompt(payload);
		expect(prompt).toMatch(/format berikut tanpa menambah bagian lain/i);
		for (const field of [
			"Status:",
			"Project:",
			"Server:",
			"CLI Version:",
			"Hasil CLI:",
			"Catatan:",
		]) {
			expect(prompt, `missing report field: ${field}`).toContain(field);
		}
		expect(prompt).toContain("Berhasil / Gagal");
		expect(prompt).toContain("<output CLI asli>");
		// CLI Version is sourced from CLI output with an explicit fallback.
		expect(prompt).toContain(
			"<x.x.x dari output CLI, atau - jika tidak tersedia>",
		);
	});

	it("omits version numbers and path-pattern ignore lists", () => {
		const prompt = buildAgentPrompt(payload);
		// The old robotic scaffolding is gone.
		expect(prompt).not.toMatch(/Langkah \d/);
		// The CLI enforces the minimum and prints the update notice, so the
		// prompt must not carry a version number or a version check step.
		expect(prompt).not.toContain("2.0.0");
		expect(prompt).not.toContain("prdfy --version");
		// No path-pattern ignore list: it would rot and could contradict the
		// CLI's built-ins. Categories only.
		expect(prompt).not.toContain("node_modules");
		expect(prompt).not.toContain("*.pem");
		expect(prompt).not.toContain("dist/");
		expect(prompt).not.toContain("coverage/");
	});

	it("embeds the real credential only in the copyable prompt", () => {
		const prompt = buildAgentPrompt(payload);
		expect(prompt).toContain("token-rahasia-abc123");
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
