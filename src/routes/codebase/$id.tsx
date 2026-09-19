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
import { SyncAgentModal } from "@/components/codebase/sync-agent-modal";
import { SyncStatus } from "@/components/codebase/sync-status";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { db } from "@/db";
import { projects } from "@/db/schema";
import type { AnalysisResponse } from "@/lib/codebase-analysis";
import {
	getPendingSyncPayloadKey,
	type SyncPromptPayload,
	type SyncStatusResponse,
	syncPromptPayloadSchema,
} from "@/lib/codebase-sync";
import { requireUserServer } from "@/lib/session";
import { useLastRoute } from "@/lib/use-last-route";

// Route entry decision (unit-tested in ./$id.test.ts): existing-codebase
// projects enter; greenfield and unknown modes never enter this flow.
export function decideCodebaseEntry(
	projectMode: string | null | undefined,
): "allow" | "deny" {
	return projectMode === "existing_codebase" ? "allow" : "deny";
}

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
	const [pageError, setPageError] = useState<string | null>(null);
	const [isStarting, setIsStarting] = useState(false);
	const [isWorking, setIsWorking] = useState(false);
	const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
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
					}
					return;
				}
				const message =
					json && typeof json === "object" && "error" in json
						? String((json as { error: unknown }).error)
						: "Analisis codebase gagal.";
				setPageError(message);
			} catch {
				setPageError("Gagal menghubungi server.");
			} finally {
				setIsWorking(false);
			}
		},
		[d.projectId],
	);

	const handleStatus = useCallback(
		(status: SyncStatusResponse | null) => {
			if (!status) return;
			setLatestStatus(status);
			// Scope everything to the session's current snapshot so a
			// retry-sync never renders a stale review from a previous attempt.
			if (status.snapshotId !== currentSnapshotId) {
				setCurrentSnapshotId(status.snapshotId ?? null);
			}
			// Auto-trigger analysis exactly once per uploaded snapshot without
			// an analysis record; the trigger endpoint itself is idempotent
			// (reuses pending/ready), so a StrictMode double-effect is safe.
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
				const message =
					json && typeof json === "object" && "error" in json
						? String((json as { error: unknown }).error)
						: "Gagal membuat sync session.";
				setPageError(message);
			} catch {
				setPageError("Gagal menghubungi server.");
			} finally {
				setIsStarting(false);
			}
		},
		[d.projectId],
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
			<Card>
				<CardHeader>
					<CardTitle>Sync Codebase: {d.projectName}</CardTitle>
					<CardDescription>
						Sinkronkan repositori lokal lewat agen AI Anda, lalu tinjau hasil
						analisis sebelum lanjut ke Ask.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-wrap gap-2">
					<Button
						onClick={() => void startSession(false)}
						disabled={isStarting}
					>
						{isStarting ? "Menyiapkan" : "Mulai sync"}
					</Button>
					{payload && (
						<Button variant="outline" onClick={() => setModalOpen(true)}>
							Lihat instruksi agen
						</Button>
					)}
				</CardContent>
			</Card>

			{pageError && (
				<p className="rounded-md bg-crimson/10 p-3 text-sm text-crimson">
					{pageError}
				</p>
			)}

			<SyncStatus
				projectId={d.projectId}
				onStatus={handleStatus}
				onRetrySync={() => void startSession(true)}
			/>

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
