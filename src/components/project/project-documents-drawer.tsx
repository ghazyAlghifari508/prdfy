"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CheckSquare, FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProjectDocumentsDrawerProps {
	isOpen: boolean;
	onClose: () => void;
	projectName: string;
	hasPrd: boolean;
	hasAc: boolean;
	onSelectDocument: (type: "prd" | "ac") => void;
}

export function ProjectDocumentsDrawer({
	isOpen,
	onClose,
	projectName,
	hasPrd,
	hasAc,
	onSelectDocument,
}: ProjectDocumentsDrawerProps) {
	return (
		<DialogPrimitive.Root
			open={isOpen}
			onOpenChange={(open) => !open && onClose()}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 drawer-overlay" />
				<DialogPrimitive.Content
					className={cn(
						"fixed inset-y-0 left-0 z-50 flex h-full w-80 max-w-[85vw] flex-col border-r border-graphite bg-obsidian text-snow shadow-2xl outline-none drawer-content",
					)}
				>
					{/* Header */}
					<div className="flex items-center justify-between border-b border-graphite px-5 py-4 shrink-0">
						<div className="min-w-0 pr-2">
							<DialogPrimitive.Title className="text-[11px] font-bold uppercase tracking-wider text-fog">
								Dokumen Proyek
							</DialogPrimitive.Title>
							<DialogPrimitive.Description className="truncate text-sm font-[510] text-snow mt-0.5">
								{projectName}
							</DialogPrimitive.Description>
						</div>
						<DialogPrimitive.Close
							className="rounded-md p-1.5 text-fog transition-colors hover:bg-white/5 hover:text-snow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo"
							aria-label="Tutup menu dokumen"
						>
							<X size={16} />
						</DialogPrimitive.Close>
					</div>

					{/* Document List */}
					<div className="flex flex-1 flex-col gap-2 p-4 overflow-y-auto custom-scrollbar">
						<p className="px-2 pb-1 text-[11px] font-medium text-fog/70 uppercase tracking-wider">
							Artefak Spesifikasi
						</p>

						{/* PRD Option */}
						<button
							type="button"
							disabled={!hasPrd}
							onClick={() => {
								onClose();
								onSelectDocument("prd");
							}}
							className={cn(
								"flex flex-col gap-1.5 rounded-lg border p-3.5 text-left transition-all outline-none",
								hasPrd
									? "border-graphite bg-charcoal/40 hover:border-steel hover:bg-charcoal/80 focus-visible:ring-2 focus-visible:ring-indigo cursor-pointer"
									: "border-graphite/40 bg-charcoal/20 opacity-50 cursor-not-allowed",
							)}
						>
							<div className="flex items-center justify-between gap-2">
								<div className="flex items-center gap-2 min-w-0">
									<FileText size={16} className="text-indigo shrink-0" />
									<span className="text-xs font-semibold text-snow truncate">
										Product Requirements (PRD)
									</span>
								</div>
								<span
									className={cn(
										"rounded px-1.5 py-0.5 text-[9px] font-bold shrink-0",
										hasPrd
											? "bg-indigo/15 text-indigo border border-indigo/30"
											: "bg-steel/10 text-fog/60 border border-graphite",
									)}
								>
									{hasPrd ? "Tersedia" : "Belum ada"}
								</span>
							</div>
							<p className="text-[11px] text-fog leading-relaxed">
								Dokumen 8 seksi lengkap arsitektur, user flow, dan kontrak data.
							</p>
						</button>

						{/* AC Option */}
						<button
							type="button"
							disabled={!hasAc}
							onClick={() => {
								onClose();
								onSelectDocument("ac");
							}}
							className={cn(
								"flex flex-col gap-1.5 rounded-lg border p-3.5 text-left transition-all outline-none",
								hasAc
									? "border-graphite bg-charcoal/40 hover:border-steel hover:bg-charcoal/80 focus-visible:ring-2 focus-visible:ring-indigo cursor-pointer"
									: "border-graphite/40 bg-charcoal/20 opacity-50 cursor-not-allowed",
							)}
						>
							<div className="flex items-center justify-between gap-2">
								<div className="flex items-center gap-2 min-w-0">
									<CheckSquare size={16} className="text-emerald shrink-0" />
									<span className="text-xs font-semibold text-snow truncate">
										Acceptance Criteria (AC)
									</span>
								</div>
								<span
									className={cn(
										"rounded px-1.5 py-0.5 text-[9px] font-bold shrink-0",
										hasAc
											? "bg-emerald/15 text-emerald border border-emerald/30"
											: "bg-steel/10 text-fog/60 border border-graphite",
									)}
								>
									{hasAc ? "Tersedia" : "Belum ada"}
								</span>
							</div>
							<p className="text-[11px] text-fog leading-relaxed">
								Kriteria penerimaan terstruktur siap audit dan skenario
								Given/When/Then.
							</p>
						</button>
					</div>

					{/* Footer Note */}
					<div className="border-t border-graphite p-4 bg-obsidian shrink-0">
						<p className="text-[11px] text-fog/70 leading-relaxed text-center">
							Dokumen dibuka dalam dialog pratinjau tanpa berpindah halaman
							kerja.
						</p>
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
