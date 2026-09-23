"use client";

import { Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	ArrowUpDown,
	Check,
	ChevronDown,
	Info,
	KanbanSquare,
	Loader2,
	RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DocumentReviewModal } from "@/components/project/document-review-modal";
import { ProjectDocumentsDrawer } from "@/components/project/project-documents-drawer";
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
import { useKanbanTasks } from "@/hooks/use-kanban-polling";
import {
	computeKanbanProgress,
	extractPhases,
	filterColumnsByPhase,
} from "@/lib/kanban-utils";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store";
import { KanbanColumn, type KanbanColumnHandle } from "./kanban-column";

// Whether a progress reset would change anything. Mirrors the server's
// `needsProgressReset` for the UI's disabled state: a board with everything
// still pending has no work to clear, so the action is hidden rather than
// offering a no-op button.
export function canResetProgress(
	columns: Record<string, Array<{ id: string }>> | null,
): boolean {
	if (!columns) return false;
	const nonPending = ["in_progress", "completed", "failed"] as const;
	return nonPending.some((status) => (columns[status]?.length ?? 0) > 0);
}

interface KanbanBoardProps {
	projectId: string;
	projectName: string;
	latestPrdContent?: string | null;
	latestAcContent?: string | null;
}

export function KanbanBoard({
	projectId,
	projectName,
	latestPrdContent,
	latestAcContent,
}: KanbanBoardProps) {
	const isProjectDrawerOpen = useUIStore((s) => s.isProjectDrawerOpen);
	const setProjectDrawerOpen = useUIStore((s) => s.setProjectDrawerOpen);
	const showToast = useUIStore((s) => s.showToast);
	const [activeReviewModal, setActiveReviewModal] = useState<
		"prd" | "ac" | null
	>(null);
	const [resetDialogOpen, setResetDialogOpen] = useState(false);
	const [isResetting, setIsResetting] = useState(false);

	const { data, isLoading, isError, staleness, refetch } = useKanbanTasks({
		projectId,
		intervalMs: 10000,
	});

	const columns = data?.columns;
	const lastUpdateAt = data?.lastUpdateAt;

	// Extract phases dynamically from actual tasks
	const phases = useMemo(
		() => (columns ? extractPhases(columns) : []),
		[columns],
	);

	// Phase filter state (presentation state)
	const [selectedPhase, setSelectedPhase] = useState<string | null>(null);

	// Find active phase if selected, fallback cleanly if invalidated
	const activePhase = useMemo(
		() =>
			selectedPhase
				? (phases.find((p) => p.id === selectedPhase) ?? null)
				: null,
		[phases, selectedPhase],
	);

	// Filtered columns based on selected phase
	const visibleColumns = useMemo(
		() => (columns ? filterColumnsByPhase(columns, selectedPhase) : null),
		[columns, selectedPhase],
	);

	// Progress derived from visible scope
	const progress = useMemo(
		() =>
			visibleColumns
				? computeKanbanProgress(visibleColumns)
				: { total: 0, done: 0, pct: 0 },
		[visibleColumns],
	);

	const hasProjectTasks = useMemo(() => {
		if (!columns) return false;
		return (
			columns.pending.length +
				columns.in_progress.length +
				columns.completed.length +
				columns.failed.length >
			0
		);
	}, [columns]);

	const hasVisibleTasks = useMemo(() => {
		if (!visibleColumns) return false;
		return (
			visibleColumns.pending.length +
				visibleColumns.in_progress.length +
				visibleColumns.completed.length +
				visibleColumns.failed.length >
			0
		);
	}, [visibleColumns]);

	const selectedPhaseLabel = activePhase ? activePhase.label : "Semua";

	// Track card movements for animation
	const prevColumnsRef = useRef<typeof columns | null>(null);
	const [highlightedCardId, setHighlightedCardId] = useState<string | null>(
		null,
	);
	const [dismissedBanners, setDismissedBanners] = useState<string[]>([]);
	const columnRefsRef = useRef<Record<string, KanbanColumnHandle | null>>({});

	const hasUpdates =
		columns &&
		(columns.in_progress.length > 0 ||
			columns.completed.length > 0 ||
			columns.failed.length > 0);

	// Detect card movements between columns and trigger animation
	useEffect(() => {
		if (!prevColumnsRef.current || !columns) {
			prevColumnsRef.current = columns;
			return;
		}

		const prev = prevColumnsRef.current;
		const curr = columns;
		const statuses = ["pending", "in_progress", "completed", "failed"] as const;

		for (const status of statuses) {
			const prevIds = new Set((prev[status] || []).map((c) => c.id));
			const currIds = new Set((curr[status] || []).map((c) => c.id));

			// Find newly added cards to this column
			for (const id of currIds) {
				if (!prevIds.has(id)) {
					// Card moved TO this column
					setHighlightedCardId(id);
					// Auto-scroll to the column containing this card
					setTimeout(() => {
						const colRef = columnRefsRef.current[status];
						colRef?.scrollIntoView();
					}, 100);
					break;
				}
			}
		}
		prevColumnsRef.current = columns;
	}, [columns]);

	// Clear highlight after animation
	useEffect(() => {
		if (highlightedCardId) {
			const timer = setTimeout(() => setHighlightedCardId(null), 2000);
			return () => clearTimeout(timer);
		}
	}, [highlightedCardId]);

	// AC changed comes from API response (compares ac_versions.created_at vs tasks.created_at)
	const acChanged = data?.acChanged || false;

	// Pull-to-refresh for mobile: one refresh per gesture so a single
	// downward swipe cannot fan out into overlapping requests.
	const [touchStart, setTouchStart] = useState(0);
	const pullFired = useRef(false);
	const handleTouchStart = (e: React.TouchEvent) => {
		pullFired.current = false;
		setTouchStart(e.touches[0].clientY);
	};
	const handleTouchMove = (e: React.TouchEvent) => {
		if (!pullFired.current && touchStart - e.touches[0].clientY < -100) {
			pullFired.current = true;
			refetch();
		}
	};

	const handleResetProgress = async () => {
		setIsResetting(true);
		try {
			const res = await fetch(
				`/api/projects/${encodeURIComponent(projectId)}/reset-progress`,
				{ method: "POST" },
			);
			const json = (await res.json().catch(() => null)) as unknown;
			if (!res.ok) {
				const message =
					json && typeof json === "object" && "error" in json
						? String((json as { error: unknown }).error)
						: "Gagal mereset progress.";
				showToast(message, "error");
				return;
			}
			const tasksReset =
				json && typeof json === "object" && "tasksReset" in json
					? Number((json as { tasksReset: unknown }).tasksReset)
					: 0;
			showToast(
				tasksReset > 0
					? `${tasksReset} task dikembalikan ke pending.`
					: "Tidak ada progress yang perlu direset.",
				"success",
			);
			setResetDialogOpen(false);
			refetch();
		} catch {
			showToast("Gagal menghubungi server.", "error");
		} finally {
			setIsResetting(false);
		}
	};

	if (isLoading && !data) {
		return (
			<div className="flex h-dvh w-full flex-col bg-onyx text-snow overflow-hidden">
				<header className="border-b border-graphite bg-obsidian px-4 sm:px-6 py-3.5 shrink-0">
					<div className="mx-auto flex w-full max-w-[1400px] items-center justify-between">
						<div className="h-6 w-48 animate-pulse rounded bg-steel/20" />
						<div className="h-8 w-24 animate-pulse rounded bg-steel/20" />
					</div>
				</header>
				<main className="mx-auto flex w-full max-w-[1400px] flex-1 min-h-0 gap-4 py-6 px-4 sm:px-6 lg:px-8 overflow-hidden">
					{["pending", "in_progress", "completed", "failed"].map((status) => (
						<div
							key={status}
							className="flex h-full flex-1 min-w-[260px] shrink-0 flex-col rounded-xl border border-graphite bg-obsidian/30 animate-pulse"
						>
							<div className="h-12 border-b border-graphite/40 bg-obsidian/50 rounded-t-xl" />
							<div className="flex-1 p-3 space-y-3">
								<div className="h-24 rounded bg-steel/10" />
								<div className="h-20 rounded bg-steel/10" />
							</div>
						</div>
					))}
				</main>
			</div>
		);
	}

	if (isError && !data) {
		return (
			<div className="flex h-full w-full flex-col bg-onyx text-snow items-center justify-center p-6">
				<AlertTriangleIllustration />
				<h2 className="mt-4 text-lg font-bold text-snow">
					Gagal memuat Kanban
				</h2>
				<p className="mt-2 text-sm text-fog max-w-xs text-center">
					Koneksi ke server bermasalah. Pastikan internet Anda aktif dan coba
					lagi.
				</p>
				<Button onClick={refetch} variant="default" className="mt-6 gap-1.5">
					<Loader2 size={14} className="hidden" />
					Coba Lagi
				</Button>
			</div>
		);
	}

	return (
		<div
			className="flex h-dvh flex-col bg-onyx text-snow overflow-hidden"
			onTouchStart={handleTouchStart}
			onTouchMove={handleTouchMove}
		>
			{/* Kanban Header / Navigation bar */}
			<header className="border-b border-graphite bg-obsidian px-4 sm:px-6 py-3.5 shrink-0">
				<div className="mx-auto flex w-full max-w-[1400px] flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
					<div className="flex flex-col min-w-0">
						<div className="flex items-center gap-2.5 min-w-0">
							<KanbanSquare size={18} className="text-indigo shrink-0" />
							<h1 className="truncate font-inter text-base sm:text-lg font-[600] text-snow">
								Kanban - {projectName}
							</h1>
						</div>

						{/* CLI / Connection status as supporting metadata */}
						<div className="mt-1 flex items-center gap-1.5 text-xs min-w-0">
							{staleness === "disconnected" ? (
								<output className="flex items-center gap-1.5 text-crimson min-w-0">
									<AlertTriangle
										size={13}
										className="shrink-0"
										aria-hidden="true"
									/>
									<span className="truncate">
										Koneksi terputus · Pastikan server aktif
									</span>
									<button
										type="button"
										onClick={refetch}
										disabled={isLoading}
										className="underline hover:text-snow cursor-pointer text-xs ml-1 shrink-0"
									>
										Hubungkan kembali
									</button>
								</output>
							) : staleness === "stale" ? (
								<output className="flex items-center gap-1.5 text-amber min-w-0">
									<AlertTriangle
										size={13}
										className="shrink-0"
										aria-hidden="true"
									/>
									<span className="truncate">
										Koneksi lambat · Menampilkan data terakhir
									</span>
									<button
										type="button"
										onClick={refetch}
										disabled={isLoading}
										className="underline hover:text-snow cursor-pointer text-xs ml-1 shrink-0"
									>
										Coba lagi
									</button>
								</output>
							) : !hasUpdates ? (
								<output className="flex items-center gap-1.5 text-fog min-w-0">
									<Info
										size={13}
										className="shrink-0 text-slate"
										aria-hidden="true"
									/>
									<span className="truncate">
										Belum ada update status · Jalankan PrdFy CLI untuk update
										otomatis
									</span>
								</output>
							) : (
								<output className="flex items-center gap-1.5 text-fog min-w-0">
									<span
										className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0"
										aria-hidden="true"
									/>
									<span className="truncate">Tersinkronisasi dengan CLI</span>
								</output>
							)}
						</div>
					</div>

					<div className="flex items-center gap-2 sm:gap-3 shrink-0 self-start sm:self-center">
						{lastUpdateAt && (
							<span className="text-[10px] text-fog/60 font-mono hidden md:inline">
								Update: {new Date(lastUpdateAt).toLocaleTimeString()}
							</span>
						)}
						{canResetProgress(columns ?? null) && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => setResetDialogOpen(true)}
								disabled={isResetting}
								className="gap-1.5"
							>
								<RotateCcw size={14} />
								{isResetting ? "Mereset..." : "Reset Progress"}
							</Button>
						)}
						<Link
							to="/task/$id"
							params={{ id: projectId }}
							className="btn-primary px-3 py-1.5 rounded-md text-xs font-[510]"
						>
							Roadmap
						</Link>
						<Link
							to="/"
							className="px-3 py-1.5 rounded-md text-xs font-[510] flex items-center gap-1.5 border border-snow/40 text-snow hover:border-snow/70 transition-colors bg-transparent"
						>
							Kembali ke Beranda
						</Link>
					</div>
				</div>
			</header>

			{/* AC Changed Banner (Only shown if AC was updated after tasks generated) */}
			{!dismissedBanners.includes("ac-changed") && acChanged && (
				<div className="w-full shrink-0 px-4 pt-3">
					<div className="flex items-center justify-between rounded-md border border-amber/30 bg-amber/10 p-3 text-sm text-amber animate-slide-down">
						<div className="flex items-center gap-2">
							<AlertTriangle size={16} className="shrink-0" />
							<span>
								AC telah berubah. Task mungkin tidak sesuai kriteria terbaru.
							</span>
						</div>
						<Button
							variant="ghost"
							size="sm"
							onClick={() =>
								setDismissedBanners((prev) => [...prev, "ac-changed"])
							}
							className="h-8 text-amber/80 hover:text-amber hover:bg-amber/10"
						>
							<ArrowUpDown size={12} className="mr-1" />
							Tutup
						</Button>
					</div>
				</div>
			)}

			{/* Centered Main Content Container */}
			<main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col min-h-0 overflow-hidden px-4 sm:px-6 lg:px-8">
				{/* Toolbar: Phase Filter & Progress Bar */}
				{hasProjectTasks && (
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center pt-4 pb-3 shrink-0">
						{/* Left: Phase Filter */}
						<div className="flex items-center gap-2 shrink-0">
							<span className="text-xs font-medium text-fog">Fase:</span>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<button
										type="button"
										className="inline-flex items-center justify-between gap-2 rounded-md border border-graphite bg-charcoal px-3 py-1.5 text-xs font-medium text-snow hover:border-steel hover:bg-steel/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo transition-colors cursor-pointer"
										aria-label="Filter berdasarkan fase project"
									>
										<span
											className="max-w-[160px] sm:max-w-[200px] truncate"
											title={selectedPhaseLabel}
										>
											{selectedPhaseLabel}
										</span>
										<ChevronDown
											size={13}
											className="text-fog shrink-0"
											aria-hidden="true"
										/>
									</button>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align="start"
									className="w-56 sm:w-64 max-h-72 overflow-y-auto custom-scrollbar p-1"
								>
									{[
										{ id: null, label: "Semua" },
										...phases.map((phase) => ({
											id: phase.id,
											label: phase.label,
										})),
									].map((item) => {
										const isSelected = selectedPhase === item.id;
										return (
											<DropdownMenuItem
												key={item.id ?? "all"}
												onClick={() => setSelectedPhase(item.id)}
												className={cn(
													"flex items-center gap-2 px-2.5 py-1.5 text-xs rounded cursor-pointer transition-colors",
													isSelected
														? "bg-steel/15 text-snow font-semibold dark:bg-steel/25"
														: "text-mist hover:text-snow hover:bg-steel/10",
												)}
											>
												<span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
													{isSelected && (
														<Check
															size={13}
															className="text-snow shrink-0"
															aria-hidden="true"
														/>
													)}
												</span>
												<span className="truncate" title={item.label}>
													{item.label}
												</span>
											</DropdownMenuItem>
										);
									})}
								</DropdownMenuContent>
							</DropdownMenu>
						</div>

						{/* Right: Progress info & bar spanning remaining horizontal space */}
						<div className="flex-1 flex items-center gap-3 sm:ml-4 min-w-0">
							<div
								className="flex-1 min-w-[100px] h-2 rounded-full bg-steel/30 dark:bg-steel/40 overflow-hidden"
								role="progressbar"
								aria-valuenow={progress.pct}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-label="Progress penyelesaian task"
							>
								<div
									className="h-full rounded-full bg-indigo transition-all duration-500 ease-out"
									style={{ width: `${progress.pct}%` }}
								/>
							</div>
							<span className="shrink-0 text-xs text-fog font-mono tabular-nums whitespace-nowrap">
								{progress.done}/{progress.total} task selesai ({progress.pct}%)
							</span>
						</div>
					</div>
				)}

				{/* Main Column Layout Area */}
				<section
					className="flex-1 overflow-x-auto overflow-y-hidden select-none custom-scrollbar snap-x snap-mandatory sm:snap-none pt-2 pb-6 min-h-0"
					aria-label="Kanban columns"
				>
					{!hasProjectTasks && data?.taskStatus === "generating" ? (
						// Tasks are being generated by AI — show skeleton columns
						<div className="flex h-full min-w-full gap-4">
							{["pending", "in_progress", "completed", "failed"].map(
								(status) => (
									<div
										key={status}
										className="flex h-full flex-1 min-w-[260px] shrink-0 flex-col rounded-xl border border-graphite bg-obsidian/30 animate-pulse"
									>
										<div className="h-12 border-b border-graphite/40 bg-obsidian/50 rounded-t-xl flex items-center px-4">
											<div className="h-4 w-24 rounded bg-steel/20" />
										</div>
										<div className="flex-1 p-3 space-y-3">
											<div className="h-24 rounded bg-steel/10" />
											<div className="h-20 rounded bg-steel/10" />
											<div className="h-16 rounded bg-steel/10" />
										</div>
									</div>
								),
							)}
						</div>
					) : !hasProjectTasks ? (
						<div className="flex h-full w-full flex-col items-center justify-center text-center">
							<KanbanSquare size={56} className="text-fog/40 mb-3" />
							<h2 className="text-base font-[510] text-snow">Belum ada task</h2>
							<p className="text-xs text-fog max-w-sm mt-1.5 leading-relaxed">
								Task akan muncul di sini setelah proses generate selesai.
							</p>
						</div>
					) : !hasVisibleTasks ? (
						<div className="flex h-full w-full flex-col items-center justify-center text-center">
							<p className="text-sm font-[510] text-snow">
								Tidak ada task pada fase ini
							</p>
							<p className="text-xs text-fog max-w-sm mt-1.5 leading-relaxed">
								Tidak ada task yang terhubung dengan &ldquo;{selectedPhaseLabel}
								&rdquo;.
							</p>
							<button
								type="button"
								onClick={() => setSelectedPhase(null)}
								className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-graphite bg-obsidian px-3 py-1.5 text-xs font-[510] text-snow hover:border-steel transition-colors"
							>
								Tampilkan Semua
							</button>
						</div>
					) : (
						<div className="flex h-full min-w-full gap-4">
							<KanbanColumn
								ref={(el) => {
									columnRefsRef.current.pending = el;
								}}
								title="Belum Mulai"
								count={visibleColumns?.pending.length || 0}
								cards={visibleColumns?.pending || []}
								highlightedCardId={highlightedCardId}
							/>
							<KanbanColumn
								ref={(el) => {
									columnRefsRef.current.in_progress = el;
								}}
								title="Dikerjakan"
								count={visibleColumns?.in_progress.length || 0}
								cards={visibleColumns?.in_progress || []}
								highlightedCardId={highlightedCardId}
							/>
							<KanbanColumn
								ref={(el) => {
									columnRefsRef.current.completed = el;
								}}
								title="Selesai"
								count={visibleColumns?.completed.length || 0}
								cards={visibleColumns?.completed || []}
								highlightedCardId={highlightedCardId}
							/>
							<KanbanColumn
								ref={(el) => {
									columnRefsRef.current.failed = el;
								}}
								title="Gagal"
								count={visibleColumns?.failed.length || 0}
								cards={visibleColumns?.failed || []}
								highlightedCardId={highlightedCardId}
							/>
						</div>
					)}
				</section>
			</main>

			{/* Project Resources Drawer & Document Review Modal (matches Task page behavior) */}
			<ProjectDocumentsDrawer
				isOpen={isProjectDrawerOpen}
				onClose={() => setProjectDrawerOpen(false)}
				projectName={projectName}
				hasPrd={Boolean(latestPrdContent)}
				hasAc={Boolean(latestAcContent)}
				onSelectDocument={(docType) => {
					setProjectDrawerOpen(false);
					setActiveReviewModal(docType);
				}}
			/>

			<DocumentReviewModal
				isOpen={activeReviewModal !== null}
				onClose={() => setActiveReviewModal(null)}
				type={activeReviewModal}
				projectName={projectName}
				content={
					activeReviewModal === "prd"
						? (latestPrdContent ?? null)
						: (latestAcContent ?? null)
				}
			/>

			<Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>Reset progress task?</DialogTitle>
						<DialogDescription>
							Status semua task dikembalikan ke <strong>pending</strong> supaya
							agent bisa mengerjakannya dari awal. Task, PRD, dan AC tidak
							diubah, dan tidak ada kredit yang terpakai.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="ghost"
							onClick={() => setResetDialogOpen(false)}
							disabled={isResetting}
						>
							Batal
						</Button>
						<Button
							onClick={() => void handleResetProgress()}
							disabled={isResetting}
						>
							{isResetting ? "Mereset..." : "Reset Progress"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function AlertTriangleIllustration() {
	return (
		<div className="rounded-full bg-crimson/15 p-4 text-crimson">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="32"
				height="32"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				role="img"
				aria-label="Peringatan Galat"
			>
				<title>Peringatan Galat</title>
				<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
				<line x1="12" y1="9" x2="12" y2="13" />
				<line x1="12" y1="17" x2="12.01" y2="17" />
			</svg>
		</div>
	);
}
