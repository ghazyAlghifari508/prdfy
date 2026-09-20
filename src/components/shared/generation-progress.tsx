"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface GenerationProgressProps {
	/** What is being generated, e.g. "PRD" or "Acceptance Criteria" */
	label: string;
	/** Real reasoning text streamed from the model's SSE `thinking` events. */
	thinkingText?: string;
	className?: string;
}

/**
 * Developer-grade loading state:
 * Restrained status card with elapsed timer and live streamed reasoning log.
 * Clean, distraction-free, and adheres to anti-ai-slop rules.
 */
export function GenerationProgress({
	label,
	thinkingText,
	className,
}: GenerationProgressProps) {
	const [elapsed, setElapsed] = useState(0);
	const thinkingRef = useRef<HTMLPreElement>(null);

	useEffect(() => {
		const t = setInterval(() => setElapsed((s) => s + 1), 1000);
		return () => clearInterval(t);
	}, []);

	// Auto-scroll thinking log as new tokens stream in
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional scroll on new reasoning tokens
	useEffect(() => {
		if (thinkingRef.current) {
			thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
		}
	}, [thinkingText]);

	const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

	return (
		<div
			className={cn("mx-auto max-w-3xl px-4 sm:px-8 py-8 sm:py-12", className)}
		>
			<div className="rounded-xl border border-graphite bg-obsidian/40 p-5 shadow-xs">
				<div className="flex items-center justify-between gap-3">
					<div className="flex items-center gap-3 min-w-0">
						<div
							className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-indigo border-t-transparent"
							aria-hidden="true"
						/>
						<span className="text-sm font-[510] text-snow truncate">
							Menyusun {label}
						</span>
					</div>
					<span
						role="timer"
						className="font-mono text-xs text-fog shrink-0"
						aria-label="Waktu proses"
					>
						{mmss}
					</span>
				</div>

				{thinkingText ? (
					<div className="mt-4 rounded-lg border border-graphite/70 bg-charcoal/90 p-3.5">
						<div className="flex items-center justify-between mb-1.5">
							<span className="font-mono text-[10px] uppercase tracking-wider text-fog/70">
								Proses Berpikir Model
							</span>
						</div>
						<pre
							ref={thinkingRef}
							className="max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-fog leading-relaxed custom-scrollbar"
						>
							{thinkingText}
						</pre>
					</div>
				) : (
					<p className="mt-3 text-xs text-fog leading-relaxed">
						Sedang menganalisis kebutuhan dan menyusun dokumen. Dokumen akan
						langsung tampil di sini saat penulisan dimulai.
					</p>
				)}
			</div>
		</div>
	);
}
