"use client";

import { AlertCircle, Check, Circle, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	type CodebaseSyncStatus,
	isTerminalSyncStatus,
	type SyncStatusResponse,
	syncStatusResponseSchema,
} from "@/lib/codebase-sync";
import { CODEBASE_SYNC_POLL_INTERVAL_MS } from "@/lib/constants";

const STATUS_LABEL: Record<CodebaseSyncStatus, string> = {
	waiting_for_cli: "Menunggu CLI",
	connected: "CLI terhubung",
	scanning: "Memindai repositori",
	filtering: "Memfilter file",
	uploading: "Mengupload snapshot",
	uploaded: "Snapshot terupload",
	analyzing: "Menganalisis codebase",
	ready: "Siap",
	failed: "Sync gagal",
	expired: "Sesi kedaluwarsa",
};

const STATUS_HINT: Partial<Record<CodebaseSyncStatus, string>> = {
	waiting_for_cli: "Jalankan perintah sync di agen lokal Anda.",
	connected: "CLI terhubung. Menunggu pemindaian repositori.",
	scanning: "CLI sedang memindai file repositori.",
	filtering: "Menerapkan filter keamanan dan .prdfyignore.",
	uploading: "Snapshot sedang diupload dalam beberapa bagian.",
	uploaded: "Snapshot lengkap. Analisis dapat dimulai.",
	analyzing: "Model AI sedang menganalisis snapshot.",
	ready: "Codebase siap dipakai sebagai konteks generasi.",
	failed: "Terjadi kegagalan. Anda dapat mengulang sync.",
	expired: "Sesi sync kedaluwarsa. Buat sesi baru untuk lanjut.",
};

function formatTimestamp(value?: string): string | null {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return date.toLocaleString("id-ID");
}

interface StepItem {
	id: string;
	title: string;
	subtext?: string;
	state: "done" | "live" | "pending" | "failed";
}

function deriveSyncSteps(status: SyncStatusResponse): StepItem[] {
	const s = status.status;
	const isFailed = s === "failed" || s === "expired";

	// Step 1: Koneksi CLI
	let step1State: StepItem["state"] = "done";
	let step1Title = "Agen AI & PrdFy CLI terhubung";
	let step1Subtext: string | undefined = "Koneksi handshake terverifikasi";

	if (s === "waiting_for_cli") {
		step1State = "live";
		step1Title = "Menunggu CLI dijalankan di repositori lokal";
		step1Subtext = "Salin dan jalankan perintah sync di terminal agen AI Anda";
	} else if (isFailed && status.fileCount === undefined) {
		step1State = "failed";
		step1Title = STATUS_LABEL[s];
		step1Subtext = status.errorMessage || "Terjadi kesalahan pada sesi sync";
	}

	// Step 2: Pemindaian & Filter Keamanan
	let step2State: StepItem["state"] = "pending";
	let step2Title = "Pemindaian struktur repositori & filter keamanan";
	let step2Subtext: string | undefined = undefined;

	if (status.excludedCount !== undefined) {
		step2State = "done";
		step2Title = "Struktur repositori dipindai & filter keamanan aktif";
		step2Subtext = `${status.excludedCount.toLocaleString("id-ID")} file dependencies/build/secrets dikecualikan`;
	} else if (s === "connected" || s === "scanning" || s === "filtering") {
		step2State = "live";
		step2Title = "Memindai repositori & mengecualikan file rahasia/build";
		step2Subtext = "Membaca manifest proyek dan menerapkan aturan .prdfyignore";
	} else if (s === "failed") {
		step2State = "failed";
		step2Title = "Pemindaian repositori gagal";
		step2Subtext = status.errorMessage || undefined;
	}

	// Step 3: Pengunggahan Snapshot
	let step3State: StepItem["state"] = "pending";
	let step3Title = "Pengiriman snapshot source code ke server";
	let step3Subtext: string | undefined = undefined;

	if (status.fileCount !== undefined) {
		step3State = "done";
		step3Title = "Snapshot source code berhasil diunggah";
		step3Subtext = `${status.fileCount.toLocaleString("id-ID")} file terpilih terverifikasi`;
	} else if (s === "uploading") {
		step3State = "live";
		step3Title = "Mengupload snapshot source code ke PrdFy...";
		step3Subtext = "Mengirim pecahan berkas terenkripsi secara bertahap";
	} else if (s === "failed" && status.fileCount === undefined && status.excludedCount !== undefined) {
		step3State = "failed";
		step3Title = "Pengunggahan snapshot gagal";
		step3Subtext = status.errorMessage || undefined;
	}

	// Step 4: Analisis AI
	let step4State: StepItem["state"] = "pending";
	let step4Title = "Analisis arsitektur & dependensi oleh AI";
	let step4Subtext: string | undefined = undefined;

	if (status.analysisStatus === "failed") {
		step4State = "failed";
		step4Title = "Analisis codebase gagal";
		step4Subtext =
			status.errorMessage ||
			"Model AI gagal menyelesaikan analisis snapshot. Anda dapat mengulang analisis.";
	} else if (status.analysisStatus === "ready" || s === "ready") {
		step4State = "done";
		step4Title = "Analisis arsitektur selesai & siap";
		step4Subtext = "Konteks aplikasi siap ditinjau sebelum masuk ke tahap Ask";
	} else if (
		s === "uploaded" ||
		s === "analyzing" ||
		status.analysisStatus === "pending"
	) {
		step4State = "live";
		step4Title = "Model AI sedang menganalisis arsitektur & modul...";
		step4Subtext =
			"Mendeteksi framework, pustaka utama, skema data, dan area dampak";
	}

	return [
		{ id: "step-1", title: step1Title, subtext: step1Subtext, state: step1State },
		{ id: "step-2", title: step2Title, subtext: step2Subtext, state: step2State },
		{ id: "step-3", title: step3Title, subtext: step3Subtext, state: step3State },
		{ id: "step-4", title: step4Title, subtext: step4Subtext, state: step4State },
	];
}

