"use client";

import { AlertCircle, Play, X } from "lucide-react";
import { useFocusTrap } from "@/hooks/use-focus-trap";

interface ResumeErrorModalProps {
	isOpen: boolean;
	onClose: () => void;
	onResume: () => void;
	errorMessage: string;
}

export function ResumeErrorModal({
	isOpen,
	onClose,
	onResume,
	errorMessage,
}: ResumeErrorModalProps) {
	const dialogRef = useFocusTrap<HTMLDivElement>({
		isOpen,
		onEscape: onClose,
	});

	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-in fade-in duration-200"
			onClick={onClose}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="resume-error-title"
				aria-describedby="resume-error-description"
				tabIndex={-1}
				className="w-full max-w-md overflow-hidden rounded-xl bg-obsidian shadow-[var(--shadow-overlay)] animate-in zoom-in-95 duration-200"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="p-6">
					<div className="flex items-start justify-between mb-4">
						<div className="flex h-12 w-12 items-center justify-center rounded-full bg-crimson/10 text-crimson">
							<AlertCircle size={24} strokeWidth={2} />
						</div>
						<button
							type="button"
							onClick={onClose}
							aria-label="Tutup"
							className="text-fog transition-colors hover:text-snow"
						>
							<X size={20} />
						</button>
					</div>

					<h3
						id="resume-error-title"
						className="mb-2 mt-2 font-inter text-xl font-[510] text-snow"
					>
						AI Sedang Sibuk / Terputus
					</h3>
					<p
						id="resume-error-description"
						className="mb-4 font-inter text-sm leading-relaxed text-fog"
					>
						{errorMessage || "Terjadi kesalahan saat menyusun PRD."}
					</p>
					<div className="mb-6 rounded-md bg-indigo/10 p-3 shadow-[inset_0_0_0_1px_rgba(94,106,210,0.35)]">
						<p className="font-inter text-xs text-mist">
							💡 <strong>Rekomendasi:</strong> PRD yang terpotong masih
							tersimpan. Klik Lanjutkan untuk meneruskan penulisan dari bagian
							terakhir.
						</p>
					</div>

					<div className="flex flex-col gap-3 mt-6">
						<button
							type="button"
							onClick={onResume}
							className="btn-primary flex w-full items-center justify-center gap-2 rounded-md px-4 py-3 font-inter text-sm font-[510] transition-all hover:brightness-105"
						>
							<Play size={16} fill="currentColor" />
							Lanjutkan Generate
						</button>
						<button
							type="button"
							onClick={onClose}
							className="w-full rounded-md bg-charcoal px-4 py-3 text-center font-inter text-sm font-[510] text-mist shadow-[var(--shadow-inset)] transition-colors hover:bg-white/5"
						>
							Batal
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
