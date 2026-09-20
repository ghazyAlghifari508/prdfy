"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CheckSquare, FileText, X } from "lucide-react";
import { lazy, memo, Suspense, useMemo } from "react";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const Mermaid = lazy(() =>
	import("@/components/prd/mermaid").then((m) => ({ default: m.Mermaid })),
);

const markdownComponents: Components = {
	h2: ({ children, ...props }) => {
		const text = String(children).replace(/<[^>]*>/g, "");
		const id = text.toLowerCase().replace(/[^\w]+/g, "-");
		return (
			<h2
				id={id}
				className="text-xl font-bold text-snow mt-8 mb-4 border-b border-graphite pb-2"
				{...props}
			>
				{children}
			</h2>
		);
	},
	h3: ({ children, ...props }) => {
		const text = String(children).replace(/<[^>]*>/g, "");
		const id = text.toLowerCase().replace(/[^\w]+/g, "-");
		return (
			<h3
				id={id}
				className="text-lg font-semibold text-snow mt-6 mb-3"
				{...props}
			>
				{children}
			</h3>
		);
	},
	h4: ({ children, ...props }) => {
		const text = String(children).replace(/<[^>]*>/g, "");
		const id = text.toLowerCase().replace(/[^\w]+/g, "-");
		return (
			<h4
				id={id}
				className="text-sm font-semibold text-snow mt-4 mb-2"
				{...props}
			>
				{children}
			</h4>
		);
	},
	p: ({ children, ...props }) => (
		<p
			className="text-sm leading-relaxed text-mist mb-4 font-normal"
			{...props}
		>
			{children}
		</p>
	),
	ul: ({ children, ...props }) => (
		<ul className="list-disc pl-6 mb-4 space-y-1 text-sm text-mist" {...props}>
			{children}
		</ul>
	),
	ol: ({ children, ...props }) => (
		<ol
			className="list-decimal pl-6 mb-4 space-y-1 text-sm text-mist"
			{...props}
		>
			{children}
		</ol>
	),
	table: ({ children, ...props }) => (
		<div className="overflow-x-auto mb-6 border border-graphite rounded-lg">
			<table className="w-full text-left text-sm" {...props}>
				{children}
			</table>
		</div>
	),
	th: ({ children, ...props }) => (
		<th
			className="border-b border-graphite bg-charcoal/60 px-4 py-2.5 font-semibold text-snow"
			{...props}
		>
			{children}
		</th>
	),
	td: ({ children, ...props }) => (
		<td className="border-b border-graphite/40 px-4 py-2.5 text-fog" {...props}>
			{children}
		</td>
	),
	code: ({ className, children, ...props }) => {
		const match = /language-(\w+)/.exec(className || "");
		if (match && match[1] === "mermaid") {
			return (
				<Suspense
					fallback={
						<div className="animate-pulse bg-white/5 h-32 rounded-lg my-4 flex items-center justify-center text-xs text-fog" />
					}
				>
					<Mermaid chart={String(children).replace(/\n$/, "")} />
				</Suspense>
			);
		}
		return (
			<code
				className={cn(
					"rounded bg-charcoal px-1.5 py-0.5 font-mono text-xs text-snow",
					className,
				)}
				{...props}
			>
				{children}
			</code>
		);
	},
};

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

interface DocumentReviewModalProps {
	isOpen: boolean;
	onClose: () => void;
	type: "prd" | "ac" | null;
	projectName: string;
	content: string | null;
}

export const DocumentReviewModal = memo(function DocumentReviewModal({
	isOpen,
	onClose,
	type,
	projectName,
	content,
}: DocumentReviewModalProps) {
	const cleanContent = useMemo(() => {
		if (!content) return "";
		let cleaned = content.replace(/<!--[\s\S]*?-->/g, "").trim();
		const startMatch = cleaned.match(/```(?:markdown|md)\s*\n/i);
		if (startMatch && startMatch.index !== undefined) {
			const startIndex = startMatch.index + startMatch[0].length;
			const lastIndex = cleaned.lastIndexOf("```");
			if (lastIndex > startIndex) {
				cleaned = cleaned.substring(startIndex, lastIndex);
			} else {
				cleaned = cleaned.substring(startIndex);
			}
		}
		cleaned = cleaned.replace(/={3,}DONE={3,}/gi, "").trim();
		return cleaned.trim();
	}, [content]);

	if (!type) return null;

	const isPrd = type === "prd";
	const title = isPrd
		? "Product Requirements Document (PRD)"
		: "Acceptance Criteria (AC)";

	return (
		<DialogPrimitive.Root
			open={isOpen}
			onOpenChange={(open) => !open && onClose()}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/75 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
				<DialogPrimitive.Content
					className={cn(
						"fixed left-[50%] top-[50%] z-50 flex flex-col w-[95vw] max-w-5xl h-[88vh] translate-x-[-50%] translate-y-[-50%] rounded-xl border border-graphite bg-obsidian text-snow shadow-2xl duration-200 outline-none overflow-hidden",
						"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
					)}
				>
					{/* Modal Header */}
					<div className="flex items-center justify-between border-b border-graphite bg-obsidian/90 px-6 py-4 shrink-0">
						<div className="flex items-center gap-3 min-w-0 pr-4">
							<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-graphite bg-charcoal">
								{isPrd ? (
									<FileText size={16} className="text-indigo" />
								) : (
									<CheckSquare size={16} className="text-emerald" />
								)}
							</div>
							<div className="min-w-0">
								<DialogPrimitive.Title className="truncate text-base font-semibold text-snow">
									{title}
								</DialogPrimitive.Title>
								<DialogPrimitive.Description className="truncate text-xs text-fog">
									{projectName} · Pratinjau Dokumen
								</DialogPrimitive.Description>
							</div>
						</div>

						<div className="flex items-center gap-2 shrink-0">
							<DialogPrimitive.Close
								className="rounded-md p-1.5 text-fog transition-colors hover:bg-white/5 hover:text-snow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo"
								aria-label="Tutup pratinjau dokumen"
							>
								<X size={18} />
							</DialogPrimitive.Close>
						</div>
					</div>

					{/* Document Content Viewport */}
					<div className="flex-1 overflow-y-auto px-6 sm:px-10 py-8 custom-scrollbar bg-onyx/40">
						{!cleanContent ? (
							<div className="flex h-full flex-col items-center justify-center py-16 text-center">
								<p className="text-sm font-[510] text-snow">
									Dokumen belum tersedia
								</p>
								<p className="text-xs text-fog mt-1 max-w-sm leading-relaxed">
									Dokumen {isPrd ? "PRD" : "Acceptance Criteria"} belum pernah
									digenerate untuk project ini.
								</p>
							</div>
						) : (
							<article className="prd-content mx-auto max-w-3xl">
								<Markdown
									remarkPlugins={remarkPlugins}
									rehypePlugins={rehypePlugins}
									components={markdownComponents}
								>
									{cleanContent}
								</Markdown>
							</article>
						)}
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
});
