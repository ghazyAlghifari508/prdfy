"use client";

import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, X } from "lucide-react";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useTransition,
} from "react";
import { ChatPanel } from "@/components/chat";
import { CreditExhaustedModal } from "@/components/chat/credit-exhausted-modal";
import { GenerationProgress } from "@/components/shared/generation-progress";
import { usePanelResize } from "@/hooks/use-panel-resize";
import { isPrdLocked } from "@/lib/flow-progress";
import { getPendingPrdPrompt } from "@/lib/prompt-handoff";
import { cn } from "@/lib/utils";
import { useChatStore, useUIStore } from "@/store";
import type { Plan, PrdVersion } from "@/types/database";
import { PrdViewer } from "./prd-viewer";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface PrdDetailProps {
	projectId?: string;
	projectName?: string;
	step?: string | null;
	latestVersion?: PrdVersion;
	allVersions?: PrdVersion[];
	conversationId?: string;
	isChatOpen?: boolean;
	plan?: Plan;
	revisionLimit?: number;
	initialMessages?: Array<{
		id: string;
		role: string;
		content: string;
		created_at: string;
	}>;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export function PrdDetail({
	projectId,
	projectName,
	step,
	latestVersion,
	allVersions = [],
	conversationId,
	isChatOpen: _initialChatOpen = false,
	plan = "free",
	revisionLimit: _revisionLimit,
	initialMessages = [],
}: PrdDetailProps) {
	const isReadOnly = isPrdLocked(step);
	// ── State ──
	const [currentContent, setCurrentContent] = useState(
		latestVersion?.content || "",
	);
	const [selectedVersionNum, setSelectedVersionNum] = useState(
		latestVersion?.version || 1,
	);
	const [activeTab, setActiveTab] = useState<"doc" | "chat">("doc");
	// ponytail: versions list must be client-refreshable after revision - server-rendered
	// allVersions stays stale until next page load. Track locally so version history
	// appears immediately after revision without requiring a full page refresh.
	const [versions, setVersions] = useState(allVersions);
	const isChatOpen = useUIStore((s) => s.isChatPanelOpen);
	const [isStepLoading, setIsStepLoading] = useState(false);
	const [paywallOpen, setPaywallOpen] = useState(false);

	// ── Hooks ──
	const { rightWidth, onStartDragRight, isDraggingRight } = usePanelResize();
	const navigate = useNavigate();
	const [, startTransition] = useTransition();
	const {
		isGeneratingPRD,
		streamingPRDContent,
		setGeneratingPRD,
		setStreamingPRDContent,
		setMessages,
		creditsExhausted: _creditsExhausted,
	} = useChatStore();
	const showToast = useUIStore((s) => s.showToast);

	// ── Typewriter reveal (generation only) ──
	// ponytail: 9router reasoning models emit no deltas during their long thinking
	// phase, then burst the whole document in <2s — PrdViewer renders it
	// "instantly", so the typing animation never appears. Reveal the received PRD
	// progressively (~50 chars/25ms) while generating so it looks like the AI is
	// typing. Cosmetic only: the underlying streamingPRDContent/currentContent
	// stays whole, so the saved document is never truncated.
	const [revealChars, setRevealChars] = useState<number | null>(null);
	const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (!isGeneratingPRD) {
			setRevealChars(null);
			if (revealTimer.current) clearTimeout(revealTimer.current);
			return;
		}
		setRevealChars(0);
		const tick = () => {
			// Cap to content that has actually arrived. Reasoning models sit
			// silent for 15-90s before bursting the whole PRD at once — without
			// this cap the ticker keeps counting up during that silent phase
			// (2000 chars/sec x tens of seconds = tens of thousands of "revealed"
			// chars against zero real content), so the moment the burst lands,
			// revealChars is already past its length and the whole document
			// snaps in instead of typing out from section 1.
			const liveLen = useChatStore.getState().streamingPRDContent.length;
			setRevealChars((prev) =>
				prev === null ? null : Math.min(prev + 50, liveLen),
			);
			revealTimer.current = setTimeout(tick, 25);
		};
		revealTimer.current = setTimeout(tick, 25);
		return () => {
			if (revealTimer.current) clearTimeout(revealTimer.current);
		};
	}, [isGeneratingPRD]);

	const streamingForView = useMemo(() => {
		if (!streamingPRDContent) return streamingPRDContent;
		if (revealChars === null || revealChars >= streamingPRDContent.length)
			return streamingPRDContent;
		return streamingPRDContent.slice(0, revealChars);
	}, [streamingPRDContent, revealChars]);

	// ── Effects ──

	// Sync chat messages - always set messages when initialMessages change
	// (survives refresh by loading from DB server-side).
	useEffect(() => {
		const store = useChatStore.getState();
		const isDifferentProject = store.activeProjectId !== (projectId || null);
		if (isDifferentProject) {
			store.setActiveProject(projectId || null);
		}
		if (initialMessages && initialMessages.length > 0) {
			setMessages(
				initialMessages.map((m) => ({
					id: m.id,
					role: m.role as "user" | "assistant" | "system",
					content: m.content,
					timestamp: new Date(m.created_at).getTime(),
				})),
			);
		} else if (isDifferentProject) {
			setMessages([]);
		}
	}, [projectId, initialMessages, setMessages]);

	// Sync content when latestVersion updates
	useEffect(() => {
		if (latestVersion) setCurrentContent(latestVersion.content);
	}, [latestVersion]);

	// Clear streaming state when mounted with saved PRD, and when navigating
	// between projects so stale Zustand globals from a prior streaming session
	// don't render a false generation state.
	useEffect(() => {
		const store = useChatStore.getState();
		const isDifferentProject = projectId && store.activeProjectId !== projectId;
		if (latestVersion?.content) {
			setGeneratingPRD(false);
			setStreamingPRDContent("");
		} else if (isDifferentProject) {
			setStreamingPRDContent("");
			if (!getPendingPrdPrompt()) {
				setGeneratingPRD(false);
			}
		} else if (!projectId) {
			setGeneratingPRD(false);
			setStreamingPRDContent("");
		}
	}, [projectId, latestVersion, setGeneratingPRD, setStreamingPRDContent]);

	// ── Handlers ──

	// ponytail: re-fetch versions list client-side so version history updates
	// immediately after revision without full page refresh
	const refreshVersions = useCallback(async (): Promise<PrdVersion[]> => {
		if (!projectId) return [];
		try {
			const res = await fetch(`/api/projects/${projectId}/versions`);
			if (res.ok) {
				const data = await res.json();
				setVersions(data);
				return data;
			}
		} catch (err) {
			console.error("Failed to refresh versions:", err);
		}
		return [];
	}, [projectId]);

	const handleVersionSelect = useCallback(
		(content: string, version: number) => {
			setCurrentContent(content);
			setSelectedVersionNum(version);
		},
		[],
	);

	// ponytail: after revision completes, update content, refresh versions list,
	// and jump selectedVersionNum to the new version - otherwise the Version
	// History label stays pinned to whatever version was current on page load.
	const handlePrdRevised = useCallback(
		async (content: string) => {
			setCurrentContent(content);
			const refreshed = await refreshVersions();
			if (refreshed.length > 0) {
				setSelectedVersionNum(Math.max(...refreshed.map((v) => v.version)));
			}
		},
		[refreshVersions],
	);

	const handleProjectCreated = useCallback(
		(newProjectId: string) => {
			startTransition(() => {
				navigate({ to: "/prd/$id", params: { id: newProjectId } });
			});
		},
		[navigate, startTransition],
	);

	const toggleChat = useUIStore((s) => s.toggleChatPanel);

	// ponytail: stable identity so PrdViewer's memo isn't defeated by a fresh
	// array on every parent render (e.g. during chat-panel width dragging).
	const mappedVersions = useMemo(
		() =>
			versions?.map((v) => ({
				id: v.id,
				version: v.version,
				content: v.content,
				change_summary: v.change_summary,
				created_at: v.created_at,
			})),
		[versions],
	);

	const _handleStepAc = async () => {
		if (!projectId || isStepLoading) return;
		setIsStepLoading(true);
		try {
			const res = await fetch(`/api/projects/${projectId}/step`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ step: "ac" }),
			});
			if (!res.ok) throw new Error("Gagal memperbarui tahap proyek");
			startTransition(() => {
				navigate({ to: "/ac/$id", params: { id: projectId } });
			});
		} catch (err) {
			console.error("Step to AC failed:", err);
			showToast("Gagal lanjut ke Acceptance Criteria.", "error");
		} finally {
			setIsStepLoading(false);
		}
	};

	// ── Render ──

	return (
		<div className="flex h-dvh flex-col overflow-hidden bg-onyx text-snow">
			{/* ═══════════ Mobile Tab Toggle (<md) ═══════════ */}
			<div className="flex shrink-0 border-b border-graphite bg-charcoal md:hidden">
				<button
					onClick={() => setActiveTab("doc")}
					className={cn(
						"flex-1 py-2.5 text-center text-sm font-[510] transition-colors border-b-2",
						activeTab === "doc"
							? "border-indigo text-snow bg-white/5"
							: "border-transparent text-fog hover:text-snow",
					)}
				>
					Dokumen
				</button>
				<button
					onClick={() => setActiveTab("chat")}
					className={cn(
						"flex-1 py-2.5 text-center text-sm font-[510] transition-colors border-b-2",
						activeTab === "chat"
							? "border-indigo text-snow bg-white/5"
							: "border-transparent text-fog hover:text-snow",
					)}
				>
					Chat
				</button>
			</div>

			<div className="flex flex-1 overflow-hidden">
				{/* ═══════════ Center Panel (Document View) ═══════════ */}
				<div
					className={cn(
						"flex flex-1 flex-col overflow-hidden min-w-0",
						activeTab !== "doc" && "hidden md:flex",
					)}
					style={{ background: "var(--bg-page)" }}
				>
					{/* Default: PRD content (streaming or saved) */}
					<div className="flex flex-1 flex-col overflow-hidden relative">
						{/* Mobile-only spinner — keeps the full-page blocker for small screens
                where the chat progress card isn't visible. Desktop users see the
                empty PrdViewer + the section progress card in the chat panel. */}
						{/* Pre-stream / waiting-for-first-token: plain load first
						    (desktop+mobile), then rotating thinking steps once the model
						    has been silent a few seconds. Real content replaces it. */}
						{isGeneratingPRD && !streamingPRDContent && !latestVersion && (
							<div className="absolute inset-0 z-10 overflow-y-auto bg-onyx">
								<GenerationProgress label="PRD" />
							</div>
						)}
						<PrdViewer
							content={streamingForView ? streamingForView : currentContent}
							projectName={projectName || ""}
							plan={plan}
							versions={mappedVersions}
							currentVersion={selectedVersionNum}
							onSelectVersion={handleVersionSelect}
							projectId={projectId}
							className="flex-1 overflow-hidden"
						/>
						{plan === "free" && latestVersion && (
							<div className="shrink-0 border-t border-graphite bg-charcoal/40 px-4 py-3">
								<div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
									<p className="text-sm text-fog">
										Lanjut ke AC butuh Pro — Generate Acceptance Criteria hanya
										untuk paket Pro/Hengker.
									</p>
									<button
										type="button"
										onClick={() => setPaywallOpen(true)}
										className="btn-primary flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-[510] transition-all hover:brightness-105 active:scale-[0.98]"
									>
										<span className="whitespace-nowrap">Upgrade ke Pro</span>
										<ArrowRight size={12} />
									</button>
								</div>
							</div>
						)}
					</div>
				</div>

				{/* ═══════════ Right Panel: Desktop Chat ═══════════ */}
				<div
					id="print-hide-chat"
					style={{
						width: isChatOpen ? `${rightWidth}px` : "0px",
						background: "var(--bg-elevated)",
					}}
					className={cn(
						"group/right-sidebar relative hidden shrink-0 border-l border-graphite print:hidden xl:block",
						!isDraggingRight && "transition-all duration-300",
						!isChatOpen && "overflow-hidden border-none",
					)}
				>
					{isChatOpen && (
						<div
							className="absolute bottom-0 left-[-4px] top-0 z-10 w-2 cursor-col-resize transition-colors hover:bg-indigo/20"
							onMouseDown={onStartDragRight}
						/>
					)}
					<div
						className="h-full w-full"
						style={{ display: isChatOpen ? "block" : "none" }}
					>
						<ChatPanel
							projectId={projectId}
							conversationId={conversationId}
							onProjectCreated={handleProjectCreated}
							onPrdRevised={handlePrdRevised}
							className="w-full"
							enableAutoSubmit={true}
							inputDisabled={!projectId && !isGeneratingPRD}
							isReadOnly={isReadOnly}
							currentPrdContent={currentContent}
							userPlan={plan}
							selectedVersionNum={selectedVersionNum}
						/>
					</div>
				</div>

				{/* ═══════════ Mobile Chat View (<md) & Drawer (md to xl) ═══════════ */}
				{/* 1. Full panel for Mobile View tab toggle (<md) */}
				{activeTab === "chat" && (
					<div className="flex-1 overflow-hidden md:hidden">
						<ChatPanel
							projectId={projectId}
							conversationId={conversationId}
							onProjectCreated={handleProjectCreated}
							onPrdRevised={handlePrdRevised}
							className="h-full w-full border-none"
							enableAutoSubmit={false}
							inputDisabled={!projectId && !isGeneratingPRD}
							isReadOnly={isReadOnly}
							currentPrdContent={currentContent}
							userPlan={plan}
							selectedVersionNum={selectedVersionNum}
						/>
					</div>
				)}

				{/* 2. Slide-over drawer for tablet screens (md to xl) */}
				<div className="hidden md:block xl:hidden print:hidden">
					{isChatOpen && (
						<div
							role="dialog"
							aria-modal="true"
							aria-label="Panel chat revisi"
							className="fixed bottom-0 left-0 right-0 z-40 h-[60vh] rounded-t-xl bg-charcoal shadow-[var(--shadow-overlay)]"
						>
							<div className="flex items-center justify-between border-b border-graphite px-4 py-2">
								<span className="text-sm font-[510]">Chat</span>
								<button
									onClick={toggleChat}
									aria-label="Tutup chat"
									className="text-fog hover:text-snow"
								>
									<X size={16} />
								</button>
							</div>
							<div className="h-[calc(60vh-44px)]">
								<ChatPanel
									projectId={projectId}
									conversationId={conversationId}
									onProjectCreated={handleProjectCreated}
									onPrdRevised={handlePrdRevised}
									className="w-full border-none"
									enableAutoSubmit={false}
									inputDisabled={!projectId && !isGeneratingPRD}
									isReadOnly={isReadOnly}
									currentPrdContent={currentContent}
									userPlan={plan}
									selectedVersionNum={selectedVersionNum}
								/>
							</div>
						</div>
					)}
				</div>
			</div>

			<CreditExhaustedModal
				isOpen={paywallOpen}
				onClose={() => setPaywallOpen(false)}
				errorMessage="Upgrade ke Pro untuk generate Acceptance Criteria dan lanjut ke tahap berikutnya."
				title="Lanjut ke AC butuh Pro"
				projectId={projectId || ""}
				stage="ac"
				currentPlan={plan}
			/>
		</div>
	);
}
