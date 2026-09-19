"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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

interface SyncStatusProps {
	projectId: string;
	sessionId?: string;
	pollIntervalMs?: number;
	onStatus?: (status: SyncStatusResponse | null) => void;
	onRetrySync?: () => void;
	/** Retry a failed analysis (session stays `uploaded`; only the analysis
	 *  attempt failed). Rendered when the polled status carries
	 *  `analysisStatus: "failed"` — without this the page is a dead end:
	 *  the session-level retry only covers failed/expired sync sessions. */
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
	// Analysis failure rolls the session back to `uploaded` (retryable), so
	// the session-level retry above never shows for it — the analysis-level
	// retry must render from `analysisStatus` instead.
	const showAnalysisRetry = status?.analysisStatus === "failed";

	return (
		<Card>
			<CardHeader>
				<CardTitle>Status Sync</CardTitle>
				<CardDescription>
					Status aktual dari server, diperbarui otomatis.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{isLoading && !status ? (
					<div className="flex items-center gap-3">
						<output className="h-5 w-5 animate-spin rounded-full border-2 border-fog border-t-transparent" />
						<p className="text-sm text-fog">Memuat status sync.</p>
					</div>
				) : error && !status ? (
					<p className="text-sm text-crimson">{error}</p>
				) : status ? (
					<>
						<div className="flex items-center gap-3">
							{!isTerminal && (
								<output className="h-5 w-5 animate-spin rounded-full border-2 border-fog border-t-transparent" />
							)}
							<div>
								<p className="font-medium text-snow">
									{STATUS_LABEL[status.status]}
								</p>
								{STATUS_HINT[status.status] && (
									<p className="text-sm text-fog">
										{STATUS_HINT[status.status]}
									</p>
								)}
							</div>
						</div>
						<dl className="grid grid-cols-2 gap-2 text-sm">
							{status.fileCount !== undefined && (
								<div>
									<dt className="text-fog">File terupload</dt>
									<dd className="text-snow">{status.fileCount}</dd>
								</div>
							)}
							{status.excludedCount !== undefined && (
								<div>
									<dt className="text-fog">File dieksklusi</dt>
									<dd className="text-snow">{status.excludedCount}</dd>
								</div>
							)}
							{formatTimestamp(status.updatedAt) && (
								<div>
									<dt className="text-fog">Diperbarui</dt>
									<dd className="text-snow">
										{formatTimestamp(status.updatedAt)}
									</dd>
								</div>
							)}
							{formatTimestamp(status.expiresAt) && (
								<div>
									<dt className="text-fog">Sesi berakhir</dt>
									<dd className="text-snow">
										{formatTimestamp(status.expiresAt)}
									</dd>
								</div>
							)}
						</dl>
						{status.errorMessage && (
							<p className="rounded-md bg-crimson/10 p-3 text-sm text-crimson">
								{status.errorMessage}
							</p>
						)}
						{showRetry && (
							<div className="flex justify-end">
								<Button variant="outline" onClick={onRetrySync}>
									{status.status === "expired"
										? "Buat sesi baru"
										: "Coba sync ulang"}
								</Button>
							</div>
						)}
						{showAnalysisRetry && (
							<div className="flex justify-end">
								<Button variant="outline" onClick={onRetryAnalysis}>
									Analisis ulang
								</Button>
							</div>
						)}
					</>
				) : null}
			</CardContent>
		</Card>
	);
}
