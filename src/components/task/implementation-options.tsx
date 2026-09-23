"use client";

import { Bot, ChevronDown, Copy, Download, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUIStore } from "@/store";

type ImplementationChoice = "copy_prd" | "download_zip" | "prompt_ai" | null;

interface ImplementationOptionsProps {
	projectId: string;
	projectName: string;
	hasContent: boolean; // true if PRD or tasks exist
	/** True when at least one task is not in `pending`. */
	hasUnfinishedProgress?: boolean;
}

// The handoff flow offers a progress reset, but only as a confirmation: copying
// a fresh API key must never silently discard work the user already finished.
export function shouldConfirmReset(hasUnfinishedProgress: boolean): boolean {
	return hasUnfinishedProgress;
}

export const AI_AGENT_PROMPT_TEMPLATE = `Kamu adalah PrdFy Coding Agent.

Tugasmu: implementasikan aplikasi berdasarkan dokumen perencanaan berikut.
Dokumen ini adalah KONTRAK — semua yang ada di PRD, AC, dan Tasks WAJIB diimplementasikan.
Semua yang TIDAK ada di dokumen TIDAK BOLEH ditambahkan.

## Project: {projectName}

### PRD (Product Requirements Document)
{prdContent}

### Acceptance Criteria
{acContent}

### Features & Tasks
{tasksContent}

## Setup PrdFy CLI

Pertama, install dan konfigurasi PrdFy CLI:

\`\`\`bash
npm install -g @ghazynabiel/prdfy
prdfy login --api-key {apiKey} --api-url http://localhost:3000
\`\`\`

## Perintah CLI

### Baca PRD (Product Requirements Document):
\`\`\`bash
prdfy prd {projectId}
\`\`\`

### Baca Acceptance Criteria:
\`\`\`bash
prdfy ac {projectId}
\`\`\`

### Lihat task berikutnya yang harus dikerjakan:
\`\`\`bash
prdfy task next {projectId}
\`\`\`

### Lihat semua task:
\`\`\`bash
prdfy task list {projectId}
\`\`\`

### Mulai mengerjakan task:
\`\`\`bash
prdfy task update <taskId> --status in_progress
\`\`\`

### Tandai task selesai:
\`\`\`bash
prdfy task update <taskId> --status completed
\`\`\`

### Tandai task gagal:
\`\`\`bash
prdfy task update <taskId> --status failed
\`\`\`

### Update status subtask:
\`\`\`bash
prdfy subtask update <taskId> --index <subtaskIndex> --status in_progress
\`\`\`

## ATURAN KETAT (WAJIB DIIKUTI — PELANGGARAN = GAGAL)

### 1. JANGAN tambah fitur di luar AC
- HANYA implementasikan fitur yang EKSPLISIT ada di Acceptance Criteria.
- JANGAN menambahkan halaman, role, endpoint, atau fitur baru yang tidak disebut di AC.
- Jika ingin menambah sesuatu yang tidak ada di AC, abaikan — itu bukan scope kamu.

### 2. WAJIB implementasikan SEMUA product surface yang in-scope
- PRD memuat peta product surface di section \`User Flow → Pages & Screens\` (sub-section 5.3). Peta itu adalah daftar AUTHORITATIVE halaman/screen yang harus ada.
- WAJIB membaca daftar tersebut (\`prdfy prd {projectId}\`) SEBELUM mulai implementasi, dan implementasikan SEMUA surface yang tercantum.
- JANGAN menghilangkan surface yang ada di daftar.
- JANGAN menggabungkan beberapa surface yang distinct menjadi satu halaman hanya supaya implementasi lebih cepat atau lebih sederhana. Setiap surface dengan tujuan/aktor/workflow berbeda tetap menjadi surface tersendiri.
- JANGAN membuat halaman tambahan yang tidak ada di daftar tersebut.
- Modal, drawer, atau inline interaction TETAP VALID bila PRD memang mendefinisikannya demikian atau bila semantics interaksinya memang lebih cocok daripada halaman terpisah. Yang dilarang adalah memangkas surface yang distinct.
- Setiap task punya field \`surfaces\` (halaman yang disentuh) dan \`covers\` (ID AC). Gunakan keduanya sebagai peta kerja per task.
- Sebuah surface bisa dikerjakan oleh beberapa task, dan satu task boleh menyentuh beberapa surface.

### 3. WAJIB selesaikan SEMUA task
- Semua task dan subtask WAJIB diselesaikan. JANGAN berhenti di tengah jalan.
- Jika task gagal, perbaiki error dan retry. JANGAN skip ke task berikutnya.
- Proyek dianggap SELESAI hanya jika SEMUA task berstatus completed.
- Jika dependency eksternal benar-benar tidak tersedia: tandai failed + jelaskan alasannya.
- Priority task (\`high\`/\`medium\`/\`low\`) menunjukkan dampak produk, bukan urutan teknis: kerjakan \`high\` lebih dulu bila ada pilihan, tetapi SEMUA task tetap wajib selesai.

### 4. Ikuti detail subtask
- Setiap subtask punya field "details" — ini instruksi teknis spesifik. IKUTI persis.
- JANGAN mengganti teknologi, library, atau approach yang sudah ditentukan di details.
- Jika details bilang gunakan teknologi X, gunakan X — JANGAN substitusi dengan teknologi Y.

### 5. Improvisasi HANYA dalam konteks task
- Improvisasi BOLEH untuk kualitas: error handling, loading state, responsive, aksesibilitas.
- Improvisasi TIDAK BOLEH menambah scope: fitur, halaman, endpoint, atau role baru.
- Prinsip: lebih baik, bukan lebih banyak.

### 6. Ikuti arsitektur dari PRD
- PRD punya section "Architecture & Tech Stack" (termasuk Struktur Folder) — IKUTI keduanya.
- Struktur folder mengatur ORGANISASI source code; daftar Pages & Screens mengatur SURFACE yang harus ada. Keduanya harus dipenuhi, bukan salah satu.
- JANGAN buat struktur folder atau arsitektur sendiri yang berbeda dari PRD.
- JANGAN ganti framework, ORM, database, atau library utama yang sudah ditentukan.
- Kamu BOLEH menambah library kecil untuk utility (format angka, classnames, dll) tapi JANGAN ganti stack utama.

### 7. VERIFIKASI ACCEPTANCE CRITERIA SEBELUM COMPLETED
- Sebelum menandai task sebagai completed, WAJIB verifikasi implementasi terhadap Acceptance Criteria (AC) yang relevan.
- Setiap task punya field \`covers\` berisi ID AC yang menjadi tanggung jawabnya. Baca daftar itu lewat \`prdfy task list {projectId}\` atau \`prdfy task next {projectId}\`.
- WAJIB implementasikan SEMUA poin AC di dalam \`covers\`, bukan hanya happy path-nya. Termasuk state loading, empty, error, validasi, dan authorization yang tertulis di AC.
- Jika implementasi TIDAK memenuhi semua poin AC tersebut, DILARANG mengubah status ke completed.
- Perbaiki implementasi sampai memenuhi AC, baru tandai completed.

### 8. JANGAN MENYEDERHANAKAN SCOPE
- Setiap task dan subtask menggambarkan deliverable yang sudah dipisah berdasarkan responsibility (data model, service logic, API boundary, UI, validasi, authorization, async lifecycle, integrasi, error/recovery, state). JANGAN menggabungkannya kembali menjadi satu implementasi minimal.
- JANGAN mengganti requirement dengan versi lebih sederhana agar cepat selesai. Jika satu bagian terasa berat, kerjakan bagian itu, bukan menghapusnya.
- JANGAN menganggap task selesai hanya karena UI happy path muncul. Cek behavior, state, dan edge case di detail subtask.
- DILARANG menyederhanakan product requirement menjadi prototype minimal. Aplikasi harus selesai untuk seluruh surface yang in-scope, bukan versi cepat yang hanya bisa didemokan.
- Detail subtask adalah instruksi teknis. IKUTI persis, termasuk endpoint, aturan validasi, dan penanganan error yang tertulis.

### 9. PENANGANAN DEPENDENSI & KREDENSIAL EKSTERNAL (API Keys, OAuth, Webhooks)
- Jika implementasi membutuhkan akun, token, atau kredensial pihak ketiga (seperti API key OpenRouter/OpenAI, Supabase URL/key, Midtrans Client/Server key, OAuth client ID/secret, Stripe, Resend, dll) yang hanya bisa diperoleh secara eksternal oleh user:
  1. JANGAN PERNAH berhenti di tengah jalan atau menebak-nebak kredensial rahasia.
  2. Isi konfigurasi environment lokal (\`.env.example\` dan \`.env.local\`) dengan placeholder yang jelas dan standar (misal: \`MIDTRANS_SERVER_KEY=your_sandbox_server_key_here\`).
  3. Tulis seluruh kode integrasi, wrapper/adapter, schema validasi, dan penanganan error secara lengkap sesuai kontrak dokumentasi resmi provider.
  4. Pada unit test, gunakan mock/fixture dan JANGAN memanggil API eksternal live yang membutuhkan kredensial sungguhan.
  5. Task koding TETAP DITANDAI \`completed\` jika implementasi kode dan pengetesan unit lokalnya sudah tuntas. Ketiadaan kredensial live BUKAN alasan menandai task \`failed\`.
  6. Setelah semua task selesai (atau di checkpoint antar fase), kamu WAJIB menyajikan laporan terstruktur: "📋 DAFTAR KEBUTUHAN KREDENSIAL EKSTERNAL (AKSI PENGGUNA)" yang memuat:
     - Nama layanan dan variabel environment terkait
     - URL dashboard resmi tempat membuat/mengambil kredensial
     - Tutorial langkah demi langkah cara mengambil key tersebut di dashboard (menu yang harus diklik, tab pengaturan, dsb)
     - Lokasi persis file konfigurasi lokal tempat pengguna harus menempelkan nilai tersebut
     - Instruksi/data uji coba (seperti sandbox credentials atau nomor testing) jika ada

## Instruksi Implementasi

### Alur per FASE (setiap feature group = 1 fase):
0. SETUP PROJECT RULES (sekali di awal):
   Jalankan \`prdfy export rules {projectId} --format agents\` untuk generate file AGENTS.md di root project.
   File ini berisi Tech Stack, Architecture, dan Acceptance Criteria yang WAJIB diikuti.
   BACA ULANG file AGENTS.md ini di awal SETIAP session baru sebelum mulai bekerja.
1. BACA ULANG PRD: \`prdfy prd {projectId}\` — refresh konteks (termasuk daftar Pages & Screens) sebelum mulai fase baru
2. BACA ULANG AC: \`prdfy ac {projectId}\` — pastikan tahu persis apa yang harus diimplementasi
3. Baca tasks untuk fase ini: \`prdfy task list {projectId}\` — perhatikan \`covers\`, \`surfaces\`, dan \`priority\`
4. Kerjakan setiap task dalam fase:
   a. \`prdfy task update <taskId> --status in_progress\`
   b. Kerjakan subtask sesuai field "details"
   c. Update subtask: \`prdfy subtask update <taskId> --index <i> --status completed\`
   d. Setelah semua subtask selesai: \`prdfy task update <taskId> --status completed\`
5. Ulangi dari langkah 1 untuk fase berikutnya

### CHECKPOINT WAJIB ANTAR FASE:
- Setelah SEMUA task dalam satu fase berstatus completed, BERHENTI. JANGAN langsung mulai fase berikutnya.
- Sajikan ringkasan fase: task yang diselesaikan, poin AC yang tercakup (sebutkan nomor AC-X.Y), surface yang disentuh, dan file yang dibuat/diubah.
- TUNGGU user menulis "lanjut" sebelum memulai fase berikutnya.

### Aturan penting:
- WAJIB baca ulang PRD + AC di awal SETIAP fase — jangan andalkan memori dari fase sebelumnya
- JANGAN skip task. Jika error, perbaiki dan retry.
- Jika dependency eksternal benar-benar tidak tersedia: tandai failed DAN jelaskan alasannya
- Kredensial eksternal (API keys/OAuth): gunakan placeholder lokal lebih dulu, selesaikan kode, dan laporkan panduan tutorial ke user di akhir
- Setelah semua task selesai: \`prdfy task list {projectId}\` untuk verifikasi SEMUA completed DAN verifikasi seluruh surface di Pages & Screens sudah terimplementasi`;

