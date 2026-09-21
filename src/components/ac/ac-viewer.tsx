"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { GenerationProgress } from "@/components/shared/generation-progress";
import { cn } from "@/lib/utils";
import type { Plan } from "@/types/database";

function slugifyHeading(text: string): string {
	return (
		text
			.toLowerCase()
			.replace(/[^\p{L}\p{N}_-]+/gu, "-")
			.replace(/^-+|-+$/g, "") || "section"
	);
}

const markdownComponents: Components = {
	h2: ({ children, ...props }) => {
		const text = String(children).replace(/<[^>]*>/g, "");
		const id = slugifyHeading(text);
		return (
			<h2 id={id} {...props}>
				{children}
			</h2>
		);
	},
	h3: ({ children, ...props }) => {
		const text = String(children).replace(/<[^>]*>/g, "");
		const id = slugifyHeading(text);
		return (
			<h3 id={id} {...props}>
				{children}
			</h3>
		);
	},
	h4: ({ children, ...props }) => {
		const text = String(children).replace(/<[^>]*>/g, "");
		const id = slugifyHeading(text);
		return (
			<h4 id={id} {...props}>
				{children}
			</h4>
		);
	},
};

interface AcViewerProps {
	content: string | null;
	streamingContent?: string;
	isStreaming?: boolean;
	hasError?: boolean;
	thinkingText?: string;
	onGenerate?: () => void;
	projectName: string;
	plan?: Plan;
	className?: string;
}

/**
 * AC Viewer - mirrors prd-viewer.tsx pattern:
 * - Streaming: render raw markdown live
 * - Done: render raw markdown with heading-id injection for TOC scroll
 */
export const AcViewer = memo(function AcViewer({
	content,
	streamingContent,
	isStreaming = false,
	hasError = false,
	thinkingText,
	onGenerate,
	projectName: _projectName,
	plan: _plan = "free",
	className,
}: AcViewerProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	// Auto-scroll while streaming
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional re-scroll on token
	useEffect(() => {
		if (isStreaming && scrollRef.current) {
			const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
			if (scrollHeight - scrollTop - clientHeight < 150) {
				scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
			}
		}
	}, [streamingContent, isStreaming]);

	// Clean AI markdown wrapper artifacts (mirrors prd-viewer.ts)
	const cleanContent = useMemo(() => {
		if (!content) return "";
		let cleaned = content.replace(/<!--[\s\S]*?-->/g, "").trim();

		const startMatch = cleaned.match(/```(?:markdown|md)\s*\n/i);
		if (startMatch) {
			if (startMatch.index !== undefined && startMatch.index < 500) {
				const startIndex = startMatch.index + startMatch[0].length;
				const lastIndex = cleaned.lastIndexOf("```");
				cleaned =
					lastIndex > startIndex
						? cleaned.substring(startIndex, lastIndex)
						: cleaned.substring(startIndex);
			}
		} else {
			if (cleaned.startsWith("```\n")) {
				const lastIndex = cleaned.lastIndexOf("```");
				cleaned = lastIndex > 3 ? cleaned.substring(4, lastIndex) : cleaned;
			} else if (cleaned.startsWith("```")) {
				const lastIndex = cleaned.lastIndexOf("```");
				cleaned = lastIndex > 2 ? cleaned.substring(3, lastIndex) : cleaned;
			}
		}
		return cleaned.trim();
	}, [content]);

	const displayContent = (() => {
		if (isStreaming && streamingContent) return streamingContent;
		if (cleanContent) return cleanContent;
		// Post-done window: loader belum balik tapi streamingContent sudah ada (optimistic)
		if (streamingContent && !hasError) return streamingContent;
		return cleanContent;
	})();

	if (isStreaming && !streamingContent) {
		return (
			<div ref={scrollRef} className={cn("h-full overflow-y-auto", className)}>
				<GenerationProgress
					label="Acceptance Criteria"
					thinkingText={thinkingText}
				/>
			</div>
		);
	}

	// Show error/retry state when streaming ended with error and no content
	if (hasError && !displayContent) {
		return (
			<div ref={scrollRef} className={cn("h-full overflow-y-auto", className)}>
				<article className="prd-content mx-auto max-w-3xl px-8 pb-16 pt-8 text-mist">
					<div className="text-center py-12">
						<p className="text-crimson mb-4">Gagal generate AC</p>
						<p className="text-fog mb-6">
							Terjadi kesalahan saat menghubungi AI. Silakan coba lagi.
						</p>
						<button
							type="button"
							onClick={() => window.location.reload()}
							className="btn-primary inline-flex items-center gap-2 rounded-md px-4 py-2"
						>
							<span>Coba Lagi</span>
						</button>
					</div>
				</article>
			</div>
		);
	}

	if (!displayContent) {
		if (onGenerate) {
			return (
				<div className={cn("h-full overflow-y-auto", className)}>
					<div className="flex h-full items-center justify-center">
						<div className="text-center">
							<p className="mb-2 text-(--text-primary)">
								Acceptance Criteria belum digenerate untuk project ini.
							</p>
							<button
								type="button"
								onClick={onGenerate}
								className="btn-primary inline-flex items-center gap-2 rounded-md px-4 py-2"
							>
								Generate AC
							</button>
						</div>
					</div>
				</div>
			);
		}
		return (
			<div className={cn("h-full overflow-y-auto", className)}>
				<GenerationProgress
					label="Acceptance Criteria"
					thinkingText={thinkingText}
				/>
			</div>
		);
	}

	return (
		<div ref={scrollRef} className={cn("h-full overflow-y-auto", className)}>
			<article className="prd-content mx-auto max-w-3xl px-8 pb-16 pt-8 text-mist">
				<Markdown
					remarkPlugins={[remarkGfm]}
					rehypePlugins={[rehypeHighlight]}
					components={markdownComponents}
				>
					{displayContent}
				</Markdown>
			</article>
		</div>
	);
});
