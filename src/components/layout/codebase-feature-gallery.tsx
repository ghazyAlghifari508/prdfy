"use client";

import { Sparkles } from "lucide-react";
import { CODEBASE_FEATURE_TEMPLATES } from "@/lib/template-gallery";

export function CodebaseFeatureGallery({
	onSelect,
}: {
	onSelect: (prompt: string) => void;
}) {
	return (
		<div className="mx-auto mt-8 flex w-full max-w-[728px] flex-col gap-3 animate-hero-fade-in">
			<div className="flex items-center justify-between px-1">
				<div className="flex items-center gap-1.5 text-xs font-[510] text-mist">
					<Sparkles size={13} className="text-fog" />
					<span>Contoh Fitur untuk Codebase Kamu</span>
				</div>
				<span className="text-[11px] text-slate">Klik untuk gunakan contoh</span>
			</div>
			<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3">
				{CODEBASE_FEATURE_TEMPLATES.map((t) => (
					<button
						key={t.id}
						type="button"
						onClick={() => onSelect(t.prompt)}
						className="flex flex-col justify-between rounded-xl border border-graphite bg-charcoal p-3.5 text-left transition hover:border-fog/40 hover:bg-steel/30 active:scale-[0.99] cursor-pointer"
					>
						<div>
							<div className="text-[13px] font-[510] text-snow">{t.title}</div>
							<div className="mt-1 text-[10px] font-mono uppercase tracking-wider text-slate">
								{t.category}
							</div>
						</div>
						<div className="mt-2.5 text-[11px] leading-relaxed text-fog line-clamp-2">
							{t.prompt}
						</div>
					</button>
				))}
			</div>
		</div>
	);
}
