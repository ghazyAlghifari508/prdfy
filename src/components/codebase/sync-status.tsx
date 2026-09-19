"use client";

import { AlertCircle, Check, Circle, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

interface SyncStatusProps {
	projectId: string;
	sessionId?: string;
	projectName?: string;
	status?: SyncStatusResponse | null;
	pollIntervalMs?: number;
	onStatus?: (status: SyncStatusResponse | null) => void;
	onRetrySync?: () => void;
	onRetryAnalysis?: () => void;
	onViewReview?: () => void;
	onBackToInstructions?: () => void;
}

export function SyncStatus({
	projectId,
	sessionId,
	projectName = "Project",
	status: propStatus,
	pollIntervalMs = CODEBASE_SYNC_POLL_INTERVAL_MS,
	onStatus,
	onRetrySync,
	onRetryAnalysis,
	onViewReview,
	onBackToInstructions: _onBackToInstructions,
}: SyncStatusProps) {
	const [polledStatus, setPolledStatus] = useState<SyncStatusResponse | null>(
		propStatus ?? null,
	);
	const status = propStatus !== undefined ? propStatus : polledStatus;
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(propStatus === undefined);
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
				setPolledStatus(parsed.data);
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

	const s = status?.status ?? "waiting_for_cli";
	const isFailed = s === "failed";
	const isExpired = s === "expired";
	const isReady = s === "ready" || status?.analysisStatus === "ready";
	const isAnalyzing =
		s === "analyzing" ||
		status?.analysisStatus === "pending" ||
		(s === "uploaded" && !isReady && !status?.analysisStatus);
	const isUploading = s === "uploading";
	const isConnected = s !== "waiting_for_cli" && !isFailed && !isExpired;

	const showRetry = isFailed || isExpired;
	const showAnalysisRetry = status?.analysisStatus === "failed";

	return (
		<div className="w-full animate-enter flex flex-col gap-6">
			{/* Page Head matching existing-codebase-flow.html screen 03 */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<div className="text-[11px] font-mono tracking-widest uppercase text-fog mb-2">
						PROJECT / {projectName.toUpperCase()}
					</div>
					<h1 className="font-inter text-2xl sm:text-3xl font-[620] tracking-tight text-snow leading-tight">
						Sync codebase
					</h1>
					<p className="mt-2 text-xs sm:text-sm text-fog max-w-xl leading-relaxed">
						AI agent sedang menjalankan PrdFy CLI. Kamu bisa tetap melihat
						terminal agent untuk detail proses.
					</p>
				</div>
				<span className="inline-flex items-center gap-2 rounded-full border border-iron bg-charcoal/80 px-3 py-1.5 text-xs text-fog backdrop-blur-md self-start sm:self-auto">
					<span
						className={`h-1.5 w-1.5 rounded-full ${
							isReady
								? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
								: isConnected
									? "bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]"
									: isFailed || isExpired
										? "bg-crimson shadow-[0_0_8px_rgba(235,87,87,0.8)]"
										: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
						}`}
					/>
					{isReady
						? "Sync selesai"
						: isConnected
							? "Agent terhubung"
							: isExpired
								? "Sesi kedaluwarsa"
								: isFailed
									? "Sync gagal"
									: "Menunggu koneksi"}
				</span>
			</div>

			{/* Main Status Panel */}
			<div className="rounded-xl border border-graphite bg-charcoal/90 shadow-2xl backdrop-blur-md overflow-hidden">
				{/* Panel Head */}
				<div className="flex items-center justify-between border-b border-graphite p-5 sm:p-6">
					<div>
						<h3 className="font-inter text-sm sm:text-base font-[620] text-snow">
							Analisis repository lokal
						</h3>
						<p className="mt-1 font-mono text-[11px] text-fog">
							{status?.sessionId
								? `Sync ID: ${status.sessionId.slice(0, 12)}...`
								: "Menghubungi server..."}
							{status?.updatedAt &&
								` · ${new Date(status.updatedAt).toLocaleTimeString("id-ID")}`}
						</p>
					</div>
					<span className="font-mono text-xs text-fog">
						{isReady
							? "Siap"
							: isAnalyzing
								? "Menganalisis"
								: isUploading
									? "Mengupload"
									: isConnected
										? "Terhubung"
										: "Menunggu"}
					</span>
				</div>

				{/* Panel Body */}
				<div className="p-5 sm:p-6 flex flex-col gap-5">
					{/* Status List */}
					<div className="flex flex-col gap-2.5">
						{/* Item 1: Root repository */}
						<div
							className={`flex items-center gap-2.5 rounded-md border p-3 text-xs transition-colors ${
								isConnected || isReady || isUploading || isAnalyzing
									? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
									: s === "waiting_for_cli"
										? "border-blue-500/25 bg-blue-500/10 text-blue-200"
										: "border-graphite text-fog"
							}`}
						>
							{isConnected || isReady || isUploading || isAnalyzing ? (
								<Check size={14} className="text-emerald-400 font-bold shrink-0" />
							) : (
								<Loader2 size={14} className="text-blue-400 animate-spin shrink-0" />
							)}
							<span className="font-medium">
								{isConnected || isReady || isUploading || isAnalyzing
									? "Repository root terdeteksi"
									: "Menunggu koneksi CLI dari terminal lokal"}
							</span>
						</div>

						{/* Item 2: Package manifest & framework */}
						<div
							className={`flex items-center gap-2.5 rounded-md border p-3 text-xs transition-colors ${
								status?.fileCount !== undefined ||
								status?.excludedCount !== undefined ||
								isReady
									? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
									: isConnected
										? "border-blue-500/25 bg-blue-500/10 text-blue-200"
										: "border-graphite text-slate"
							}`}
						>
							{status?.fileCount !== undefined ||
							status?.excludedCount !== undefined ||
							isReady ? (
								<Check size={14} className="text-emerald-400 font-bold shrink-0" />
							) : isConnected ? (
								<Loader2 size={14} className="text-blue-400 animate-spin shrink-0" />
							) : (
								<Circle size={14} className="text-slate shrink-0" />
							)}
							<span className="font-medium">
								Package manifest dan framework dibaca
							</span>
						</div>

						{/* Item 3: Secrets & generated files */}
						<div
							className={`flex items-center gap-2.5 rounded-md border p-3 text-xs transition-colors ${
								status?.excludedCount !== undefined
									? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
									: isConnected
										? "border-blue-500/25 bg-blue-500/10 text-blue-200"
										: "border-graphite text-slate"
							}`}
						>
							{status?.excludedCount !== undefined ? (
								<Check size={14} className="text-emerald-400 font-bold shrink-0" />
							) : isConnected ? (
								<Loader2 size={14} className="text-blue-400 animate-spin shrink-0" />
							) : (
								<Circle size={14} className="text-slate shrink-0" />
							)}
							<span className="font-medium">
								Secrets dan generated files dikecualikan
							</span>
							{status?.excludedCount !== undefined && (
								<span className="ml-auto font-mono text-[11px] opacity-80">
									{status.excludedCount} file
								</span>
							)}
						</div>

						{/* Item 4: Sending source context */}
						<div
							className={`flex items-center gap-2.5 rounded-md border p-3 text-xs transition-colors ${
								isReady ||
								(status?.fileCount !== undefined &&
									status?.status !== "uploading")
									? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
									: isUploading
										? "border-blue-500/25 bg-blue-500/10 text-blue-200"
										: "border-graphite text-slate"
							}`}
						>
							{isReady ||
							(status?.fileCount !== undefined &&
								status?.status !== "uploading") ? (
								<Check size={14} className="text-emerald-400 font-bold shrink-0" />
							) : isUploading ? (
								<Loader2 size={14} className="text-blue-400 animate-spin shrink-0" />
							) : (
								<Circle size={14} className="text-slate shrink-0" />
							)}
							<span className="font-medium">
								Mengirim source context yang relevan ke PrdFy
							</span>
							{status?.fileCount !== undefined && (
								<span className="ml-auto font-mono text-[11px] opacity-80">
									{status.fileCount} file
								</span>
							)}
						</div>

						{/* Item 5: Codebase analysis */}
						<div
							className={`flex items-center gap-2.5 rounded-md border p-3 text-xs transition-colors ${
								isReady
									? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
									: isAnalyzing
										? "border-blue-500/25 bg-blue-500/10 text-blue-200"
										: showAnalysisRetry
											? "border-crimson/30 bg-crimson/10 text-crimson"
											: "border-graphite text-slate"
							}`}
						>
							{isReady ? (
								<Check size={14} className="text-emerald-400 font-bold shrink-0" />
							) : isAnalyzing ? (
								<Loader2 size={14} className="text-blue-400 animate-spin shrink-0" />
							) : showAnalysisRetry ? (
								<AlertCircle size={14} className="text-crimson shrink-0" />
							) : (
								<Circle size={14} className="text-slate shrink-0" />
							)}
							<span className="font-medium">
								{isReady
									? "Menyusun codebase analysis (selesai)"
									: isAnalyzing
										? "Menyusun codebase analysis..."
										: showAnalysisRetry
											? "Menyusun codebase analysis gagal"
											: "Menyusun codebase analysis"}
							</span>
						</div>
					</div>

					{/* Error Message if any */}
					{status?.errorMessage && (
						<div className="rounded-md border border-crimson/30 bg-crimson/10 p-3 text-xs text-crimson">
							{status.errorMessage}
						</div>
					)}
					{error && (
						<div className="rounded-md border border-crimson/30 bg-crimson/10 p-3 text-xs text-crimson">
							{error}
						</div>
					)}

					{/* Footer Bar */}
					<div className="flex flex-wrap items-center justify-between gap-3 border-t border-graphite pt-4 text-xs text-fog">
						<p className="text-[11px]">Progress berasal dari event CLI yang nyata.</p>
						<div className="flex items-center gap-2">
							{showRetry && onRetrySync && (
								<button
									type="button"
									onClick={onRetrySync}
									className="rounded border border-iron bg-obsidian px-3 py-1.5 text-xs text-mist hover:text-snow transition hover:bg-steel"
								>
									Coba sync ulang
								</button>
							)}

							{showAnalysisRetry && onRetryAnalysis && (
								<button
									type="button"
									onClick={onRetryAnalysis}
									className="rounded border border-iron bg-obsidian px-3 py-1.5 text-xs text-mist hover:text-snow transition hover:bg-steel"
								>
									Analisis ulang
								</button>
							)}

							{isReady && onViewReview && (
								<button
									type="button"
									onClick={onViewReview}
									className="inline-flex items-center gap-1.5 rounded bg-snow px-3.5 py-1.5 font-inter text-xs font-semibold text-onyx shadow-sm hover:brightness-110 transition"
								>
									<span>Lihat hasil analisis</span>
									<span className="font-mono text-xs">-&gt;</span>
								</button>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
