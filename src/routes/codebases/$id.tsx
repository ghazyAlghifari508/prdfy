import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { CodebaseReview } from "@/components/codebase/codebase-review";
import { ScreenConnect } from "@/components/codebase/screen-connect";
import { SyncStatus } from "@/components/codebase/sync-status";
import { projects } from "@/db/schema";
import {
	type AnalysisResponse,
	safeParseCodebaseAnalysis,
} from "@/lib/codebase-analysis";
import {
	getPendingSyncPayloadKey,
	SNAPSHOT_CONTEXT_STATUSES,
	type SyncPromptPayload,
	type SyncStatusResponse,
	syncPromptPayloadSchema,
	syncStatusResponseSchema,
} from "@/lib/codebase-sync";
import { CODEBASE_SYNC_POLL_INTERVAL_MS } from "@/lib/constants";
import { requireUserServer } from "@/lib/session";

export function decideCodebaseDetailEntry(
	codebaseId: string | undefined,
): "allow" | "deny" {
	return codebaseId?.trim() ? "allow" : "deny";
}

const loadCodebase = createServerFn({ method: "GET" })
	.validator((id: string) => id)
	.handler(async ({ data: id }) => {
		const user = await requireUserServer();
		const { db } = await import("@/db");
		const { codebases, codebaseAnalyses } = await import("@/db/schema");
		const [codebase] = await db
			.select({ id: codebases.id, name: codebases.name })
			.from(codebases)
			.where(and(eq(codebases.id, id), eq(codebases.userId, user.id)))
			.limit(1);
		if (!codebase) throw new Error("NOT_FOUND");
		const featureProjects = await db
			.select({ id: projects.id, name: projects.name })
			.from(projects)
			.where(
				and(
					eq(projects.codebaseId, id),
					eq(projects.userId, user.id),
					isNull(projects.deletedAt),
				),
			)
			.orderBy(desc(projects.updatedAt));
		const feature = featureProjects[0] ?? null;
		let analysis: AnalysisResponse | null = null;
		if (feature) {
			const [row] = await db
				.select()
				.from(codebaseAnalyses)
				.where(eq(codebaseAnalyses.projectId, feature.id))
				.orderBy(desc(codebaseAnalyses.createdAt))
				.limit(1);
			if (row) {
				const parsed = safeParseCodebaseAnalysis(row.output);
				analysis = {
					id: row.id,
					projectId: row.projectId,
					snapshotId: row.snapshotId,
					status:
						row.status === "ready" ||
						row.status === "failed" ||
						row.status === "pending"
							? row.status
							: "failed",
					output: parsed.success ? parsed.data : null,
					errorCode: row.errorCode,
					errorMessage: row.errorMessage,
					createdAt: row.createdAt?.toISOString(),
					updatedAt: row.updatedAt?.toISOString(),
				};
			}
		}
		return { codebase, feature, analysis };
	});

export const Route = createFileRoute("/codebases/$id")({
	loader: async ({ params }) => {
		if (decideCodebaseDetailEntry(params.id) === "deny")
			throw redirect({ to: "/codebases" });
		try {
			return await loadCodebase({ data: params.id });
		} catch (error) {
			if (error instanceof Error && error.message === "Unauthorized")
				throw redirect({ to: "/login" });
			throw error;
		}
	},
	head: ({ loaderData }) => ({
		meta: [{ title: loaderData?.codebase.name ?? "Codebase" }],
	}),
	component: CodebaseDetailPage,
	errorComponent: ({ error, reset }) => (
		<main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
			<div
				role="alert"
				className="rounded-xl border border-crimson/40 bg-crimson/10 p-5 text-crimson"
			>
				<h1 className="text-lg font-semibold">Codebase tidak dapat dimuat</h1>
				<p className="mt-1 text-sm">
					{error instanceof Error && error.message === "NOT_FOUND"
						? "Codebase tidak ditemukan."
						: "Terjadi masalah saat membaca data codebase."}
				</p>
				<button
					type="button"
					onClick={reset}
					className="mt-4 min-h-11 rounded-md border border-crimson/50 px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo"
				>
					Coba lagi
				</button>
			</div>
		</main>
	),
});

