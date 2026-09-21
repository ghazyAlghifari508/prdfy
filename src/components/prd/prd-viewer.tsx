"use client";

import {
	lazy,
	memo,
	Suspense,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { PrdDiffViewer } from "./prd-diff-viewer";
import { TableOfContents } from "./table-of-contents";

// ponytail: lazy-load Mermaid so the ~2-3MB mermaid library (layout engines,
// flowchart/sequence/class parsers) stays out of the main PRD chunk. Only
// fetched when a PRD actually contains a mermaid code fence. autoCodeSplitting
// handles route-level split; this handles component-level split within a route.
const Mermaid = lazy(() =>
	import("./mermaid").then((m) => ({ default: m.Mermaid })),
);

import { usePanelResize } from "@/hooks/use-panel-resize";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store";
import type { Plan } from "@/types/database";
import { VersionHistory } from "./version-history";

// ponytail: extracted to module scope so react-markdown re-parses only once
// (not on every parent render). Pure functions — no useMemo needed.
const markdownComponents: Components = {
	h2: ({ children, ...props }) => {
		const text = String(children).replace(/<[^>]*>/g, "");
		const id = text.toLowerCase().replace(/[^\w]+/g, "-");
		return (
			<h2 id={id} {...props}>
				{children}
			</h2>
		);
	},
	h3: ({ children, ...props }) => {
		const text = String(children).replace(/<[^>]*>/g, "");
		const id = text.toLowerCase().replace(/[^\w]+/g, "-");
		return (
			<h3 id={id} {...props}>
				{children}
			</h3>
		);
	},
	h4: ({ children, ...props }) => {
		const text = String(children).replace(/<[^>]*>/g, "");
		const id = text.toLowerCase().replace(/[^\w]+/g, "-");
		return (
			<h4 id={id} {...props}>
				{children}
			</h4>
		);
	},
	code: ({ className, children, ...props }) => {
		const match = /language-(\w+)/.exec(className || "");
		if (match && match[1] === "mermaid") {
			return (
				<Suspense
					fallback={
						<div className="animate-pulse bg-black/5 dark:bg-white/5 h-32 rounded-lg my-6" />
					}
				>
					<Mermaid chart={String(children).replace(/\n$/, "")} />
				</Suspense>
			);
		}
		return (
			<code className={className} {...props}>
				{children}
			</code>
		);
	},
};

// ponytail: module-scope stable identities. Inline arrays like
// `[remarkGfm]` create a new reference every render, defeating react-markdown's
// internal memoization and forcing a full document re-parse.
const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

// ponytail: extracted + memoized so TOC width dragging (leftWidth state lives
// inside this file and re-renders it every animation frame) never re-parses or
// re-renders the markdown document. Mirrors how chat-panel resizing stays
// smooth: the heavy subtree is memoized away from the width state owner.
const PrdPreview = memo(function PrdPreview({ content }: { content: string }) {
	return (
		<article className="prd-content mx-auto max-w-3xl px-8 pb-16 pt-8 text-mist">
			<Markdown
				remarkPlugins={remarkPlugins}
				rehypePlugins={rehypePlugins}
				components={markdownComponents}
			>
				{content}
			</Markdown>
		</article>
	);
});

interface PrdVersion {
	id: string;
	version: number;
	content: string;
	change_summary: string | null;
	created_at: string;
}

interface PrdViewerProps {
	content: string;
	projectName: string;
	className?: string;
	plan?: Plan;
	versions?: PrdVersion[];
	currentVersion?: number;
	onSelectVersion?: (content: string, version: number) => void;
	projectId?: string;
}

export const PrdViewer = memo(function PrdViewer({
	content,
	projectName,
	className,
	plan = "free",
	versions,
	currentVersion,
	onSelectVersion,
	projectId,
}: PrdViewerProps) {
	const { leftWidth, onStartDragLeft, isDraggingLeft } = usePanelResize();
	const scrollRef = useRef<HTMLDivElement>(null);
	const [activeTab, setActiveTab] = useState<"preview" | "diff">("preview");
	const [isExporting, setIsExporting] = useState(false);
	const showToast = useUIStore((s) => s.showToast);

	// Diff always compares the previous version against the current one —
	// clicking the Diff tab shows the latest changes immediately. Version
	// switching lives in Version History; no extra picker here.
	const hasDiff = !!versions && versions.length > 1;
	const previousVersion = useMemo(() => {
		if (!versions || versions.length <= 1 || currentVersion === undefined)
			return undefined;
		const strictlyEarlier = versions
			.filter((v) => v.version < currentVersion)
			.sort((a, b) => b.version - a.version);
		if (strictlyEarlier.length > 0) return strictlyEarlier[0]?.version;
		// Fallback when viewing v1: diff against the nearest available revision
		const others = versions
			.filter((v) => v.version !== currentVersion)
			.sort((a, b) => a.version - b.version);
		return others[0]?.version;
	}, [versions, currentVersion]);

	// Auto-scroll logic when new content arrives
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional re-scroll on content change
	useEffect(() => {
		if (scrollRef.current) {
			const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
			// If we're within 150px of the bottom, auto scroll down to follow new content
			const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
			if (isNearBottom) {
				scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
			}
		}
	}, [content]);

	// Membersihkan sisa tag markdown (misal ```markdown di awal dan ``` di akhir)
	// yang sering kali ditambahkan secara otomatis oleh AI.
	// ponytail: memoize by `content` so we don't re-run the regex chain on every
	// render delta (PRD streaming can produce 200+ renders).
	const cleanContent = useMemo(() => {
		let cleaned = content.replace(/<!--[\s\S]*?-->/g, "").trim();

		const startMatch = cleaned.match(/```(?:markdown|md)\s*\n/i);

		if (startMatch) {
			if (startMatch.index !== undefined && startMatch.index < 500) {
				const startIndex = startMatch.index + startMatch[0].length;
				const lastIndex = cleaned.lastIndexOf("```");

				if (lastIndex > startIndex) {
					cleaned = cleaned.substring(startIndex, lastIndex);
				} else {
					cleaned = cleaned.substring(startIndex);
				}
			}
		} else {
			if (cleaned.startsWith("```\n")) {
				const lastIndex = cleaned.lastIndexOf("```");
				if (lastIndex > 3) {
					cleaned = cleaned.substring(4, lastIndex);
				}
			} else if (cleaned.startsWith("```")) {
				const lastIndex = cleaned.lastIndexOf("```");
				if (lastIndex > 2) {
					cleaned = cleaned.substring(3, lastIndex);
				}
			}
		}
		// Strip ===DONE=== marker that AI outputs as completion signal.
		// Stop sequence should catch it, but sometimes it leaks into saved content.
		cleaned = cleaned.replace(/={3,}DONE={3,}/gi, "").trim();

		return cleaned.trim();
	}, [content]);

	return (
		<div className={cn("flex h-full", className)}>
			{/* Width/handle live on this wrapper: the aside below scrolls
			    (overflow-y-auto), and a scrolling ancestor clips absolutely
			    positioned children at its padding edge — a handle inside the
			    aside would lose its outboard half, leaving the grab area
			    shifted left of the divider. */}
			<div
				style={{ width: `${leftWidth}px`, background: "var(--bg-page)" }}
				className={cn(
					"relative hidden h-full shrink-0 md:block",
					!isDraggingLeft && "transition-[width] duration-300",
				)}
			>
				<aside className="h-full w-full overflow-y-auto overflow-x-hidden border-r border-graphite bg-onyx p-4">
					<TableOfContents content={content} />
				</aside>
				{/* Drag handle — 8px strip centered across the divider */}
				{/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle for panel resize */}
				<div
					className="absolute right-[-4px] top-0 z-10 h-full w-2 cursor-col-resize transition-colors hover:bg-indigo/20"
					onMouseDown={onStartDragLeft}
				/>
			</div>

			{/* Content area: single toolbar header + scrollable content */}
			<div className="flex-1 flex flex-col min-w-0">
				{/* Toolbar: tabs (left) · version history + export (right) */}
				<div className="shrink-0 flex items-center gap-2 border-b border-graphite bg-charcoal/20 px-4 py-2">
					<button
						type="button"
						onClick={() => setActiveTab("preview")}
						className={cn(
							"rounded px-3 py-1 text-xs font-medium transition-colors",
							activeTab === "preview"
								? "bg-indigo text-white"
								: "bg-white/5 text-fog hover:bg-white/10 hover:text-snow",
						)}
					>
						Pratinjau
					</button>
					{hasDiff && (
						<button
							type="button"
							onClick={() => setActiveTab("diff")}
							className={cn(
								"rounded px-3 py-1 text-xs font-medium transition-colors",
								activeTab === "diff"
									? "bg-indigo text-white"
									: "bg-white/5 text-fog hover:bg-white/10 hover:text-snow",
							)}
						>
							Diff
						</button>
					)}
					<div className="ml-auto flex items-center gap-2">
						{versions && versions.length > 1 && (
							<VersionHistory
								versions={versions}
								currentVersion={currentVersion || 1}
								onSelectVersion={onSelectVersion || (() => {})}
								plan={plan}
							/>
						)}
						{projectId && (
							<button
								type="button"
								disabled={isExporting}
								onClick={async () => {
									if (isExporting) return;
									setIsExporting(true);
									try {
										const res = await fetch("/api/export/pdf", {
											method: "POST",
											headers: { "Content-Type": "application/json" },
											body: JSON.stringify({ projectId }),
										});
										if (!res.ok) {
											showToast("Gagal mengekspor PDF", "error");
											return;
										}
										const blob = await res.blob();
										const url = URL.createObjectURL(blob);
										const safeName = (projectName || "project")
											.replace(/[^a-zA-Z0-9_-]/g, "-")
											.replace(/-+/g, "-")
											.toLowerCase();
										const a = document.createElement("a");
										a.href = url;
										a.download = `${safeName}.pdf`;
										document.body.appendChild(a);
										a.click();
										a.remove();
										setTimeout(() => URL.revokeObjectURL(url), 1000);
									} catch {
										showToast("Gagal mengekspor PDF", "error");
									} finally {
										setIsExporting(false);
									}
								}}
								className="rounded bg-indigo px-3 py-1 text-xs font-medium text-white hover:bg-indigo/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
							>
								{isExporting ? "Mengekspor..." : "Export PDF"}
							</button>
						)}
					</div>
				</div>

				<div
					ref={scrollRef}
					className="flex-1 overflow-y-auto relative scroll-smooth"
				>
					{activeTab === "diff" ? (
						<div className="mx-auto max-w-3xl px-4 py-4">
							<PrdDiffViewer
								oldContent={
									versions?.find((v) => v.version === previousVersion)
										?.content ?? ""
								}
								newContent={content}
							/>
						</div>
					) : (
						<PrdPreview content={cleanContent} />
					)}
				</div>
			</div>
		</div>
	);
});
