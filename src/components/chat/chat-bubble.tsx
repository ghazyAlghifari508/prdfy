"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

export function cleanMessage(content: string): string {
	// Filter out the raw :::UPDATE_SECTION[...]::: blocks and their content
	// so they are not rendered in the chat bubble UI from historical messages.
	// Only complete blocks (terminated by :::END_UPDATE:::) are stripped; an
	// unterminated block is left untouched so a malformed or partial message
	// never deletes the valid text that follows it.
	const cleaned = content
		.replace(/:::UPDATE_SECTION\[(.*?)\]:::\s*[\s\S]*?:::END_UPDATE:::/g, "")
		.trim();
	if (!cleaned && content.includes(":::UPDATE_SECTION")) {
		return "Telah merevisi dokumen PRD.";
	}
	return cleaned || content;
}

interface ChatBubbleProps {
	role: "user" | "assistant" | "system";
	content: string;
	isStreaming?: boolean;
	className?: string;
}

export const ChatBubble = memo(function ChatBubble({
	role,
	content,
	isStreaming,
	className,
}: ChatBubbleProps) {
	const isUser = role === "user";
	const isSystem = role === "system";

	// System notices get their own centered muted rendering — never the
	// assistant bubble, colors, or update-marker filtering.
	if (isSystem) {
		return (
			<div className={cn("flex justify-center", className)}>
				<p className="max-w-[80%] text-center text-xs text-fog">{content}</p>
			</div>
		);
	}

	// Defer marker cleanup until streaming completes: filtering mid-stream
	// hides incomplete responses and flickers as later tokens arrive.
	const displayContent = !isUser && !isStreaming ? cleanMessage(content) : content;

	return (
		<div
			className={cn(
				"flex gap-3 animate-chat-bubble-in",
				isUser ? "justify-end" : "justify-start",
				className,
			)}
		>
			<div
				className={cn(
					"max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed shadow-[var(--shadow-inset)]",
					isUser
						? "rounded-br-md bg-[var(--btn-bg)] shadow-none"
						: "rounded-bl-md bg-charcoal",
				)}
				style={
					isUser
						? { color: "var(--btn-text)" }
						: { color: "var(--text-primary)" }
				}
			>
				<p className="whitespace-pre-wrap">
					{displayContent}
					{isStreaming && (
						<span className="ml-1 inline-block h-4 w-1 animate-pulse bg-current" />
					)}
				</p>
			</div>
		</div>
	);
});
