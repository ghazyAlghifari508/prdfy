import {
	createFileRoute,
	redirect,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import {
	AlertCircle,
	Check,
	Copy,
	ExternalLink,
	RefreshCw,
	Sparkles,
	Terminal,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CodebaseReview } from "@/components/codebase/codebase-review";
import { SyncAgentModal } from "@/components/codebase/sync-agent-modal";
import { SyncStatus } from "@/components/codebase/sync-status";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { projects } from "@/db/schema";
import type { AnalysisResponse } from "@/lib/codebase-analysis";
import {
	buildSyncCommand,
	getPendingSyncPayloadKey,
	type SyncPromptPayload,
	type SyncStatusResponse,
	syncPromptPayloadSchema,
} from "@/lib/codebase-sync";
import { requireUserServer } from "@/lib/session";
import { useLastRoute } from "@/lib/use-last-route";

// Route entry decision (unit-tested in ./-codebase-entry.test.ts): existing-codebase
// projects enter; greenfield and unknown modes never enter this flow.
export function decideCodebaseEntry(
	projectMode: string | null | undefined,
): "allow" | "deny" {
	return projectMode === "existing_codebase" ? "allow" : "deny";
}

// ponytail: top-level `@/db` + schema imports are consumed ONLY inside
// `loadCodebase` (createServerFn) and get pruned from the client bundle —
// same exception as `src/routes/ask/$id.tsx`. Never import them in the
// page component below.
const loadCodebase = createServerFn({ method: "GET" })
	.validator((id: string) => id)
	.handler(async ({ data: id }) => {
		const user = await requireUserServer();

		const [project] = await db
			.select({
				id: projects.id,
				name: projects.name,
				projectMode: projects.projectMode,
			})
			.from(projects)
			.where(and(eq(projects.id, id), eq(projects.userId, user.id)))
			.limit(1);

		if (!project) throw new Error("NOT_FOUND");

		return {
			projectId: project.id,
			projectName: project.name,
			projectMode: project.projectMode,
		};
	});

export const Route = createFileRoute("/codebase/$id")({
	loader: async ({ params }) => {
		try {
			const data = await loadCodebase({ data: params.id });
			if (decideCodebaseEntry(data.projectMode) === "deny") {
				throw redirect({ to: "/" });
			}
			return data;
		} catch (e) {
			if ((e as Error).message === "Unauthorized")
				throw redirect({ to: "/login" });
			throw e;
		}
	},
	head: ({ loaderData }) => ({
		meta: [{ title: loaderData?.projectName || "Codebase" }],
	}),
	component: CodebasePage,
	errorComponent: ({ error }) => {
		if (error?.message === "NOT_FOUND") {
			return (
				<div className="p-10 text-center text-fog">Proyek tidak ditemukan.</div>
			);
		}
		return (
			<div className="p-10 text-center text-crimson">Gagal memuat halaman.</div>
		);
	},
});

function CodebasePage() {
	const d = Route.useLoaderData();
	const navigate = useNavigate();
	const pathname = useLocation({ select: (l) => l.pathname });
	const reportLastRoute = useLastRoute(d.projectId);

	const [payload, setPayload] = useState<SyncPromptPayload | null>(null);
	const [modalOpen, setModalOpen] = useState(false);
	const [copiedCommand, setCopiedCommand] = useState(false);
	const [pageError, setPageError] = useState<string | null>(null);
	const [sessionConflict, setSessionConflict] = useState<{
		sessionId?: string;
		message: string;
	} | null>(null);
	const [isStarting, setIsStarting] = useState(false);
	const [isWorking, setIsWorking] = useState(false);
	const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
	const [failedAnalysis, setFailedAnalysis] = useState<{
		snapshotId: string;
		analysisId: string | null;
		message: string;
	} | null>(null);
	const [latestStatus, setLatestStatus] = useState<SyncStatusResponse | null>(
		null,
	);
	const [currentSnapshotId, setCurrentSnapshotId] = useState<string | null>(
		null,
	);
	const triggeredForRef = useRef<string | null>(null);

	useEffect(() => {
		reportLastRoute(pathname);
	}, [pathname, reportLastRoute]);

	// Home-created existing-codebase projects arrive with a one-time sync
	// payload stashed in sessionStorage. Consume it once (validated, scoped
	// to this project) and open the agent modal immediately.
	useEffect(() => {
		let raw: string | null = null;
		try {
			const key = getPendingSyncPayloadKey(d.projectId);
			raw = sessionStorage.getItem(key);
			if (raw) sessionStorage.removeItem(key);
		} catch {
			return;
		}
		if (!raw) return;
		try {
			const parsed = syncPromptPayloadSchema.safeParse(JSON.parse(raw));
			if (parsed.success && parsed.data.projectId === d.projectId) {
				setPayload(parsed.data);
				setModalOpen(true);
			}
		} catch {
			// Malformed handoff — fall back to manual "Mulai sync".
		}
	}, [d.projectId]);

	const readAnalysis = useCallback(
		async (snapshotId: string) => {
			const res = await fetch(
				`/api/v1/projects/${encodeURIComponent(d.projectId)}/codebase/analysis?snapshotId=${encodeURIComponent(snapshotId)}`,
			);
			if (!res.ok) return null;
			const json = (await res.json().catch(() => null)) as unknown;
			if (!json || typeof json !== "object" || !("id" in json)) return null;
			return json as AnalysisResponse;
		},
		[d.projectId],
	);

	const triggerAnalysis = useCallback(
		async (snapshotId?: string) => {
			setIsWorking(true);
			setPageError(null);
			try {
				const res = await fetch(
					`/api/v1/projects/${encodeURIComponent(d.projectId)}/codebase/analysis`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(snapshotId ? { snapshotId } : {}),
					},
				);
				const json = (await res.json().catch(() => null)) as unknown;
				if (res.ok && json && typeof json === "object" && "id" in json) {
					const response = json as AnalysisResponse;
					if (response.status === "ready" && response.output) {
						setAnalysis(response);
						setFailedAnalysis(null);
					}
					return;
				}
				const message =
					json && typeof json === "object" && "error" in json
						? String((json as { error: unknown }).error)
						: "Analisis codebase gagal.";
				const code =
					json && typeof json === "object" && "code" in json
						? String((json as { code: unknown }).code)
						: null;
				const failedId =
					json && typeof json === "object" && "analysisId" in json
						? String((json as { analysisId: unknown }).analysisId)
						: null;
				if (code === "ANALYSIS_FAILED") {
					const targetSnapshot = snapshotId ?? currentSnapshotId;
					if (targetSnapshot) {
						setFailedAnalysis({
							snapshotId: targetSnapshot,
							analysisId: failedId,
							message,
						});
					} else {
						setPageError(message);
					}
				} else {
					setPageError(message);
				}
			} catch {
				setPageError("Gagal menghubungi server.");
			} finally {
				setIsWorking(false);
			}
		},
		[d.projectId, currentSnapshotId],
	);

	const handleStatus = useCallback(
		(status: SyncStatusResponse | null) => {
			if (!status) return;
			setLatestStatus(status);
			if (status.snapshotId !== currentSnapshotId) {
				setCurrentSnapshotId(status.snapshotId ?? null);
				setFailedAnalysis(null);
				setAnalysis(null);
			}
			if (status.analysisStatus === "failed" && status.snapshotId) {
				const snapshotId = status.snapshotId;
				const message =
					status.errorMessage ??
					"Analisis codebase gagal. Coba analisis ulang.";
				setFailedAnalysis((prev) =>
					prev?.snapshotId === snapshotId
						? prev
						: {
								snapshotId,
								analysisId: status.analysisId ?? null,
								message,
							},
				);
			} else if (
				status.analysisStatus === "ready" ||
				status.analysisStatus === "pending" ||
				(status.snapshotId && status.analysisId == null)
			) {
				setFailedAnalysis(null);
			}
			if (
				status.status === "uploaded" &&
				!status.analysisId &&
				triggeredForRef.current !== status.sessionId
			) {
				triggeredForRef.current = status.sessionId;
				void triggerAnalysis();
				return;
			}
			if (
				status.snapshotId &&
				status.analysisId &&
				(!analysis || analysis.snapshotId !== status.snapshotId)
			) {
				void readAnalysis(status.snapshotId).then((result) => {
					if (
						result?.status === "ready" &&
						result.output &&
						result.snapshotId === status.snapshotId
					) {
						setAnalysis(result);
						setFailedAnalysis(null);
					}
				});
			}
		},
		[analysis, currentSnapshotId, readAnalysis, triggerAnalysis],
	);

	const startSession = useCallback(
		async (retry: boolean) => {
			setIsStarting(true);
			setPageError(null);
			setSessionConflict(null);
			try {
				const res = await fetch(
					`/api/codebase/${encodeURIComponent(d.projectId)}/session`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(retry ? { action: "retry" } : {}),
					},
				);
				const json = (await res.json().catch(() => null)) as unknown;
				const parsed = syncPromptPayloadSchema.safeParse(json);
				if (res.ok && parsed.success) {
					setPayload(parsed.data);
					setModalOpen(true);
					return;
				}
				const code =
					json && typeof json === "object" && "code" in json
						? String((json as { code: unknown }).code)
						: null;
				const message =
					json && typeof json === "object" && "error" in json
						? String((json as { error: unknown }).error)
						: "Gagal membuat sync session.";
				if (res.status === 409 && code === "SYNC_SESSION_ACTIVE") {
					const conflictId =
						json && typeof json === "object" && "sessionId" in json
							? String((json as { sessionId: unknown }).sessionId)
							: undefined;
					setSessionConflict({ sessionId: conflictId, message });
					return;
				}
				setPageError(message);
			} catch {
				setPageError("Gagal menghubungi server.");
			} finally {
				setIsStarting(false);
			}
		},
		[d.projectId],
	);

	const handleCopyCommand = async () => {
		if (!payload) return;
		const cmd = `prdfy codebase sync --project-id ${payload.projectId} --sync-token ${payload.syncToken}`;
		try {
			await navigator.clipboard.writeText(cmd);
			setCopiedCommand(true);
			setTimeout(() => setCopiedCommand(false), 2000);
		} catch {
			setCopiedCommand(false);
		}
	};

	return (
		<div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10 animate-fade-in">
			{/* Page Header matching PrdFy design language */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-graphite pb-6">
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-fog">
						<Sparkles size={13} className="text-blue-600 dark:text-blue-400" />
						<span>Project · Existing Codebase</span>
					</div>
					<h1 className="font-inter text-2xl sm:text-3xl font-[550] tracking-tight text-snow">
						Sinkronisasi Codebase: {d.projectName}
					</h1>
					<p className="text-xs sm:text-sm text-fog max-w-2xl leading-relaxed">
						PrdFy tidak meminta upload ZIP. Jalankan sinkronisasi langsung dari
						repositori lokal Anda melalui agen AI (Cursor, Claude Code,
						Windsurf, dll.) untuk memindai struktur kode secara otomatis.
					</p>
				</div>

				<div className="flex items-center gap-2 self-start sm:self-auto">
					<span className="inline-flex items-center gap-2 rounded-full border border-graphite bg-muted/60 px-3 py-1 text-xs font-medium text-fog backdrop-blur-md">
						<span
							className={`h-2 w-2 rounded-full ${
								analysis?.output
									? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"
									: latestStatus?.status === "waiting_for_cli"
										? "bg-amber-400"
										: "bg-blue-500 animate-pulse"
							}`}
						/>
						{analysis?.output
							? "Analisis Siap"
							: latestStatus?.status === "waiting_for_cli"
								? "Menunggu CLI"
								: "Sinkronisasi Aktif"}
					</span>
				</div>
			</div>

			{/* Page-level Alert/Error */}
			{pageError && (
				<div className="flex items-center gap-3 rounded-xl border border-crimson/30 bg-crimson/10 p-4 text-xs text-crimson">
					<AlertCircle size={16} className="shrink-0" />
					<span>{pageError}</span>
				</div>
			)}

			{/* Session Conflict Recovery */}
			{sessionConflict && (
				<div className="rounded-xl border border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 p-5 shadow-sm sm:p-6">
					<div className="flex items-start gap-3">
						<AlertCircle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
						<div className="flex flex-1 flex-col gap-2">
							<h3 className="font-inter text-sm font-[550] text-amber-900 dark:text-amber-200">
								Sesi sync aktif ditemukan
							</h3>
							<p className="text-xs text-fog leading-relaxed">
								{sessionConflict.message}. Perintah sync sebelumnya masih
								berlaku di terminal lain. Membuat sesi baru akan mencabut
								kredensial lama.
							</p>
							<div className="mt-2 flex flex-wrap gap-2.5">
								<Button
									onClick={() => void startSession(true)}
									disabled={isStarting}
									className="btn-primary px-4 py-2 text-xs"
								>
									{isStarting ? "Menyiapkan..." : "Cabut sesi lama & buat baru"}
								</Button>
								<Button
									variant="outline"
									onClick={() => setSessionConflict(null)}
									className="border-iron bg-surface text-xs hover:bg-muted text-mist"
								>
									Pertahankan sesi lama
								</Button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Quick Instruction & Terminal Command Box (When waiting or active) */}
			<div className="rounded-xl border border-graphite bg-card p-5 shadow-sm sm:p-6 text-card-foreground">
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-graphite pb-4">
					<div className="flex items-center gap-2.5">
						<div className="flex h-8 w-8 items-center justify-center rounded-lg border border-iron bg-muted text-mist">
							<Terminal size={16} className="text-blue-600 dark:text-blue-400" />
						</div>
						<div>
							<h2 className="font-inter text-base font-[550] text-snow">
								Hubungkan Agen Coding Lokal
							</h2>
							<p className="text-xs text-fog">
								Gunakan PrdFy CLI resmi untuk sinkronisasi snapshot repository
								tanpa upload file ZIP manual.
							</p>
						</div>
					</div>

					<div className="flex items-center gap-2">
						{payload ? (
							<Button
								variant="outline"
								onClick={() => setModalOpen(true)}
								className="border-iron bg-surface text-xs hover:bg-muted text-mist"
							>
								<ExternalLink size={13} className="mr-1.5" />
								Lihat instruksi lengkap
							</Button>
						) : (
							<Button
								onClick={() => void startSession(false)}
								disabled={isStarting}
								className="btn-primary px-4 py-2 text-xs"
							>
								{isStarting ? "Menyiapkan sesi..." : "Mulai sync"}
							</Button>
						)}
					</div>
				</div>

				{payload ? (
					<div className="mt-5 flex flex-col gap-4">
						{/* Steps sequence */}
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
							<div className="rounded-lg border border-graphite bg-muted/30 p-3.5 flex flex-col gap-1">
								<span className="font-mono text-[10px] uppercase text-blue-600 dark:text-blue-400 font-semibold">
									Langkah 1
								</span>
								<span className="font-semibold text-xs text-snow">
									Cek CLI di terminal
								</span>
								<code className="mt-1 font-mono text-[11px] text-snow bg-muted p-1.5 rounded border border-graphite">
									prdfy --version
								</code>
							</div>
							<div className="rounded-lg border border-graphite bg-muted/30 p-3.5 flex flex-col gap-1">
								<span className="font-mono text-[10px] uppercase text-blue-600 dark:text-blue-400 font-semibold">
									Langkah 2
								</span>
								<span className="font-semibold text-xs text-snow">
									Jalankan dari root project
								</span>
								<span className="mt-1 text-[11px] text-fog">
									Pastikan posisi direktori terminal berada di root repository.
								</span>
							</div>
							<div className="rounded-lg border border-graphite bg-muted/30 p-3.5 flex flex-col gap-1">
								<span className="font-mono text-[10px] uppercase text-blue-600 dark:text-blue-400 font-semibold">
									Langkah 3
								</span>
								<span className="font-semibold text-xs text-snow">
									Pantau progres otomatis
								</span>
								<span className="mt-1 text-[11px] text-fog">
									PrdFy akan mendeteksi status dan memulai analisis secara
									real-time.
								</span>
							</div>
						</div>

						{/* Copyable Command Box (High Contrast Terminal Dark Theme) */}
						<div className="relative rounded-lg border border-zinc-800 bg-zinc-950 p-3.5 font-mono text-xs text-zinc-100 shadow-inner">
							<div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-zinc-800 text-[11px] text-zinc-400">
								<span>Perintah Terminal (Token aktif 30 menit):</span>
								<button
									type="button"
									onClick={handleCopyCommand}
									className="inline-flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700 transition"
								>
									{copiedCommand ? (
										<>
											<Check size={12} className="text-emerald-400" />
											<span className="text-emerald-400">Tersalin!</span>
										</>
									) : (
										<>
											<Copy size={12} />
											<span>Salin perintah</span>
										</>
									)}
								</button>
							</div>
							<div className="overflow-x-auto select-all text-emerald-400 py-1 font-mono">
								{buildSyncCommand(payload.projectId)}
							</div>
						</div>
					</div>
				) : (
					<div className="mt-4 py-4 text-center">
						<p className="text-xs text-fog">
							Klik tombol "Mulai sync" untuk menerbitkan token sesi aman dan
							instruksi bagi agen AI Anda.
						</p>
					</div>
				)}
			</div>

			{/* Real-Signal Status Checklist */}
			<SyncStatus
				projectId={d.projectId}
				onStatus={handleStatus}
				onRetrySync={() => void startSession(true)}
				onRetryAnalysis={() =>
					currentSnapshotId && void triggerAnalysis(currentSnapshotId)
				}
			/>

			{/* Analysis Failed Card (Retryable) */}
			{failedAnalysis &&
				currentSnapshotId &&
				failedAnalysis.snapshotId === currentSnapshotId &&
				(!analysis || analysis.snapshotId !== currentSnapshotId) && (
					<div className="rounded-xl border border-crimson/30 bg-crimson/10 p-5 shadow-sm sm:p-6 flex flex-col gap-3">
						<div className="flex items-center gap-2 text-crimson font-medium text-sm">
							<AlertCircle size={16} />
							<span>Analisis codebase gagal</span>
						</div>
						<p className="text-xs text-fog leading-relaxed">
							Snapshot sudah terupload lengkap di server — hanya tahap analisis
							AI yang mengalami kendala dan dapat diulang tanpa perlu sinkronisasi
							ulang berkas.
						</p>
						<p className="text-xs font-mono text-crimson">
							{failedAnalysis.message}
						</p>
						<div className="mt-2 flex flex-wrap gap-2.5">
							<Button
								onClick={() => void triggerAnalysis(currentSnapshotId)}
								disabled={isWorking}
								className="btn-primary px-4 py-2 text-xs"
							>
								{isWorking ? (
									<>
										<RefreshCw size={13} className="mr-1.5 animate-spin" />
										Menganalisis...
									</>
								) : (
									"Analisis ulang"
								)}
							</Button>
							<Button
								variant="outline"
								onClick={() => void startSession(true)}
								disabled={isStarting}
								className="border-iron bg-surface text-xs hover:bg-muted text-mist"
							>
								Sync ulang
							</Button>
						</div>
					</div>
				)}

			{/* Rendered Codebase Review (Bento Grid) */}
			{analysis?.output &&
				currentSnapshotId &&
				analysis.snapshotId === currentSnapshotId && (
					<CodebaseReview
						analysis={analysis.output}
						snapshotId={currentSnapshotId}
						snapshotCreatedAt={latestStatus?.snapshotCreatedAt}
						fileCount={latestStatus?.fileCount}
						excludedCount={latestStatus?.excludedCount}
						isWorking={isWorking}
						onRetrySync={() => void startSession(true)}
						onRetryAnalysis={() => void triggerAnalysis(currentSnapshotId)}
						onContinue={() =>
							void navigate({
								to: "/ask/$id",
								params: { id: d.projectId },
							})
						}
					/>
				)}

			{/* Full Instructions Modal */}
			<SyncAgentModal
				open={modalOpen}
				onClose={() => setModalOpen(false)}
				payload={payload}
				onRetry={() => void startSession(true)}
				isRetrying={isStarting}
			/>
		</div>
	);
}