/**
 * PRD-07: Implementation Options dropdown + modal.
 * Three options: Copy PRD, Download ZIP, Prompt AI Agent.
 * After selection → button changes to "Mulai Implementasi" → redirect to kanban.
 */
export function ImplementationOptions({
	projectId,
	projectName,
	hasContent,
	hasUnfinishedProgress,
}: ImplementationOptionsProps) {
	const showToast = useUIStore((s) => s.showToast);

	const [_choice, setChoice] = useState<ImplementationChoice>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [showPromptModal, setShowPromptModal] = useState(false);
	const [promptText, setPromptText] = useState("");
	const [resetDialogOpen, setResetDialogOpen] = useState(false);
	const [isResetting, setIsResetting] = useState(false);

	// Restore choice from sessionStorage on mount (per-project)
	useEffect(() => {
		const stored = sessionStorage.getItem(`prdfy:impl-choice:${projectId}`);
		if (
			stored === "copy_prd" ||
			stored === "download_zip" ||
			stored === "prompt_ai"
		) {
			setChoice(stored);
		}
	}, [projectId]);

	const setAndPersistChoice = useCallback(
		(c: ImplementationChoice) => {
			setChoice(c);
			if (c) sessionStorage.setItem(`prdfy:impl-choice:${projectId}`, c);
		},
		[projectId],
	);

	const fetchContent = useCallback(async () => {
		const res = await fetch("/api/export/prd", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ projectId }),
		});
		if (!res.ok) throw new Error("Gagal mengambil data project");
		return res.json();
	}, [projectId]);

	const handleCopyPrd = useCallback(async () => {
		setIsLoading(true);
		try {
			const data = await fetchContent();
			const text = data.prd || "";

			await navigator.clipboard.writeText(text);
			showToast("PRD berhasil disalin ke clipboard", "success");
			setAndPersistChoice("copy_prd");
		} catch {
			showToast("Gagal menyalin PRD", "error");
		} finally {
			setIsLoading(false);
		}
	}, [fetchContent, showToast, setAndPersistChoice]);

	const handleDownloadZip = useCallback(async () => {
		setIsLoading(true);
		try {
			const res = await fetch("/api/export/zip", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ projectId }),
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error || "Gagal mendownload ZIP");
			}

			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			// Extract filename from Content-Disposition and sanitize against path traversal
			const cd = res.headers.get("Content-Disposition");
			const rawMatch = cd?.match(/filename="?([^";\r\n]+)"?/i)?.[1];
			const safeMatch = rawMatch?.replace(/[^a-zA-Z0-9._-]/g, "_");
			a.download = safeMatch?.endsWith(".zip")
				? safeMatch
				: `prdfy-${projectId}.zip`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);

			showToast("ZIP berhasil didownload", "success");
			setAndPersistChoice("download_zip");
		} catch (err) {
			showToast(
				err instanceof Error ? err.message : "Gagal mendownload ZIP",
				"error",
			);
		} finally {
			setIsLoading(false);
		}
	}, [projectId, showToast, setAndPersistChoice]);

	const buildPromptAndOpen = useCallback(async () => {
		setIsLoading(true);
		try {
			const [data, autoKeyData] = await Promise.all([
				fetchContent(),
				fetch("/api/settings/api-keys/auto", { method: "POST" })
					.then((r) => (r.ok ? r.json() : null))
					.catch(() => null),
			]);
			const apiKey = autoKeyData?.rawKey || "<GANTI_DENGAN_API_KEY_KAMU>";
			const prompt = AI_AGENT_PROMPT_TEMPLATE.replace(
				/{projectName}/g,
				data.projectName || projectName,
			)
				.replace(/{prdContent}/g, data.prd || "(Belum ada PRD)")
				.replace(/{acContent}/g, data.ac || "(Belum ada AC)")
				.replace(/{tasksContent}/g, data.tasks || "(Belum ada tasks)")
				.replace(/{projectId}/g, projectId)
				.replace(/{apiKey}/g, apiKey);

			setPromptText(prompt);
			setShowPromptModal(true);
		} catch {
			showToast("Gagal mengambil data project", "error");
		} finally {
			setIsLoading(false);
		}
	}, [fetchContent, projectName, showToast, projectId]);

	const handlePromptAi = useCallback(async () => {
		if (shouldConfirmReset(hasUnfinishedProgress ?? false)) {
			setResetDialogOpen(true);
			return;
		}
		await buildPromptAndOpen();
	}, [hasUnfinishedProgress, buildPromptAndOpen]);

	const handleConfirmReset = useCallback(async () => {
		setIsResetting(true);
		try {
			const res = await fetch(
				`/api/projects/${encodeURIComponent(projectId)}/reset-progress`,
				{ method: "POST" },
			);
			const json = (await res.json().catch(() => null)) as unknown;
			if (!res.ok) {
				const message =
					json && typeof json === "object" && "error" in json
						? String((json as { error: unknown }).error)
						: "Gagal mereset progress.";
				showToast(message, "error");
				return;
			}
			const tasksReset =
				json && typeof json === "object" && "tasksReset" in json
					? Number((json as { tasksReset: unknown }).tasksReset)
					: 0;
			showToast(
				tasksReset > 0
					? `${tasksReset} task dikembalikan ke pending.`
					: "Tidak ada progress yang perlu direset.",
				"success",
			);
			setResetDialogOpen(false);
			await buildPromptAndOpen();
		} catch {
			showToast("Gagal menghubungi server.", "error");
		} finally {
			setIsResetting(false);
		}
	}, [projectId, showToast, buildPromptAndOpen]);

	const handleCopyPrompt = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(promptText);
			showToast("Prompt disalin. Buka AI coding agent untuk paste.", "success");
			setAndPersistChoice("prompt_ai");
			setShowPromptModal(false);
		} catch {
			showToast("Gagal menyalin prompt", "error");
		}
	}, [promptText, showToast, setAndPersistChoice]);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="outline"
						size="sm"
						disabled={!hasContent || isLoading}
						className="gap-1.5"
					>
						{isLoading ? (
							<Loader2 size={14} className="animate-spin" />
						) : (
							<ChevronDown size={14} />
						)}
						{isLoading ? "Memproses..." : "Pilih Implementasi"}
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-52">
					<DropdownMenuItem onClick={handleCopyPrd} disabled={isLoading}>
						<Copy size={14} className="mr-2 shrink-0" />
						Copy PRD
					</DropdownMenuItem>
					<DropdownMenuItem onClick={handleDownloadZip} disabled={isLoading}>
						<Download size={14} className="mr-2 shrink-0" />
						Download ZIP
					</DropdownMenuItem>
					<DropdownMenuItem onClick={handlePromptAi} disabled={isLoading}>
						<Bot size={14} className="mr-2 shrink-0" />
						Prompt AI Agent
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{/* Prompt AI Agent Modal */}
			<Dialog open={showPromptModal} onOpenChange={setShowPromptModal}>
				<DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Bot size={20} />
							Prompt AI Agent
						</DialogTitle>
						<DialogDescription>
							Salin prompt berikut dan paste ke AI coding agent kamu.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-4">
						{/* Step 1 */}
						<div>
							<p className="mb-2 text-sm font-[510] text-snow">
								Langkah 1: Copy prompt dibawah
							</p>
							<textarea
								readOnly
								aria-label="Salin prompt berikut"
								value={promptText}
								onFocus={(e) => e.target.select()}
								className="h-48 w-full resize-none rounded-md border border-graphite bg-onyx p-3 font-mono text-xs text-fog focus:border-indigo focus:outline-none"
							/>
						</div>

						{/* Step 2 */}
						<div>
							<p className="text-sm font-[510] text-snow">
								Langkah 2: Buka AI coding agent kamu
							</p>
							<p className="text-xs text-fog">
								Claude Code, Cursor, Copilot, Windsurf, atau AI agent lainnya.
							</p>
						</div>

						{/* Step 3 */}
						<div>
							<p className="text-sm font-[510] text-snow">
								Langkah 3: Paste prompt dan mulai implementasi
							</p>
						</div>
					</div>

					<DialogFooter>
						<Button
							variant="default"
							onClick={handleCopyPrompt}
							className="gap-1.5"
						>
							<Copy size={14} />
							Copy & Tutup
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>Reset progress sebelum handoff?</DialogTitle>
						<DialogDescription>
							Beberapa task sudah dikerjakan. Reset status ke{" "}
							<strong>pending</strong> supaya agent mengerjakan semuanya dari
							awal. Task, PRD, dan AC tidak diubah, dan tidak ada kredit yang
							terpakai.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="ghost"
							onClick={() => {
								setResetDialogOpen(false);
								void buildPromptAndOpen();
							}}
							disabled={isResetting}
						>
							Tanpa reset
						</Button>
						<Button
							onClick={() => void handleConfirmReset()}
							disabled={isResetting}
						>
							{isResetting ? "Mereset..." : "Reset lalu lanjut"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
