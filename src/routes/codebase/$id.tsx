import {
	createFileRoute,
	redirect,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { useCallback, useEffect, useRef, useState } from "react";
import { CodebaseReview } from "@/components/codebase/codebase-review";
import { ScreenConnect } from "@/components/codebase/screen-connect";
import { SyncStatus } from "@/components/codebase/sync-status";
import { db } from "@/db";
import { projects } from "@/db/schema";
import type { AnalysisResponse } from "@/lib/codebase-analysis";
import {
	getPendingSyncPayloadKey,
	type SyncPromptPayload,
	type SyncStatusResponse,
	syncPromptPayloadSchema,
	syncStatusResponseSchema,
} from "@/lib/codebase-sync";
import { CODEBASE_SYNC_POLL_INTERVAL_MS } from "@/lib/constants";
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
	const [_pageError, setPageError] = useState<string | null>(null);
	const [isStarting, setIsStarting] = useState(false);
	const [isWorking, setIsWorking] = useState(false);
	const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
	const [_failedAnalysis, setFailedAnalysis] = useState<{
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

	// Screen switcher state (1: Connect, 2: Syncing, 3: Review)
	const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);
	const userSelectedStepRef = useRef(false);

	useEffect(() => {
		reportLastRoute(pathname);
	}, [pathname, reportLastRoute]);

	// Home-created existing-codebase projects arrive with a one-time sync
	// payload stashed in sessionStorage.
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
			}
		} catch {
			// Handled gracefully
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

	// Continuous background status polling across all screens
	useEffect(() => {
		let cancelled = false;
		const fetchStatus = async () => {
			try {
				const query = latestStatus?.sessionId
					? `?sessionId=${encodeURIComponent(latestStatus.sessionId)}`
					: "";
				const res = await fetch(
					`/api/codebase/${encodeURIComponent(d.projectId)}/status${query}`,
				);
				if (!res.ok || cancelled) return;
				const json = (await res.json().catch(() => null)) as unknown;
				const parsed = syncStatusResponseSchema.safeParse(json);
				if (parsed.success && !cancelled) {
					handleStatus(parsed.data);
				}
			} catch {
				// Handled gracefully
			}
		};

		void fetchStatus();
		const interval = setInterval(fetchStatus, CODEBASE_SYNC_POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [d.projectId, latestStatus?.sessionId, handleStatus]);

	const startSession = useCallback(
		async (retry: boolean) => {
			setIsStarting(true);
			setPageError(null);
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
					userSelectedStepRef.current = false;
					setActiveStep(1);
					return;
				}
			} catch {
				// Handled gracefully
			} finally {
				setIsStarting(false);
			}
		},
		[d.projectId],
	);

	// Auto-mint active session credentials on Step 1 if payload missing
	useEffect(() => {
		if (!payload && !analysis && activeStep === 1 && !isStarting) {
			void startSession(true);
		}
	}, [payload, analysis, activeStep, isStarting, startSession]);

	// Compute max step unlocked by real server progress
	const maxAchievedStep: 1 | 2 | 3 = analysis?.output
		? 3
		: latestStatus &&
			  (latestStatus.status === "connected" ||
					latestStatus.status === "scanning" ||
					latestStatus.status === "filtering" ||
					latestStatus.status === "uploading" ||
					latestStatus.status === "uploaded" ||
					latestStatus.status === "analyzing" ||
					latestStatus.status === "ready")
			? 2
			: 1;

	// Auto-advance activeStep as server progresses unless user manually clicked an earlier step
	useEffect(() => {
		if (!userSelectedStepRef.current) {
			setActiveStep(maxAchievedStep);
		}
	}, [maxAchievedStep]);

	return (
		<main className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 animate-enter flex flex-col gap-6">
			{/* Flowline Navigation matching existing-codebase-flow.html */}
			<div className="flex items-center gap-2 text-xs text-fog border-b border-graphite/60 pb-3">
				<button
					type="button"
					onClick={() => {
						userSelectedStepRef.current = true;
						setActiveStep(1);
					}}
					className={`px-2.5 py-1 rounded transition ${
						activeStep === 1
							? "border border-mist text-snow bg-steel font-medium"
							: "border border-transparent text-fog hover:text-snow hover:border-graphite"
					}`}
				>
					01 · Hubungkan
				</button>
				<span className="text-slate">·</span>
				<button
					type="button"
					disabled={maxAchievedStep < 2}
					onClick={() => {
						userSelectedStepRef.current = true;
						setActiveStep(2);
					}}
					className={`px-2.5 py-1 rounded transition ${
						activeStep === 2
							? "border border-mist text-snow bg-steel font-medium"
							: maxAchievedStep >= 2
								? "border border-transparent text-fog hover:text-snow hover:border-graphite cursor-pointer"
								: "text-slate/40 cursor-not-allowed"
					}`}
				>
					02 · Sync codebase
				</button>
				<span className="text-slate">·</span>
				<button
					type="button"
					disabled={maxAchievedStep < 3}
					onClick={() => {
						userSelectedStepRef.current = true;
						setActiveStep(3);
					}}
					className={`px-2.5 py-1 rounded transition ${
						activeStep === 3
							? "border border-mist text-snow bg-steel font-medium"
							: maxAchievedStep >= 3
								? "border border-transparent text-fog hover:text-snow hover:border-graphite cursor-pointer"
								: "text-slate/40 cursor-not-allowed"
					}`}
				>
					03 · Review konteks
				</button>
			</div>

			{/* SCREEN 1: Hubungkan Codebase */}
			{activeStep === 1 && (
				<ScreenConnect
					projectName={d.projectName}
					payload={payload}
					onAgentStarted={() => {
						userSelectedStepRef.current = true;
						setActiveStep(2);
					}}
				/>
			)}

			{/* SCREEN 2: Sync Codebase (Real-Signal Checklist) */}
			{activeStep === 2 && (
				<SyncStatus
					projectId={d.projectId}
					projectName={d.projectName}
					status={latestStatus}
					onStatus={handleStatus}
					onRetrySync={() => void startSession(true)}
					onRetryAnalysis={() =>
						currentSnapshotId && void triggerAnalysis(currentSnapshotId)
					}
					onViewReview={() => {
						userSelectedStepRef.current = true;
						setActiveStep(3);
					}}
				/>
			)}

			{/* SCREEN 3: Review Konteks Codebase (Bento Grid) */}
			{activeStep === 3 && analysis?.output && currentSnapshotId && (
				<CodebaseReview
					analysis={analysis.output}
					snapshotId={currentSnapshotId}
					snapshotCreatedAt={latestStatus?.snapshotCreatedAt}
					fileCount={latestStatus?.fileCount}
					excludedCount={latestStatus?.excludedCount}
					isWorking={isWorking}
					onRetrySync={() => void startSession(true)}
					onRetryAnalysis={() => void triggerAnalysis(currentSnapshotId)}
					onBackToSync={() => {
						userSelectedStepRef.current = true;
						setActiveStep(2);
					}}
					onContinue={() =>
						void navigate({
							to: "/ask/$id",
							params: { id: d.projectId },
						})
					}
				/>
			)}
		</main>
	);
}
