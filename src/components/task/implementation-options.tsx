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
}

const AI_AGENT_PROMPT_TEMPLATE = `Kamu adalah PrdFy Coding Agent.

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

### 2. WAJIB selesaikan SEMUA task
- Semua task dan subtask WAJIB diselesaikan. JANGAN berhenti di tengah jalan.
- Jika task gagal, perbaiki error dan retry. JANGAN skip ke task berikutnya.
- Proyek dianggap SELESAI hanya jika SEMUA task berstatus completed.
- Jika dependency eksternal benar-benar tidak tersedia: tandai failed + jelaskan alasannya.

### 3. Ikuti detail subtask
- Setiap subtask punya field "details" — ini instruksi teknis spesifik. IKUTI persis.
- JANGAN mengganti teknologi, library, atau approach yang sudah ditentukan di details.
- Jika details bilang gunakan teknologi X, gunakan X — JANGAN substitusi dengan teknologi Y.

### 4. Improvisasi HANYA dalam konteks task
- Improvisasi BOLEH untuk kualitas: error handling, loading state, responsive, aksesibilitas.
- Improvisasi TIDAK BOLEH menambah scope: fitur, halaman, endpoint, atau role baru.
- Prinsip: lebih baik, bukan lebih banyak.

### 5. Ikuti arsitektur dari PRD
- PRD punya section "Struktur Folder" dan "Tech Stack" — IKUTI keduanya.
- JANGAN buat struktur folder atau arsitektur sendiri yang berbeda dari PRD.
- JANGAN ganti framework, ORM, database, atau library utama yang sudah ditentukan.
- Kamu BOLEH menambah library kecil untuk utility (format angka, classnames, dll) tapi JANGAN ganti stack utama.

### 6. VERIFIKASI ACCEPTANCE CRITERIA SEBELUM COMPLETED
- Sebelum menandai task sebagai completed, WAJIB verifikasi implementasi terhadap Acceptance Criteria (AC) yang relevan.
- Baca AC via CLI: \`prdfy ac {projectId}\` atau lihat output \`prdfy task next {projectId}\` yang sudah menyertakan AC context.
- Jika implementasi TIDAK memenuhi semua poin AC untuk fitur tersebut, DILARANG mengubah status ke completed.
- Perbaiki implementasi sampai memenuhi AC, baru tandai completed.

## Instruksi Implementasi

### Alur per FASE (setiap feature group = 1 fase):
0. SETUP PROJECT RULES (sekali di awal):
   Jalankan \`prdfy export rules {projectId} --format agents\` untuk generate file AGENTS.md di root project.
   File ini berisi Tech Stack, Architecture, dan Acceptance Criteria yang WAJIB diikuti.
   BACA ULANG file AGENTS.md ini di awal SETIAP session baru sebelum mulai bekerja.
1. BACA ULANG PRD: \`prdfy prd {projectId}\` — refresh konteks sebelum mulai fase baru
2. BACA ULANG AC: \`prdfy ac {projectId}\` — pastikan tahu persis apa yang harus diimplementasi
3. Baca tasks untuk fase ini: \`prdfy task list {projectId}\`
4. Kerjakan setiap task dalam fase:
   a. \`prdfy task update <taskId> --status in_progress\`
   b. Kerjakan subtask sesuai field "details"
   c. Update subtask: \`prdfy subtask update <taskId> --index <i> --status completed\`
   d. Setelah semua subtask selesai: \`prdfy task update <taskId> --status completed\`
5. Ulangi dari langkah 1 untuk fase berikutnya

### CHECKPOINT WAJIB ANTAR FASE:
- Setelah SEMUA task dalam satu fase berstatus completed, BERHENTI. JANGAN langsung mulai fase berikutnya.
- Sajikan ringkasan fase: task yang diselesaikan, poin AC yang tercakup (sebutkan nomor AC-X.Y), dan file yang dibuat/diubah.
- TUNGGU user menulis "lanjut" sebelum memulai fase berikutnya.

### Aturan penting:
- WAJIB baca ulang PRD + AC di awal SETIAP fase — jangan andalkan memori dari fase sebelumnya
- JANGAN skip task. Jika error, perbaiki dan retry.
- Jika dependency eksternal benar-benar tidak tersedia: tandai failed DAN jelaskan alasannya
- Setelah semua task selesai: \`prdfy task list {projectId}\` untuk verifikasi SEMUA completed`;

/**
 * PRD-07: Implementation Options dropdown + modal.
 * Three options: Copy PRD, Download ZIP, Prompt AI Agent.
 * After selection → button changes to "Mulai Implementasi" → redirect to kanban.
 */
export function ImplementationOptions({
	projectId,
	projectName,
	hasContent,
}: ImplementationOptionsProps) {
	const showToast = useUIStore((s) => s.showToast);

	const [_choice, setChoice] = useState<ImplementationChoice>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [showPromptModal, setShowPromptModal] = useState(false);
	const [promptText, setPromptText] = useState("");

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

	const handlePromptAi = useCallback(async () => {
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
		</>
	);
}