interface SyncStatusProps {
	projectId: string;
	sessionId?: string;
	pollIntervalMs?: number;
	onStatus?: (status: SyncStatusResponse | null) => void;
	onRetrySync?: () => void;
	onRetryAnalysis?: () => void;
}

export function SyncStatus({
	projectId,
	sessionId,
	pollIntervalMs = CODEBASE_SYNC_POLL_INTERVAL_MS,
	onStatus,
	onRetrySync,
	onRetryAnalysis,
}: SyncStatusProps) {
	const [status, setStatus] = useState<SyncStatusResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const onStatusRef = useRef(onStatus);
	onStatusRef.current = onStatus;

	useEffect(() => {
		let cancelled = false;

		const fetchStatus = async () => {
			try {
				const query = sessionId
					? `?sessionId=${encodeURIComponent(sessionId)}`
					: "";
				const res = await fetch(
					`/api/codebase/${encodeURIComponent(projectId)}/status${query}`,
				);
				const json = (await res.json().catch(() => null)) as unknown;
				if (cancelled) return;
				if (!res.ok) {
					const message =
						json && typeof json === "object" && "error" in json
							? String((json as { error: unknown }).error)
							: "Gagal membaca status sync.";
					setError(message);
					setIsLoading(false);
					onStatusRef.current?.(null);
					return;
				}
				const parsed = syncStatusResponseSchema.safeParse(json);
				if (!parsed.success) {
					setError("Gagal membaca status sync.");
					setIsLoading(false);
					onStatusRef.current?.(null);
					return;
				}
				setStatus(parsed.data);
				setError(null);
				setIsLoading(false);
				onStatusRef.current?.(parsed.data);
				if (isTerminalSyncStatus(parsed.data.status) && timerRef.current) {
					clearInterval(timerRef.current);
					timerRef.current = null;
				}
			} catch {
				if (cancelled) return;
				setError("Gagal menghubungi server.");
				setIsLoading(false);
				onStatusRef.current?.(null);
			}
		};

		void fetchStatus();
		timerRef.current = setInterval(() => {
			void fetchStatus();
		}, pollIntervalMs);
		return () => {
			cancelled = true;
			if (timerRef.current) {
				clearInterval(timerRef.current);
				timerRef.current = null;
			}
		};
	}, [projectId, sessionId, pollIntervalMs]);

	const isTerminal = status ? isTerminalSyncStatus(status.status) : false;
	const showRetry = status?.status === "failed" || status?.status === "expired";
	const showAnalysisRetry = status?.analysisStatus === "failed";
	const steps = status ? deriveSyncSteps(status) : [];

	return (
		<div className="rounded-xl border border-graphite bg-card p-5 shadow-md backdrop-blur-md transition-all sm:p-6 text-card-foreground">
			{/* Panel Header */}
			<div className="flex flex-wrap items-center justify-between gap-3 border-b border-graphite pb-4">
				<div className="flex items-center gap-3">
					<div className="flex h-8 w-8 items-center justify-center rounded-lg border border-iron bg-muted text-mist">
						{status?.status === "ready" ? (
							<Check size={16} className="text-emerald-600 dark:text-emerald-400" />
						) : !isTerminal ? (
							<Loader2 size={16} className="animate-spin text-blue-600 dark:text-blue-400" />
						) : (
							<AlertCircle size={16} className="text-crimson" />
						)}
					</div>
					<div>
						<h3 className="font-inter text-base font-[550] text-snow">
							Status Sinkronisasi & Analisis
						</h3>
						<p className="text-xs text-fog">
							Status aktual dari server, diperbarui otomatis secara real-time.
						</p>
					</div>
				</div>

				{status && (
					<div className="flex items-center gap-2">
						<span
							className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
								status.status === "ready"
									? "border border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
									: !isTerminal
										? "border border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300"
										: "border border-crimson/30 bg-crimson/10 text-crimson"
							}`}
						>
							<span
								className={`h-1.5 w-1.5 rounded-full ${
									status.status === "ready"
										? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"
										: !isTerminal
											? "animate-ping bg-blue-500"
											: "bg-crimson"
								}`}
							/>
							{STATUS_LABEL[status.status]}
						</span>
					</div>
				)}
			</div>

			{/* Content Area */}
			<div className="mt-5 flex flex-col gap-4">
				{isLoading && !status ? (
					<div className="flex items-center gap-3 py-6 text-center justify-center">
						<Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />
						<p className="text-sm text-fog">Menghubungi server dan memuat status...</p>
					</div>
				) : error && !status ? (
					<div className="rounded-lg border border-crimson/30 bg-crimson/10 p-4 text-sm text-crimson">
						{error}
					</div>
				) : status ? (
					<>
						{/* Real-Signal Status Checklist */}
						<div className="flex flex-col gap-2.5">
							{steps.map((step) => {
								let rowStyles =
									"border-graphite bg-muted/40 text-fog";
								let icon = <Circle size={15} className="text-slate shrink-0" />;

								if (step.state === "done") {
									rowStyles =
										"border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-950/30 dark:text-emerald-200";
									icon = (
										<Check size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
									);
								} else if (step.state === "live") {
									rowStyles =
										"border-blue-200 bg-blue-50/80 text-blue-950 dark:border-blue-500/30 dark:bg-blue-950/40 dark:text-blue-100 shadow-sm";
									icon = (
										<Loader2
											size={15}
											className="animate-spin text-blue-600 dark:text-blue-400 shrink-0"
										/>
									);
								} else if (step.state === "failed") {
									rowStyles =
										"border-crimson/30 bg-crimson/10 text-crimson";
									icon = (
										<AlertCircle size={15} className="text-crimson shrink-0" />
									);
								}

								return (
									<div
										key={step.id}
										className={`flex items-start gap-3 rounded-lg border p-3 text-xs transition-colors duration-200 ${rowStyles}`}
									>
										<div className="mt-0.5">{icon}</div>
										<div className="flex flex-1 flex-col gap-0.5">
											<span className="font-semibold text-snow">{step.title}</span>
											{step.subtext && (
												<span className="text-[11px] text-fog">
													{step.subtext}
												</span>
											)}
										</div>
									</div>
								);
							})}
						</div>

						{/* Real Server Metrics Grid */}
						<div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-graphite bg-muted/30 p-3 text-xs sm:grid-cols-4">
							{status.fileCount !== undefined && (
								<div className="flex flex-col gap-1">
									<span className="text-[10px] uppercase font-mono text-slate">
										File terupload
									</span>
									<span className="font-medium text-snow font-mono">
										{status.fileCount}
									</span>
								</div>
							)}
							{status.excludedCount !== undefined && (
								<div className="flex flex-col gap-1">
									<span className="text-[10px] uppercase font-mono text-slate">
										File dieksklusi
									</span>
									<span className="font-medium text-snow font-mono">
										{status.excludedCount}
									</span>
								</div>
							)}
							{formatTimestamp(status.updatedAt) && (
								<div className="flex flex-col gap-1">
									<span className="text-[10px] uppercase font-mono text-slate">
										Diperbarui
									</span>
									<span className="font-medium text-fog">
										{formatTimestamp(status.updatedAt)}
									</span>
								</div>
							)}
							{formatTimestamp(status.expiresAt) && (
								<div className="flex flex-col gap-1">
									<span className="text-[10px] uppercase font-mono text-slate">
										Sesi berakhir
									</span>
									<span className="font-medium text-fog">
										{formatTimestamp(status.expiresAt)}
									</span>
								</div>
							)}
						</div>

						{/* Hints & Errors */}
						{STATUS_HINT[status.status] && (
							<p className="text-xs text-fog italic px-1">
								{STATUS_HINT[status.status]}
							</p>
						)}

						{status.errorMessage && (
							<div className="rounded-md border border-crimson/30 bg-crimson/10 p-3 text-xs text-crimson flex items-center gap-2">
								<AlertCircle size={14} className="shrink-0" />
								<span>{status.errorMessage}</span>
							</div>
						)}

						{/* Retry Actions */}
						{showRetry && (
							<div className="flex justify-end pt-1">
								<Button
									variant="outline"
									onClick={onRetrySync}
									className="border-iron bg-surface text-xs hover:bg-muted text-mist"
								>
									<RefreshCw size={13} className="mr-1.5" />
									{status.status === "expired"
										? "Buat sesi baru"
										: "Coba sync ulang"}
								</Button>
							</div>
						)}

						{showAnalysisRetry && (
							<div className="flex justify-end pt-1">
								<Button
									variant="outline"
									onClick={onRetryAnalysis}
									className="border-iron bg-surface text-xs hover:bg-muted text-mist"
								>
									<RefreshCw size={13} className="mr-1.5" />
									Analisis ulang
								</Button>
							</div>
						)}
					</>
				) : null}
			</div>
		</div>
	);
}