function CodebaseDetailPage() {
	const {
		codebase,
		feature,
		analysis: initialAnalysis,
	} = Route.useLoaderData();
	const navigate = useNavigate();
	const [payload, setPayload] = useState<SyncPromptPayload | null>(null);
	const [status, setStatus] = useState<SyncStatusResponse | null>(null);
	const [analysis, setAnalysis] = useState<AnalysisResponse | null>(
		initialAnalysis,
	);
	const [screen, setScreen] = useState<1 | 2 | 3>(
		initialAnalysis?.output ? 3 : 1,
	);
	const [prompt, setPrompt] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isStarting, setIsStarting] = useState(false);
	const [isWorking, setIsWorking] = useState(false);
	const inFlight = useRef(false);

	const readStatus = useCallback(async () => {
		if (inFlight.current) return;
		inFlight.current = true;
		try {
			const query = status?.sessionId
				? `?sessionId=${encodeURIComponent(status.sessionId)}`
				: "";
			const response = await fetch(
				`/api/codebases/${encodeURIComponent(codebase.id)}/status${query}`,
			);
			const parsed = syncStatusResponseSchema.safeParse(
				await response.json().catch(() => null),
			);
			if (!response.ok || !parsed.success) return;
			setStatus(parsed.data);
			if (parsed.data.snapshotId)
				setScreen((current) => (current === 1 ? 2 : current));
		} finally {
			inFlight.current = false;
		}
	}, [codebase.id, status?.sessionId]);

	useEffect(() => {
		try {
			const raw = sessionStorage.getItem(getPendingSyncPayloadKey(codebase.id));
			if (!raw) return;
			const parsed = syncPromptPayloadSchema.safeParse(JSON.parse(raw));
			if (parsed.success && parsed.data.projectId === codebase.id)
				setPayload(parsed.data);
			sessionStorage.removeItem(getPendingSyncPayloadKey(codebase.id));
		} catch {
			setError("Instruksi sync tidak dapat dibaca dari browser.");
		}
	}, [codebase.id]);

	useEffect(() => {
		void readStatus();
		const interval = setInterval(
			() => void readStatus(),
			CODEBASE_SYNC_POLL_INTERVAL_MS,
		);
		return () => clearInterval(interval);
	}, [readStatus]);

	const startSession = async () => {
		setIsStarting(true);
		setError(null);
		try {
			const response = await fetch(
				`/api/codebases/${encodeURIComponent(codebase.id)}/session`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(
						status?.status === "failed" || status?.status === "expired"
							? { action: "retry" }
							: {},
					),
				},
			);
			const parsed = syncPromptPayloadSchema.safeParse(
				await response.json().catch(() => null),
			);
			if (!response.ok || !parsed.success) {
				setError("Sesi sync gagal dibuat. Coba lagi.");
				return;
			}
			setPayload(parsed.data);
			setStatus(null);
			setAnalysis(null);
			setScreen(1);
		} catch {
			setError("Server tidak dapat dihubungi.");
		} finally {
			setIsStarting(false);
		}
	};

	const triggerAnalysis = async () => {
		if (!feature?.id || !status?.snapshotId) return;
		setIsWorking(true);
		setError(null);
		try {
			const response = await fetch(
				`/api/v1/projects/${encodeURIComponent(feature.id)}/codebase/analysis`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ snapshotId: status.snapshotId }),
				},
			);
			const body: unknown = await response.json().catch(() => null);
			if (
				!response.ok ||
				typeof body !== "object" ||
				body === null ||
				!("id" in body) ||
				typeof body.id !== "string"
			) {
				setError("Analisis codebase gagal. Coba analisis ulang.");
				return;
			}
			const parsed = safeParseAnalysisResponse(body);
			if (!parsed) {
				setError("Hasil analisis tidak valid.");
				return;
			}
			setAnalysis(parsed);
			if (parsed.output) setScreen(3);
		} catch {
			setError("Server tidak dapat dihubungi.");
		} finally {
			setIsWorking(false);
		}
	};

	const snapshotReady = Boolean(
		status?.snapshotId &&
			(SNAPSHOT_CONTEXT_STATUSES.includes(status.status) ||
				status.status === "analyzing"),
	);
	const submitFeature = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!snapshotReady || prompt.trim().length < 3) return;
		setIsWorking(true);
		setError(null);
		try {
			const response = await fetch(
				`/api/codebases/${encodeURIComponent(codebase.id)}/features`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ message: prompt.trim() }),
				},
			);
			const body: unknown = await response.json().catch(() => null);
			if (
				!response.ok ||
				typeof body !== "object" ||
				body === null ||
				!("projectId" in body) ||
				typeof body.projectId !== "string" ||
				!("name" in body) ||
				typeof body.name !== "string"
			) {
				setError("Fitur gagal dibuat. Coba lagi.");
				return;
			}
			await navigate({ to: "/ask/$id", params: { id: body.projectId } });
		} catch {
			setError("Server tidak dapat dihubungi.");
		} finally {
			setIsWorking(false);
		}
	};

	return (
		<main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-14">
			<header className="border-b border-graphite pb-6">
				<p className="font-mono text-xs uppercase tracking-widest text-fog">
					Codebase / {codebase.name}
				</p>
				<h1 className="mt-2 text-3xl font-semibold tracking-tight text-snow">
					Konteks repository
				</h1>
				<p className="mt-2 max-w-2xl text-sm leading-6 text-fog">
					Hubungkan repository, tunggu snapshot terverifikasi, lalu rencanakan
					fitur baru dengan konteks yang nyata.
				</p>
			</header>
			{error && (
				<div
					role="alert"
					className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-crimson/40 bg-crimson/10 p-4 text-sm text-crimson"
				>
					<span>{error}</span>
					<button
						type="button"
						onClick={() => void startSession()}
						className="min-h-11 rounded-md border border-crimson/50 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo"
					>
						Coba lagi
					</button>
				</div>
			)}
			<nav
				className="flex flex-wrap gap-2 border-b border-graphite pb-3"
				aria-label="Tahap codebase"
			>
				<button
					type="button"
					onClick={() => setScreen(1)}
					className="min-h-11 rounded-md border border-graphite px-3 text-xs text-fog hover:text-snow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo"
				>
					01 Hubungkan
				</button>
				<button
					type="button"
					disabled={!status?.snapshotId}
					onClick={() => setScreen(2)}
					className="min-h-11 rounded-md border border-graphite px-3 text-xs text-fog disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo"
				>
					02 Sync
				</button>
				<button
					type="button"
					disabled={!analysis?.output}
					onClick={() => setScreen(3)}
					className="min-h-11 rounded-md border border-graphite px-3 text-xs text-fog disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo"
				>
					03 Review
				</button>
			</nav>
			{screen === 1 && (
				<ScreenConnect
					projectName={codebase.name}
					payload={payload}
					isStarting={isStarting}
					onAgentStarted={() => setScreen(2)}
				/>
			)}
			{screen === 2 && (
				<SyncStatus
					projectId={codebase.id}
					projectName={codebase.name}
					status={status}
					statusPath={`/api/codebases/${encodeURIComponent(codebase.id)}/status`}
					onStatus={setStatus}
					onRetrySync={() => void startSession()}
					onRetryAnalysis={feature ? () => void triggerAnalysis() : undefined}
					onViewReview={analysis?.output ? () => setScreen(3) : undefined}
				/>
			)}
			{screen === 3 && analysis?.output && status?.snapshotId && (
				<CodebaseReview
					analysis={analysis.output}
					snapshotId={status.snapshotId}
					snapshotCreatedAt={status.snapshotCreatedAt}
					fileCount={status.fileCount}
					excludedCount={status.excludedCount}
					isWorking={isWorking}
					errorMessage={error}
					onRetrySync={() => void startSession()}
					onRetryAnalysis={feature ? () => void triggerAnalysis() : undefined}
					onBackToSync={() => setScreen(2)}
					onContinue={() => setScreen(2)}
				/>
			)}
			<section className="rounded-xl border border-graphite bg-charcoal p-5 sm:p-6">
				<div className="flex flex-col gap-2">
					<h2 className="text-lg font-semibold text-snow">
						Rencanakan fitur baru
					</h2>
					<p className="text-sm leading-6 text-fog">
						Form aktif setelah snapshot selesai diupload. Tanpa snapshot,
						halaman ini hanya menampilkan status sync yang sebenarnya.
					</p>
				</div>
				<form
					onSubmit={(event) => void submitFeature(event)}
					className="mt-5 flex flex-col gap-3"
				>
					<label
						htmlFor="feature-prompt"
						className="text-sm font-medium text-snow"
					>
						Prompt fitur
					</label>
					<textarea
						id="feature-prompt"
						value={prompt}
						onChange={(event) => setPrompt(event.target.value)}
						disabled={!snapshotReady || isWorking}
						rows={4}
						placeholder={
							snapshotReady
								? "Fitur apa yang ingin direncanakan?"
								: "Tunggu snapshot selesai disinkronkan"
						}
						className="resize-y rounded-lg border border-graphite bg-obsidian p-3 text-sm text-snow outline-none placeholder:text-slate focus-visible:ring-2 focus-visible:ring-indigo disabled:cursor-not-allowed disabled:opacity-50"
					/>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<span className="text-xs text-fog">
							{snapshotReady
								? "Snapshot siap menjadi konteks fitur."
								: "Snapshot belum siap."}
						</span>
						<button
							type="submit"
							disabled={!snapshotReady || prompt.trim().length < 3 || isWorking}
							className="min-h-11 rounded-md bg-snow px-4 text-sm font-semibold text-onyx disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo"
						>
							{isWorking ? "Memproses..." : "Buat fitur"}
						</button>
					</div>
				</form>
			</section>
		</main>
	);
}

function safeParseAnalysisResponse(input: object): AnalysisResponse | null {
	if (
		!("id" in input) ||
		!("projectId" in input) ||
		!("snapshotId" in input) ||
		!("status" in input)
	)
		return null;
	const output =
		"output" in input
			? safeParseCodebaseAnalysis(input.output)
			: { success: false as const };
	if (
		input.id &&
		typeof input.id === "string" &&
		input.projectId &&
		typeof input.projectId === "string" &&
		input.snapshotId &&
		typeof input.snapshotId === "string" &&
		(input.status === "pending" ||
			input.status === "ready" ||
			input.status === "failed")
	)
		return {
			id: input.id,
			projectId: input.projectId,
			snapshotId: input.snapshotId,
			status: input.status,
			output: output.success ? output.data : null,
		};
	return null;
}
