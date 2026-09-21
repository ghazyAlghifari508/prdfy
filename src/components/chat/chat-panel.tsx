"use client";

import { useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import {
	memo,
	startTransition,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { syncPaymentStatus } from "@/app/actions/payment";
import {
	clearPrdDraft,
	consumePendingPrdPrompt,
	consumeResumeIntent,
	getPrdDraft,
	savePendingPrdPrompt,
	savePrdDraft,
} from "@/lib/prompt-handoff";
import { readSseStream } from "@/lib/sse-stream";
import { cn } from "@/lib/utils";
import { useChatStore, useUIStore } from "@/store";
import type { Plan } from "@/types/database";
import { ChatBubble } from "./chat-bubble";
import { CreditExhaustedModal } from "./credit-exhausted-modal";
import { ResumeErrorModal } from "./resume-error-modal";
import { TypingIndicator } from "./typing-indicator";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function livePatchPrd(baseContent: string, streamContent: string): string {
	if (!baseContent) return streamContent;

	const ALL_SECTION_NAMES_PATCH = [
		"Overview",
		"Goals & Success Metrics",
		"Requirements",
		"Core Features",
		"User Flow",
		"Architecture & Tech Stack",
		"Database Schema",
		"Design & Technical Constraints",
	];

	let patched = baseContent;
	const regex =
		/:::UPDATE_SECTION\[(.*?)\]:::\s*([\s\S]*?)(?::::END_UPDATE:::|$)/g;

	for (const match of streamContent.matchAll(regex)) {
		const sectionName = match[1].trim();
		const newContent = match[2].trim();

		const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const openingTag = `<!-- SECTION: ${escaped} -->`;

		// Strategy 1: strict with closing tag (well-formed PRD).
		let sectionRegex = new RegExp(
			`${openingTag}[\\s\\S]*?<!-- \\/SECTION -->`,
			"gi",
		);
		if (sectionRegex.test(patched)) {
			patched = patched.replace(
				sectionRegex,
				`${openingTag}\n${newContent}\n<!-- /SECTION -->`,
			);
			continue;
		}

		// Strategy 2: lenient - opening tag to next section or end-of-doc.
		// Handles PRD whose stored content lacks closing tags (zero <!-- /SECTION --> found).
		const sectionIdx = ALL_SECTION_NAMES_PATCH.indexOf(sectionName);
		const nextSection =
			sectionIdx >= 0 && sectionIdx < ALL_SECTION_NAMES_PATCH.length - 1
				? ALL_SECTION_NAMES_PATCH[sectionIdx + 1]
				: null;
		const endBoundary = nextSection
			? `(?:[\\s\\S]*?<!-- SECTION: ${nextSection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} -->)`
			: "(?:[\\s\\S]*|$)";
		sectionRegex = new RegExp(`${openingTag}[\\s\\S]*?${endBoundary}`, "gi");
		if (sectionRegex.test(patched)) {
			const endMarker = nextSection
				? `\n\n<!-- SECTION: ${nextSection} -->`
				: "";
			patched = patched.replace(
				sectionRegex,
				`${openingTag}\n${newContent}${endMarker}`,
			);
		}
	}
	return patched;
}

function cleanChatBubble(streamContent: string): string {
	const cleaned = streamContent
		.replace(
			/:::UPDATE_SECTION\[(.*?)\]:::\s*([\s\S]*?)(?::::END_UPDATE:::|$)/g,
			"",
		)
		.trim();
	if (!cleaned) return "";
	return cleaned;
}
// Constants
// ─────────────────────────────────────────────

const MIN_PROMPT_LENGTH = 20;

const ALL_PRD_SECTIONS = [
	"Overview",
	"Goals & Success Metrics",
	"Requirements",
	"Core Features",
	"User Flow",
	"Architecture & Tech Stack",
	"Database Schema",
	"Design & Technical Constraints",
];

// ponytail: detect PRD sections from content. The system prompt asks the AI to
// emit `<!-- SECTION: X -->` comment markers, but the model often skips them and
// writes only markdown `## N. Title` headings instead (verified against live
// output). Relying on markers alone left the progress card permanently empty.
// Parse BOTH styles so the card works regardless of which (if any) the model
// emits. Marker style is exact; heading style strips the `N. ` prefix and
// matches a known section name.
function extractSections(content: string): string[] {
	const found: string[] = [];
	const markerRe = /<!-- SECTION: (.+?) -->/g;

	for (const m of content.matchAll(markerRe)) {
		const name = m[1].trim();
		if (ALL_PRD_SECTIONS.includes(name) && !found.includes(name))
			found.push(name);
	}
	// If markers fully cover the doc, no need for the heading fallback.
	if (found.length >= ALL_PRD_SECTIONS.length) return found;
	const headingRe = /^#{2,3}\s+\d+\.\s+(.+)$/gm;

	for (const m of content.matchAll(headingRe)) {
		const title = m[1].trim();
		const name = ALL_PRD_SECTIONS.find(
			(s) => title === s || title.startsWith(`${s} `),
		);
		if (name && !found.includes(name)) found.push(name);
	}
	return found;
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface ChatPanelProps {
	projectId?: string;
	conversationId?: string;
	className?: string;
	onProjectCreated?: (projectId: string) => void;
	onPrdRevised?: (content: string) => void;
	enableAutoSubmit?: boolean;
	inputDisabled?: boolean;
	isReadOnly?: boolean;
	currentPrdContent?: string;
	selectedVersionNum?: number; // Version number currently viewed (for revision context)
	userPlan?: Plan; // Pass from server to avoid client fetch
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

// ponytail: memoized so parent re-renders that don't change chat props
// (e.g. dragging the PRD panel width) skip this whole subtree.
export const ChatPanel = memo(function ChatPanel({
	projectId,
	conversationId: initialConversationId,
	className,
	onProjectCreated,
	onPrdRevised,
	enableAutoSubmit = true,
	inputDisabled = false,
	isReadOnly = false,
	currentPrdContent = "",
	selectedVersionNum,
	userPlan: initialUserPlan = "free",
}: ChatPanelProps) {
	// ── Local State ──
	const draftKey = projectId ?? "new";
	const [input, setInput] = useState(() => getPrdDraft(projectId ?? "new"));
	// ponytail: keep follow-up draft in sessionStorage so refresh mid-typing
	// doesn't wipe a half-typed PRD revision question.
	useEffect(() => {
		const t = setTimeout(() => savePrdDraft(draftKey, input), 300);
		return () => clearTimeout(t);
	}, [input, draftKey]);
	const [conversationId, setConversationId] = useState(initialConversationId);
	const [streamingContent, setStreamingContent] = useState("");
	const [thinkingText, setThinkingText] = useState("");
	const [showResumeModal, setShowResumeModal] = useState(false);
	const [resumeErrorMsg, setResumeErrorMsg] = useState("");
	const [partialContentStore, setPartialContentStore] = useState("");
	const [originalMessageStore, setOriginalMessageStore] = useState("");
	const [isRevising, setIsRevising] = useState(false);
	// Section generation progress tracking - persisted in Zustand so it
	// survives router.refresh() after generation completes.
	const completedSections = useChatStore((s) => s.completedSections);
	const setCompletedSections = useChatStore((s) => s.setCompletedSections);
	const [currentSection, setCurrentSection] = useState<string | null>(null);

	// ── Refs ──
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const isSubmittingRef = useRef(false);
	const autoSubmitAttemptedRef = useRef(false);
	const abortControllerRef = useRef<AbortController | null>(null);
	const streamingContentRef = useRef(""); // ref to avoid React state timing issues
	const pendingContentRef = useRef(""); // ponytail: throttled flush buffer
	const flushCancelRef = useRef<(() => void) | null>(null); // ponytail: rAF/timeout cancel handle

	// ── Store ──
	const showToast = useUIStore((s) => s.showToast);
	const router = useRouter();
	const navigate = useNavigate();
	const searchStr = useLocation({ select: (l) => l.searchStr });
	const messages = useChatStore((s) => s.messages);
	const isStreaming = useChatStore((s) => s.isStreaming);
	const isGeneratingPRD = useChatStore((s) => s.isGeneratingPRD);
	const creditsExhausted = useChatStore((s) => s.creditsExhausted);
	const addMessage = useChatStore((s) => s.addMessage);
	const setStreaming = useChatStore((s) => s.setStreaming);
	const setGeneratingPRD = useChatStore((s) => s.setGeneratingPRD);
	const setStreamingPRDContent = useChatStore((s) => s.setStreamingPRDContent);
	const setCreditsExhausted = useChatStore((s) => s.setCreditsExhausted);

	// When generation starts, default first section to loading so the progress
	// card shows "Overview" spinning from first paint instead of all pending.
	useEffect(() => {
		if (isGeneratingPRD && !currentSection) {
			setCurrentSection("Overview");
		}
	}, [isGeneratingPRD, currentSection]);

	// ponytail: populate completedSections from the PRD content whenever
	// currentPrdContent changes (e.g. after router.refresh() lands with a
	// freshly-saved PRD). Runs on every content change, not just mount, so a
	// PRD that streams in after the component mounted still populates the
	// card. Uses extractSections so it works even when the AI omits the
	// `<!-- SECTION: -->` markers and writes only markdown headings.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional - only re-run when content changes
	useEffect(() => {
		// isGeneratingPRD guard: during a revise, currentPrdContent is the OLD
		// saved PRD — repopulating here would stomp the live streaming section
		// tracker. Only populate when idle (initial load, post-refresh, done).
		if (!currentPrdContent || isGeneratingPRD) return;
		const found = extractSections(currentPrdContent);
		if (found.length > 0) {
			setCompletedSections(found);
		}
	}, [currentPrdContent]);

	// ── Derived ──
	const isEffectivelyDisabled = inputDisabled && messages.length === 0;

	// ── Effects ──

	// Auto-scroll on new messages
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional re-scroll trigger on new content
	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messages, streamingContent]);

	// Sync isSubmitting with streaming state
	useEffect(() => {
		if (!isStreaming) {
			isSubmittingRef.current = false;
		}
	}, [isStreaming]);

	// Abort active streaming fetch on unmount or project switch so callbacks
	// cannot update global store or parent components with stale project data.
	// biome-ignore lint/correctness/useExhaustiveDependencies: projectId intentionally re-arms cleanup on project switch
	useEffect(() => {
		return () => {
			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
				abortControllerRef.current = null;
			}
		};
	}, [projectId]);

	// ── Handlers ──

	const handleCancel = useCallback(() => {
		abortControllerRef.current?.abort();
		abortControllerRef.current = null;
		setStreaming(false);
		setGeneratingPRD(false);
		setStreamingPRDContent("");
		isSubmittingRef.current = false;
	}, [setStreaming, setGeneratingPRD, setStreamingPRDContent]);

	/**
	 * Stream an API call to /api/chat and handle SSE events.
	 * Shared between handleSend (user-typed) and handleSendWithMessage (auto-submit).
	 */
	const thinkingTextRef = useRef(thinkingText);
	thinkingTextRef.current = thinkingText;

	const streamApiCall = useCallback(
		async (
			body: Record<string, unknown>,
			chatMode: string,
			/** The original user message, used to restore input on error */
			originalMessage: string,
			/** If this is a resume call, the previous partial content */
			existingPartialContent: string = "",
		) => {
			const abortController = new AbortController();
			abortControllerRef.current = abortController;

			let fullContent = "";
			// ponytail: tracks whether the server ever sent a terminal "done" event.
			// When the connection closes silently before that event, the PRD is
			// usually already saved server-side; refresh instead of leaving the UI
			// frozen.
			let gotDoneEvent = false;
			let gotErrorEvent = false;
			let _sawAnyDelta = false;

			// ponytail: batch per-token state commits to one per animation frame.
			// Without this, a 64k-token stream triggers hundreds of re-renders per
			// second of ChatPanel + Navbar + PrdViewer + Mermaid (full markdown
			// re-parse per token). rAF coalesces to ~60fps — same perceived latency,
			// fraction of the render work.
			const flushContent = () => {
				const displayContent = pendingContentRef.current;
				if (!displayContent) return;

				// Section detection (batched — once per frame, not per token)
				if (
					chatMode === "generate" ||
					chatMode === "revise" ||
					chatMode === "resume"
				) {
					const foundSections = extractSections(displayContent);
					if (foundSections.length > 0) {
						const lastSection = foundSections[foundSections.length - 1];
						const prev = foundSections.slice(0, -1);
						const currentCompleted = useChatStore.getState().completedSections;
						const merged = [...currentCompleted];
						prev.forEach((s) => {
							if (!merged.includes(s)) merged.push(s);
						});
						setCompletedSections(merged);
						setCurrentSection(lastSection);
					}
				}

				// Commit content to store (batched)
				if (chatMode === "generate" || chatMode === "resume") {
					setStreamingPRDContent(displayContent);
				} else if (chatMode === "revise") {
					const patched = livePatchPrd(currentPrdContent, displayContent);
					setStreamingPRDContent(patched);
					const cleaned = cleanChatBubble(displayContent);
					streamingContentRef.current = cleaned;
					setStreamingContent(cleaned);
				} else {
					setStreamingContent(displayContent);
				}
			};

			const scheduleFlush = () => {
				// ponytail: throttle, not debounce — a frame already queued must fire.
				// Canceling and rescheduling on every delta (as before) meant a local
				// AI backend emitting deltas faster than 1 frame apart could push the
				// flush back indefinitely, so content only rendered once the stream
				// went quiet — killing the typing/streaming animation entirely.
				if (flushCancelRef.current) return;
				if (typeof requestAnimationFrame !== "undefined") {
					const rafId = requestAnimationFrame(() => {
						flushCancelRef.current = null;
						flushContent();
					});
					flushCancelRef.current = () => cancelAnimationFrame(rafId);
				} else {
					const timeoutId = setTimeout(() => {
						flushCancelRef.current = null;
						flushContent();
					}, 16);
					flushCancelRef.current = () => clearTimeout(timeoutId);
				}
			};

			const cancelFlush = () => {
				if (flushCancelRef.current) {
					flushCancelRef.current();
					flushCancelRef.current = null;
				}
			};

			try {
				const endpoint = "/api/chat";
				const response = await fetch(endpoint, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
					signal: abortController.signal,
				});

				if (!response.ok) {
					const err = await response.json();
					setStreaming(false);
					setGeneratingPRD(false);
					isSubmittingRef.current = false;

					if (response.status === 403 && err.code === "NO_CREDITS") {
						// Save prompt for auto-resume after payment (only for generate mode)
						if (body.mode === "generate") {
							savePendingPrdPrompt(
								body.message as string,
								"auto",
								originalMessage,
							);
						}
						setCreditsExhausted({
							stage: "prd",
							message: err.error || "Kredit habis",
						});
					} else if (response.status === 429) {
						setCreditsExhausted({
							stage: "prd",
							message: err.error || "Terlalu banyak request. Coba lagi nanti.",
						});
					} else if (response.status === 403) {
						showToast(err.error || "Akses ditolak", "error");
					} else {
						showToast(err.error || "Terjadi kesalahan", "error");
					}
					return;
				}

				for await (const data of readSseStream(response.body)) {
					try {
						const parsed = JSON.parse(data);

						if (parsed.type === "started") {
							// no-op: heartbeat from server, just lets the client know
							// generation is in flight.
						} else if (parsed.type === "thinking") {
							setThinkingText((prev) => prev + parsed.content);
						} else if (parsed.type === "delta") {
							if (thinkingTextRef.current) setThinkingText("");
							_sawAnyDelta = true;
							fullContent += parsed.content;

							// ponytail: batch state commits via rAF throttle (scheduleFlush).
							// Per-token setStreamingPRDContent caused full markdown re-parse
							// + Navbar re-render hundreds of times per second. Now coalesced
							// to ~60fps — same perceived latency, fraction of render work.
							pendingContentRef.current = existingPartialContent
								? existingPartialContent + fullContent
								: fullContent;
							scheduleFlush();
						} else if (parsed.type === "done") {
							// ponytail: flush any pending batched content synchronously before
							// done-handler reads/overrides state — ensures last tokens render.
							cancelFlush();
							flushContent();
							pendingContentRef.current = "";
							gotDoneEvent = true;
							if (parsed.conversationId) {
								setConversationId(parsed.conversationId);
							}
							// Mark ALL sections found in the final content as completed.
							// Re-parse from the full accumulated content since at done
							// time every section is fully written - no spinner should remain.
							const finalContentHere = existingPartialContent
								? existingPartialContent + fullContent
								: fullContent;
							const allDone = extractSections(finalContentHere);
							if (allDone.length > 0) {
								setCompletedSections(allDone);
							}
							setCurrentSection(null);
							if (parsed.projectId && onProjectCreated && !projectId) {
								// New project: clear Zustand state before navigation
								setGeneratingPRD(false);
								setStreamingPRDContent("");
								onProjectCreated(parsed.projectId);
							} else if (chatMode === "generate") {
								setGeneratingPRD(false);
								setStreamingPRDContent("");
								if (typeof parsed.content === "string" && parsed.content) {
									onPrdRevised?.(parsed.content);
								}
								startTransition(() => {
									router.invalidate();
								});
							} else if (chatMode === "revise") {
								setGeneratingPRD(false);
								setIsRevising(false);
								// Preserve the streaming natural-language bubble before
								// streamingContent gets cleared in finally.
								const streamingNaturalLanguage =
									streamingContentRef.current || streamingContent;
								// Restore completedSections from the FRESH merged PRD.
								// parsed.content from server has all sections 1-8; parent
								// prop currentPrdContent may be stale (not yet updated).
								const freshContent =
									(typeof parsed.content === "string" && parsed.content) ||
									currentPrdContent;
								if (freshContent) {
									const allSecs = extractSections(freshContent);
									if (allSecs.length > 0) setCompletedSections(allSecs);
								}
								// Server now persists this same preamble as assistantReply
								// (see route.ts) - one bubble only, so refresh shows the
								// exact text the user saw live instead of a second,
								// separately-generated summary.
								const finalReply =
									parsed.summaryMessage || streamingNaturalLanguage;
								if (finalReply) {
									addMessage({
										id: crypto.randomUUID(),
										role: "assistant",
										content: finalReply,
										timestamp: Date.now(),
									});
								}
								// Push the server-merged full PRD (sections 1-8) up to the
								// PRD viewer immediately - don't wait for a refresh.
								if (typeof parsed.content === "string" && parsed.content) {
									onPrdRevised?.(parsed.content);
								}
							}
							break;
						} else if (parsed.type === "error") {
							cancelFlush();
							pendingContentRef.current = "";
							gotErrorEvent = true;
							const errorMsg =
								parsed.error ||
								(chatMode === "generate" ||
								chatMode === "revise" ||
								chatMode === "resume"
									? "Gagal menyusun PRD. Silakan coba lagi."
									: "Gagal memproses pesan. Silakan coba lagi.");

							// If error occurs during PRD generation and we already have some partial content
							const currentDisplayContent = existingPartialContent
								? existingPartialContent + fullContent
								: fullContent;
							if (
								(chatMode === "generate" || chatMode === "resume") &&
								currentDisplayContent.length > 0
							) {
								setGeneratingPRD(false);
								setResumeErrorMsg(errorMsg);
								setPartialContentStore(currentDisplayContent);
								setOriginalMessageStore(originalMessage);
								setShowResumeModal(true);
								return; // Don't add chat bubble, let user interact with modal
							}

							showToast(errorMsg, "error");
							addMessage({
								id: crypto.randomUUID(),
								role: "assistant",
								content: `❌ **Pengiriman Gagal**\n\n${errorMsg}\n\n*Pesan kamu telah dikembalikan ke kotak input. Silakan coba kirim ulang.*`,
								timestamp: Date.now(),
							});

							setGeneratingPRD(false);
							setInput(originalMessage);
							return;
						}
					} catch {
						console.warn("SSE parse failed in chat-panel:", data.slice(0, 80));
					}
				}

				// ── Post-stream: add final message ──
				// ponytail: flush any pending batched content synchronously so the
				// last tokens render before post-stream navigation/message logic.
				cancelFlush();
				flushContent();
				pendingContentRef.current = "";
				// ponytail: if the server side closed the stream without a `done` event
				// (proxy timeout / partial save) the PRD was almost always persisted;
				// refresh so the panel reflects what the server actually has instead of
				// leaving the UI frozen and confusing the user.
				if (
					!gotDoneEvent &&
					!gotErrorEvent &&
					(chatMode === "generate" ||
						chatMode === "revise" ||
						chatMode === "resume")
				) {
					startTransition(() => {
						router.invalidate();
					});
					if (fullContent.trim().length === 0) {
						showToast(
							"Koneksi terputus. PRD mungkin sudah tersimpan sebagian - coba refresh halaman.",
							"info",
						);
					}
					// Server closed without a terminal event — release the loading state so the
					// user isn't stuck on a perpetual spinner until the refresh lands.
					setGeneratingPRD(false);
					setStreamingPRDContent("");
				}

				if (
					chatMode === "generate" ||
					chatMode === "resume" ||
					chatMode === "revise"
				) {
					const finalDisplayContent = existingPartialContent
						? existingPartialContent + fullContent
						: fullContent;
					if (finalDisplayContent.trim()) {
						if (chatMode === "resume") {
							setGeneratingPRD(false);
							startTransition(() => {
								router.invalidate();
							});
						}
						// revise - not reached if done event handled it, but keep
						// state clean in case the stream ended without a done event.
					} else {
						addMessage({
							id: crypto.randomUUID(),
							role: "assistant",
							content:
								"Gagal menyusun PRD. AI tidak menghasilkan konten. Silakan coba lagi.",
							timestamp: Date.now(),
						});
						setGeneratingPRD(false);
					}
				} else {
					// chatMode === 'chat'
					addMessage({
						id: crypto.randomUUID(),
						role: "assistant",
						content: fullContent,
						timestamp: Date.now(),
					});
				}
			} catch (err: unknown) {
				const isAbort = err instanceof Error && err.name === "AbortError";
				if (isAbort) {
					showToast("Proses dihentikan.", "info");
				} else {
					console.error("Chat streaming error:", err);
					showToast("Terjadi kesalahan koneksi.", "error");
				}
				// On any error or abort, generation has ended without a successful done
				// event — clear generating state so the UI isn't stuck with a perpetual spinner.
				if (chatMode === "generate" || chatMode === "resume") {
					setGeneratingPRD(false);
					setStreamingPRDContent("");
					// If we accumulated partial content before the failure, preserve it
					// and offer the resume modal so the user can recover.
					const currentDisplayContent = existingPartialContent
						? existingPartialContent + fullContent
						: fullContent;
					if (!isAbort && currentDisplayContent.trim().length > 0) {
						setResumeErrorMsg("Koneksi terputus saat menyusun PRD.");
						setPartialContentStore(currentDisplayContent);
						setOriginalMessageStore(originalMessage);
						setShowResumeModal(true);
					}
				}
			} finally {
				cancelFlush();
				pendingContentRef.current = "";
				setStreaming(false);
				setStreamingContent("");
				// ponytail: generate/resume modes must NOT clear isGeneratingPRD here —
				// the done handler owns cleanup + router.refresh(). Clearing here hides
				// the section progress card (spinner + checkmarks) before refresh lands.
				if (chatMode !== "generate" && chatMode !== "resume") {
					setGeneratingPRD(false);
					setStreamingPRDContent("");
				}
				isSubmittingRef.current = false;
				abortControllerRef.current = null;
			}
		},
		[
			addMessage,
			currentPrdContent,
			onProjectCreated,
			onPrdRevised,
			projectId,
			setCompletedSections,
			setCreditsExhausted,
			setGeneratingPRD,
			setStreaming,
			setStreamingPRDContent,
			showToast,
			streamingContent,
			router,
		],
	);

	/** Called when the user types a message and clicks send. */
	const handleSend = async (overrideMode?: "chat" | "revise") => {
		const trimmed = input.trim();
		if (!trimmed || isStreaming || isSubmittingRef.current) return;

		const resolvedMode = overrideMode || (projectId ? "revise" : "generate");

		if (resolvedMode === "generate" && trimmed.length < MIN_PROMPT_LENGTH) {
			addMessage({
				id: crypto.randomUUID(),
				role: "assistant",
				content: `Deskripsikan produkmu lebih detail (minimal ${MIN_PROMPT_LENGTH} karakter) agar saya bisa menghasilkan PRD yang berkualitas. Contoh: *"Buatkan PRD untuk aplikasi e-commerce fashion yang mendukung payment gateway dan tracking pengiriman."*`,
				timestamp: Date.now(),
			});
			setInput("");
			return;
		}

		isSubmittingRef.current = true;
		// ponytail: only chat/revise show a user bubble. generate/resume come from
		// the home prompt and must NEVER appear in the chat panel - the progress
		// card above already communicates generation. The chat panel's job after a
		// PRD exists is revision conversation, not echoing the original prompt.
		if (resolvedMode === "chat" || resolvedMode === "revise") {
			addMessage({
				id: crypto.randomUUID(),
				role: "user",
				content: trimmed,
				timestamp: Date.now(),
			});
		}
		if (resolvedMode === "revise") setIsRevising(true);
		setInput("");
		clearPrdDraft();
		setStreaming(true);
		setStreamingContent("");
		setThinkingText("");
		streamingContentRef.current = "";
		if (resolvedMode !== "revise") {
			setStreamingPRDContent("");
		}
		// ponytail: revise never touches streamingPRDContent - the PRD viewer
		// stays on the current full PRD at all times.

		const body: Record<string, unknown> = {
			message: trimmed,
			mode: resolvedMode,
			preferences: {},
		};

		if (conversationId) body.conversationId = conversationId;
		if (projectId) body.projectId = projectId;
		// ponytail: pass selectedVersionNum so server merges against viewed version, not always latest
		if (selectedVersionNum && resolvedMode === "revise")
			body.selectedVersionNum = selectedVersionNum;
		if (resolvedMode === "generate" || resolvedMode === "revise")
			setGeneratingPRD(true);

		await streamApiCall(body, resolvedMode, trimmed);
	};

	/**
	 * Handle resuming a broken PRD generation from the modal.
	 */
	const handleResumePRD = async () => {
		setShowResumeModal(false);

		if (isSubmittingRef.current || !partialContentStore) return;

		isSubmittingRef.current = true;
		setStreaming(true);
		setGeneratingPRD(true);
		// DO NOT CLEAR setStreamingPRDContent! We want the partial text to remain visible.

		const body: Record<string, unknown> = {
			message: originalMessageStore,
			mode: "resume",
			partialContent: partialContentStore,
			preferences: {},
		};

		if (conversationId) body.conversationId = conversationId;
		if (projectId) body.projectId = projectId;

		await streamApiCall(
			body,
			"resume",
			originalMessageStore,
			partialContentStore,
		);
	};

	/**
	 * Called programmatically (e.g. auto-submit from the /ask question flow).
	 * Differs from handleSend: it receives the message as a parameter.
	 */
	const handleSendWithMessage = useCallback(
		async (
			msg: string,
			chatMode: "chat" | "generate" | "revise",
			displayMessage?: string | null,
		) => {
			if (isSubmittingRef.current) return;
			isSubmittingRef.current = true;

			// ponytail: generate/resume are triggered by the home prompt and must
			// NOT surface as a chat bubble - that leaked the internal template
			// wrapper ("Generate PRD lengkap...") into the panel. Only chat/revise
			// (genuine conversation) render a user bubble.
			if (
				displayMessage !== null &&
				(chatMode === "chat" || chatMode === "revise")
			) {
				addMessage({
					id: crypto.randomUUID(),
					role: "user",
					content: displayMessage || msg,
					timestamp: Date.now(),
				});
			}

			setStreaming(true);
			setStreamingContent("");
			streamingContentRef.current = "";
			if (chatMode === "revise") setIsRevising(true);
			if (chatMode !== "revise") {
				setStreamingPRDContent("");
			}
			// ponytail: revise never touches streamingPRDContent - the PRD viewer
			// stays on the current full PRD at all times.
			if (chatMode === "generate" || chatMode === "revise")
				setGeneratingPRD(true);
			if (chatMode === "generate") {
				setCompletedSections([]);
				setCurrentSection("Overview");
			}

			const body: Record<string, unknown> = {
				message: msg,
				mode: chatMode,
				preferences: {},
			};
			if (conversationId) body.conversationId = conversationId;
			if (projectId) body.projectId = projectId;
			// ponytail: pass selectedVersionNum so server merges against viewed version
			if (selectedVersionNum && chatMode === "revise")
				body.selectedVersionNum = selectedVersionNum;

			// Pass the clean display message as `originalMessage` so that if the
			// stream breaks mid-generation, `originalMessageStore` holds the user's
			// original prompt - not the internal AI template wrapper. This prevents
			// the template text from leaking into the chat bubble after a resume.
			await streamApiCall(body, chatMode, displayMessage || msg);
		},
		[
			addMessage,
			conversationId,
			projectId,
			selectedVersionNum,
			setCompletedSections,
			setGeneratingPRD,
			setStreaming,
			setStreamingPRDContent,
			streamApiCall,
		],
	);

	// ── Auto-submit from /ask question flow ──
	// biome-ignore lint/correctness/useExhaustiveDependencies: projectId intentionally resets the guard on project switch
	useEffect(() => {
		// Reset auto-submit guard when switching projects
		autoSubmitAttemptedRef.current = false;
	}, [projectId]);

	useEffect(() => {
		if (
			autoSubmitAttemptedRef.current ||
			isReadOnly ||
			!enableAutoSubmit ||
			isStreaming ||
			messages.length > 0
		)
			return;

		const pending = consumePendingPrdPrompt();
		if (!pending) return;

		autoSubmitAttemptedRef.current = true;

		if (pending.mode === "auto") {
			setGeneratingPRD(true);
			const autoMessage = `Generate PRD lengkap berdasarkan informasi berikut:\n\n${pending.prompt}\n\nGunakan section markers sesuai standar.`;
			// Use displayMessage (original user input) for the chat bubble, fallback to prompt
			const bubbleMessage = pending.displayMessage || pending.prompt;
			void handleSendWithMessage(autoMessage, "generate", bubbleMessage);
		} else {
			void handleSendWithMessage(pending.prompt, "chat");
		}
	}, [
		enableAutoSubmit,
		handleSendWithMessage,
		isReadOnly,
		isStreaming,
		messages.length,
		setGeneratingPRD,
	]);

	// Auto-resume PRD generation after payment return.
	// Keyed by the raw search string + a per-orderId guard: `new
	// URLSearchParams(searchStr)` is a fresh object every render, so the old
	// dep re-ran the resume flow (duplicate sync + generate) while the
	// Midtrans query params were still in the URL.
	const resumedPrdPaymentsRef = useRef<Set<string>>(new Set());
	useEffect(() => {
		const params = new URLSearchParams(searchStr);
		const orderId = params.get("order_id");
		const payment = params.get("payment");
		if (!orderId || payment !== "success" || !projectId) return;
		if (resumedPrdPaymentsRef.current.has(orderId)) return;
		resumedPrdPaymentsRef.current.add(orderId);
		(async () => {
			try {
				const res = await syncPaymentStatus({ data: orderId });
				if (!res.success) return;
				const resumedStage = consumeResumeIntent(projectId);
				if (resumedStage === "prd") {
					// Trigger generate mode with the original prompt
					setGeneratingPRD(true);
					const pending = consumePendingPrdPrompt();
					if (pending) {
						void handleSendWithMessage(
							pending.prompt,
							"generate",
							pending.displayMessage || pending.prompt,
						);
					}
				}
				// Strip Midtrans query params via TanStack Router to keep history in sync
				navigate({ to: ".", search: {}, replace: true });
			} catch (e) {
				console.error("Auto-resume payment sync failed:", e);
			}
		})();
	}, [searchStr, handleSendWithMessage, navigate, projectId, setGeneratingPRD]);

	// ── Render ──

	return (
		<div
			className={cn("flex h-full flex-col border-l border-graphite", className)}
			style={{ background: "var(--bg-elevated)" }}
		>
			{/* Scrollable content: progress card + messages */}
			<div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
				{/* Section Generation Progress */}
				{(currentSection ||
					completedSections.length > 0 ||
					isGeneratingPRD) && (
					<div>
						{!isRevising && (
							<div className="mb-1.5 text-xs font-[510] uppercase tracking-wide text-mist">
								{isGeneratingPRD
									? "PRD sedang di-generate oleh AI"
									: completedSections.length >= ALL_PRD_SECTIONS.length
										? "✅ PRD selesai digenerate"
										: "Proses generate PRD"}
							</div>
						)}
						<div className="rounded-lg border border-graphite bg-charcoal/40 px-4 py-3">
							<div className="space-y-2">
								{ALL_PRD_SECTIONS.map((section) => {
									const isCompleted = completedSections.includes(section);
									const isCurrent = section === currentSection;
									const _isPending = !isCompleted && !isCurrent;
									return (
										<div key={section} className="flex items-center gap-2.5">
											{isCompleted ? (
												<svg
													width="10"
													height="10"
													viewBox="0 0 16 16"
													fill="currentColor"
													className="text-emerald shrink-0"
												>
													<path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
												</svg>
											) : isCurrent ? (
												<svg
													width="12"
													height="12"
													viewBox="0 0 24 24"
													fill="none"
													className="shrink-0 animate-spin text-indigo"
												>
													<circle
														cx="12"
														cy="12"
														r="10"
														stroke="currentColor"
														strokeWidth="3"
														opacity="0.25"
													/>
													<path
														d="M12 2a10 10 0 019.95 9"
														stroke="currentColor"
														strokeWidth="3"
														strokeLinecap="round"
													/>
												</svg>
											) : (
												<svg
													width="10"
													height="10"
													viewBox="0 0 16 16"
													fill="none"
													className="text-slate/40 shrink-0"
												>
													<circle
														cx="4"
														cy="8"
														r="4"
														stroke="currentColor"
														strokeWidth="1.5"
													/>
												</svg>
											)}
											<span
												className={cn(
													"truncate text-sm",
													isCompleted
														? "text-emerald"
														: isCurrent
															? "text-snow"
															: "text-slate",
												)}
											>
												{section}
											</span>
										</div>
									);
								})}
							</div>
						</div>
					</div>
				)}

				{/* Messages */}
				{messages.map((msg) => (
					<ChatBubble key={msg.id} role={msg.role} content={msg.content} />
				))}
				{isStreaming && thinkingText && !streamingContent && (
					<details className="text-xs text-fog/60 mb-2 px-4" open>
						<summary className="cursor-pointer select-none">
							🤔 AI sedang berpikir...
						</summary>
						<pre className="mt-1 whitespace-pre-wrap text-xs text-fog/40 max-h-40 overflow-y-auto custom-scrollbar">
							{thinkingText}
						</pre>
					</details>
				)}
				{isStreaming && streamingContent && (
					<ChatBubble role="assistant" content={streamingContent} isStreaming />
				)}
				{isRevising && !streamingContent && !thinkingText && (
					<TypingIndicator />
				)}
			</div>

			{/* Input Area */}
			<div className="border-t border-graphite p-4">
				{isReadOnly ? (
					<div
						role="status"
						aria-label="PRD dikunci"
						className="flex items-start gap-3 rounded-md border border-graphite/60 bg-charcoal/80 p-3.5 text-xs text-fog"
					>
						<Lock size={16} className="mt-0.5 shrink-0 text-amber-400" />
						<div className="flex flex-col gap-1">
							<span className="font-[510] text-snow">
								Dokumen PRD Dikunci (Read-Only)
							</span>
							<span className="leading-relaxed text-fog/80">
								Proyek telah mencapai tahap Acceptance Criteria / Task. Dokumen
								PRD tetap dapat dibaca dan diekspor sebagai referensi, namun
								revisi dinonaktifkan untuk menjaga konsistensi alur proyek.
							</span>
						</div>
					</div>
				) : (
					<div className="relative flex flex-col rounded-md bg-charcoal shadow-[var(--shadow-inset)] transition-shadow duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] focus-within:shadow-[inset_0_0_0_1px_rgba(94,106,210,0.85)]">
						<textarea
							ref={inputRef}
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									handleSend();
								}
							}}
							placeholder={
								isEffectivelyDisabled
									? "Pilih proyek dari daftar atau buat baru dari beranda"
									: projectId
										? "Ketik pesan atau instruksi revisi PRD..."
										: "Ceritakan ide produkmu..."
							}
							className={cn(
								"w-full resize-none border-none bg-transparent px-3 pb-2 pt-3 text-[14px] text-snow outline-none placeholder:text-slate",
								isEffectivelyDisabled && "cursor-not-allowed opacity-70",
							)}
							style={{
								color: "var(--text-primary)",
								caretColor: "var(--text-primary)",
							}}
							rows={2}
							disabled={isStreaming || isEffectivelyDisabled}
						/>
						<div className="flex items-center justify-between px-3 pb-3 pt-1">
							<button
								onClick={isStreaming ? handleCancel : () => handleSend()}
								disabled={
									!isStreaming &&
									(!input.trim() ||
										isSubmittingRef.current ||
										isEffectivelyDisabled)
								}
								className={cn(
									"flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] disabled:opacity-30 active:scale-[0.98]",
									isStreaming
										? "bg-crimson text-white hover:bg-crimson/90"
										: "btn-primary hover:brightness-105",
								)}
								title={
									isStreaming
										? "Hentikan Proses"
										: projectId
											? "Update PRD"
											: "Generate PRD"
								}
							>
								{isStreaming ? (
									<svg
										width="12"
										height="12"
										viewBox="0 0 16 16"
										fill="currentColor"
									>
										<rect x="3" y="3" width="10" height="10" rx="1" />
									</svg>
								) : (
									<svg width="14" height="14" viewBox="0 0 16 16" fill="none">
										<path
											d="M2 8L14 8M10 4L14 8L10 12"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									</svg>
								)}
							</button>
						</div>
					</div>
				)}
			</div>

			{/* Credit Exhausted Modal */}
			<CreditExhaustedModal
				isOpen={!!creditsExhausted}
				onClose={() => setCreditsExhausted(null)}
				errorMessage={creditsExhausted?.message || ""}
				projectId={projectId || ""}
				stage={creditsExhausted?.stage || "prd"}
				currentPlan={initialUserPlan}
			/>

			{/* Resume PRD Modal */}
			<ResumeErrorModal
				isOpen={showResumeModal}
				onClose={() => setShowResumeModal(false)}
				onResume={handleResumePRD}
				errorMessage={resumeErrorMsg}
			/>
		</div>
	);
});
