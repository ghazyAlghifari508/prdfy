"use client";

import { AlertCircle, Check, Circle, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	isTerminalSyncStatus,
	type SyncStatusResponse,
	syncStatusResponseSchema,
} from "@/lib/codebase-sync";
import { CODEBASE_SYNC_POLL_INTERVAL_MS } from "@/lib/constants";

interface SyncStatusProps {
	projectId: string;
	statusPath?: string;
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
	statusPath,
	sessionId,
	projectName = "Project",
	status: propStatus,
	pollIntervalMs = CODEBASE_SYNC_POLL_INTERVAL_MS,
	onStatus,
	onRetrySync,
	onRetryAnalysis,
	onViewReview,
	onBackToInstructions,
}: SyncStatusProps) {
	const [polledStatus, setPolledStatus] = useState<SyncStatusResponse | null>(
		propStatus ?? null,
	);
	const status = propStatus !== undefined ? propStatus : polledStatus;
	const [error, setError] = useState<string | null>(null);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const inFlightRef = useRef(false);
	const onStatusRef = useRef(onStatus);
	onStatusRef.current = onStatus;
	// A controlled parent owns polling and passes every update down; an
	// internal poller here would double every request.
	const pollInternally = propStatus === undefined;

	useEffect(() => {
		if (!pollInternally) return;
		let cancelled = false;

		const fetchStatus = async () => {
			// One request at a time: a slow response must never be
			// overwritten by (or overwrite) a newer tick out of order.
			if (inFlightRef.current || cancelled) return;
			inFlightRef.current = true;
			let isTerminal = false;
			try {
				const query = sessionId
					? `?sessionId=${encodeURIComponent(sessionId)}`
					: "";
				const path =
					statusPath ?? `/api/codebase/${encodeURIComponent(projectId)}/status`;
				const res = await fetch(`${path}${query}`);
				const json = (await res.json().catch(() => null)) as unknown;
				if (cancelled) return;
				if (!res.ok) {
					const message =
						typeof json === "object" &&
						json !== null &&
						"error" in json &&
						typeof json.error === "string"
							? json.error
							: "Gagal membaca status sync.";
					setError(message);
					onStatusRef.current?.(null);
					return;
				}
				const parsed = syncStatusResponseSchema.safeParse(json);
				if (!parsed.success) {
					setError("Gagal membaca status sync.");
					onStatusRef.current?.(null);
					return;
				}
				setPolledStatus(parsed.data);
				setError(null);
				onStatusRef.current?.(parsed.data);
				if (isTerminalSyncStatus(parsed.data.status)) {
					isTerminal = true;
				}
			} catch {
				if (cancelled) return;
				setError("Gagal menghubungi server.");
				onStatusRef.current?.(null);
			} finally {
				inFlightRef.current = false;
				if (!cancelled && !isTerminal) {
					timeoutRef.current = setTimeout(() => {
						void fetchStatus();
					}, pollIntervalMs);
				}
			}
		};

		void fetchStatus();
		return () => {
			cancelled = true;
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
				timeoutRef.current = null;
			}
		};
	}, [projectId, statusPath, sessionId, pollIntervalMs, pollInternally]);

	const s = status?.status ?? "waiting_for_cli";
	const isFailed = s === "failed";
	const isExpired = s === "expired";
	// Ready means the sync session itself completed with a usable
	// analysis: a ready analysis attached to a failed/expired session is
	// stale, not a success.
	const isReady =
		!isFailed &&
		!isExpired &&
		(s === "ready" ||
			(status?.analysisStatus === "ready" && s !== "waiting_for_cli"));
	const isAnalyzing =
		s === "analyzing" ||
		status?.analysisStatus === "pending" ||
		(s === "uploaded" && !isReady && !status?.analysisStatus);
	const isUploading = s === "uploading";
	const isConnected = s !== "waiting_for_cli" && !isFailed && !isExpired;

	// Three stages, each driven by a signal this client can actually observe.
	// `scanning` and `filtering` are deliberately NOT shown: the CLI never
	// reports them (the server walks them as bookkeeping), so a stage for them
	// would be an invented sequence rather than a real status.
	const uploadStarted =
		isUploading ||
		isAnalyzing ||
		isReady ||
		(status?.fileCount !== undefined && s !== "uploaded");
	const uploadDone = isAnalyzing || isReady || status?.status === "uploaded";
	const analysisDone = isReady;
	const analysisFailed = status?.analysisStatus === "failed";

	const showRetry = isFailed || isExpired;
	const showAnalysisRetry = analysisFailed;

	type StageState = "done" | "active" | "failed" | "pending";
	const stageClass: Record<StageState, string> = {
		done: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
		active: "border-blue-500/25 bg-blue-500/10 text-blue-200",
		failed: "border-crimson/30 bg-crimson/10 text-crimson",
		pending: "border-graphite text-slate",
	};
	const StageIcon = ({ state }: { state: StageState }) =>
		state === "done" ? (
			<Check size={14} className="text-emerald-400 font-bold shrink-0" />
		) : state === "active" ? (
			<Loader2 size={14} className="text-blue-400 animate-spin shrink-0" />
		) : state === "failed" ? (
			<AlertCircle size={14} className="text-crimson shrink-0" />
		) : (
			<Circle size={14} className="text-slate shrink-0" />
		);

	const connectionStage: StageState = isExpired
		? "failed"
		: isConnected
			? "done"
			: "active";
	const uploadStage: StageState = !isConnected
		? "pending"
		: uploadDone
			? "done"
			: uploadStarted
				? "active"
				: "pending";
	const analysisStage: StageState = analysisFailed
		? "failed"
		: analysisDone
			? "done"
			: isConnected
				? "active"
				: "pending";

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
						PrdFy CLI menjalankan sync dari repositori lokal kamu. Perintahnya
						berjalan di terminal agent — progress di bawah mengikuti status
						server yang sebenarnya.
					</p>
				</div>
				<span className="inline-flex items-center gap-2 rounded-full border border-iron bg-charcoal/80 px-3 py-1.5 text-xs text-fog backdrop-blur-md self-start sm:self-auto">
					<span
						className={`h-1.5 w-1.5 rounded-full ${
							isReady
								? "bg-emerald-400"
								: isConnected
									? "bg-blue-400"
									: isFailed || isExpired
										? "bg-crimson"
										: "bg-amber-400"
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
			<div className="rounded-xl border border-graphite bg-charcoal/90 overflow-hidden">
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
					{/* Status List — three stages, each backed by a real signal */}
					<div className="flex flex-col gap-2.5">
						{/* Stage 1: CLI handshake (session left waiting_for_cli) */}
						<div
							className={`flex items-center gap-2.5 rounded-md border p-3 text-xs transition-colors ${stageClass[connectionStage]}`}
						>
							<StageIcon state={connectionStage} />
							<span className="font-medium">
								{isConnected
									? "CLI terhubung dan repository root terdeteksi"
									: isExpired
										? "Sesi kedaluwarsa sebelum CLI terhubung"
										: "Menunggu CLI dari terminal lokal"}
							</span>
						</div>

						{/* Stage 2: snapshot upload (status uploading or later) */}
						<div
							className={`flex items-center gap-2.5 rounded-md border p-3 text-xs transition-colors ${stageClass[uploadStage]}`}
						>
							<StageIcon state={uploadStage} />
							<span className="font-medium">
								{uploadDone
									? "Snapshot terkirim dan terverifikasi"
									: "Mengirim snapshot source context"}
							</span>
							{status?.fileCount !== undefined && (
								<span className="ml-auto font-mono text-[11px] opacity-80">
									{status.fileCount} file
								</span>
							)}
						</div>

						{/* Stage 3: codebase analysis (analysisStatus) */}
						<div
							className={`flex items-center gap-2.5 rounded-md border p-3 text-xs transition-colors ${stageClass[analysisStage]}`}
						>
							<StageIcon state={analysisStage} />
							<span className="font-medium">
								{analysisFailed
									? "Analisis codebase gagal"
									: analysisDone
										? "Analisis codebase selesai"
										: "Menyusun analisis codebase"}
							</span>
						</div>
					</div>

					{/* Exclusion count is reported only once the server has it */}
					{status?.excludedCount !== undefined && (
						<p className="font-mono text-[11px] text-fog">
							{status.excludedCount} file dikecualikan otomatis (rahasia,
							dependensi, build, binary)
						</p>
					)}

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
					<div className="flex flex-wrap items-center justify-end gap-2 border-t border-graphite pt-4 text-xs text-fog">
						{onBackToInstructions && (
							<button
								type="button"
								onClick={onBackToInstructions}
								className="rounded border border-iron bg-obsidian px-3 py-1.5 text-xs text-mist hover:text-snow transition hover:bg-steel"
							>
								Kembali ke instruksi
							</button>
						)}

						{showRetry && onRetrySync && (
							<button
								type="button"
								onClick={onRetrySync}
								className="rounded border border-iron bg-obsidian px-3 py-1.5 text-xs text-mist hover:text-snow transition hover:bg-steel"
							>
								Sync ulang
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
	);
}
