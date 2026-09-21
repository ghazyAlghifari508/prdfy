"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { buildSyncCommand, type SyncPromptPayload } from "@/lib/codebase-sync";
import { CODEBASE_CLI_MIN_VERSION } from "@/lib/constants";

// Copyable external-agent prompt. The raw sync credential travels ONLY inside
// the textarea value (and the clipboard copy of it): every other surface —
// the command preview, labels, errors — renders the `<token>` placeholder via
// buildSyncCommand so the credential can never leak through a screenshot,
// log, or accidental selection outside the copy action.
export function buildAgentPrompt(
	payload: SyncPromptPayload,
	context?: { projectName?: string },
): string {
	const syncCommand = `prdfy codebase sync --project-id ${payload.projectId} --sync-token ${payload.syncToken}`;
	const headerLines = [
		"Kamu adalah agen AI coding yang berjalan di komputer lokal user. Tugasmu: sinkronkan repositori lokal ke PrdFy memakai CLI resmi.",
	];
	if (context?.projectName) {
		headerLines.push(
			"",
			"Fitur yang sedang direncanakan di PrdFy:",
			`"${context.projectName}"`,
		);
	}

	return [
		...headerLines,
		"",
		"Langkah 1 — Cek CLI. Jalankan `prdfy --version`. Jika perintah tidak tersedia, install dulu:",
		"npm i -g @ghazynabiel/prdfy",
		"",
		`Langkah 2 — Cek versi minimum ${payload.cliMinVersion || CODEBASE_CLI_MIN_VERSION}. Jika versi lebih lama, update:`,
		"npm i -g @ghazynabiel/prdfy",
		"",
		"Langkah 3 — Tinjau file `.prdfyignore` di root repositori. Tambahkan pola eksklusi bila perlu. File ini bersifat lokal — JANGAN commit atau push otomatis.",
		"",
		"Langkah 4 — Pastikan kamu berada di root repositori yang benar, lalu jalankan:",
		"",
		syncCommand,
		"",
		"Info sesi:",
		`- Server PrdFy: ${payload.apiBaseUrl}`,
		`- Project ID: ${payload.projectId}`,
		`- Kedaluwarsa: ${payload.expiresAt}`,
		"",
		"Aturan:",
		"- JANGAN mengubah source code, membuat commit, atau push.",
		"- File rahasia (.env, kunci, sertifikat) serta direktori build/dependensi otomatis dikecualikan — jangan kirim isinya.",
		"- Laporkan status sync apa adanya; jangan mengarang progres persen.",
	].join("\n");
}

interface SyncAgentModalProps {
	open: boolean;
	onClose: () => void;
	payload: SyncPromptPayload | null;
	onRetry?: () => void;
	isRetrying?: boolean;
}

export function SyncAgentModal({
	open,
	onClose,
	payload,
	onRetry,
	isRetrying = false,
}: SyncAgentModalProps) {
	const [copied, setCopied] = useState(false);
	const [copyFailed, setCopyFailed] = useState(false);

	useEffect(() => {
		setCopied(false);
		setCopyFailed(false);
	}, [payload, open]);

	const dialogRef = useFocusTrap<HTMLDivElement>({
		isOpen: open,
		onEscape: onClose,
	});

	if (!open) return null;

	const prompt = payload ? buildAgentPrompt(payload) : null;

	const handleCopy = async () => {
		if (!prompt) return;
		try {
			if (!navigator.clipboard?.writeText) throw new Error("no-clipboard");
			await navigator.clipboard.writeText(prompt);
			setCopied(true);
			setCopyFailed(false);
		} catch {
			setCopied(false);
			setCopyFailed(true);
		}
	};

	return (
		<div
			ref={dialogRef}
			role="dialog"
			aria-modal="true"
			aria-labelledby="sync-agent-modal-title"
			tabIndex={-1}
			className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 animate-in fade-in duration-200"
			onClick={onClose}
		>
			<Card
				className="my-4 w-full max-w-2xl rounded-xl border border-graphite bg-charcoal/95 shadow-2xl backdrop-blur-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<CardHeader>
					<CardTitle id="sync-agent-modal-title">Instruksi Agen Sync</CardTitle>
					<CardDescription>
						Tempel instruksi ini ke agen AI lokal Anda. Kredensial sync hanya
						ada di dalam kolom teks di bawah.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{payload ? (
						<>
							<div className="rounded-md bg-white/5 p-3 font-mono text-xs text-fog">
								{buildSyncCommand(payload.projectId)}
							</div>
							<textarea
								readOnly
								rows={14}
								value={prompt ?? ""}
								className="w-full rounded-md border border-graphite bg-obsidian p-3 font-mono text-xs text-snow"
								aria-label="Instruksi agen sync (berisi kredensial)"
							/>
							{copied && (
								<p className="text-sm text-emerald-400">
									Instruksi tersalin ke clipboard.
								</p>
							)}
							{copyFailed && (
								<p className="text-sm text-crimson">
									Gagal menyalin otomatis. Salin manual dari kolom teks di atas.
								</p>
							)}
							<div className="flex flex-wrap justify-end gap-2">
								{onRetry && (
									<Button
										variant="outline"
										onClick={onRetry}
										isLoading={isRetrying}
									>
										Buat sesi baru
									</Button>
								)}
								<Button variant="ghost" onClick={onClose}>
									Tutup
								</Button>
								<Button onClick={handleCopy}>Salin instruksi</Button>
							</div>
						</>
					) : (
						<div className="flex flex-col items-center gap-3 py-8 text-center">
							<output className="h-6 w-6 animate-spin rounded-full border-2 border-fog border-t-transparent" />
							<p className="text-sm text-fog">
								Menyiapkan sesi sync. Mohon tunggu.
							</p>
							<Button variant="ghost" onClick={onClose}>
								Tutup
							</Button>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
