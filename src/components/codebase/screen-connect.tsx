"use client";

import { Check, Copy, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buildAgentPrompt, type SyncPromptPayload } from "@/lib/codebase-sync";

interface ScreenConnectProps {
	projectName: string;
	payload: SyncPromptPayload | null;
	isStarting?: boolean;
	onAgentStarted: () => void;
}

export function ScreenConnect({
	projectName,
	payload,
	isStarting = false,
	onAgentStarted,
}: ScreenConnectProps) {
	const [copied, setCopied] = useState(false);
	const [copyError, setCopyError] = useState<string | null>(null);
	const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (copyTimeoutRef.current) {
				clearTimeout(copyTimeoutRef.current);
				copyTimeoutRef.current = null;
			}
		};
	}, []);

	const promptText = payload ? buildAgentPrompt(payload, { projectName }) : "";

	const handleCopy = async () => {
		if (!promptText) return;
		try {
			if (!navigator.clipboard?.writeText) {
				throw new Error("Clipboard API tidak tersedia");
			}
			await navigator.clipboard.writeText(promptText);
			setCopied(true);
			setCopyError(null);
			if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
			copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
		} catch {
			setCopied(false);
			setCopyError(
				"Gagal menyalin otomatis. Silakan salin teks secara manual.",
			);
			if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
			copyTimeoutRef.current = setTimeout(() => setCopyError(null), 4000);
		}
	};

	return (
		<div className="w-full animate-enter flex flex-col gap-8">
			{/* Page Head from existing-codebase-flow.html screen 02 */}
			<div className="flex flex-col gap-3">
				<div>
					<div className="text-[11px] font-mono tracking-widest uppercase text-fog mb-2">
						NEW PROJECT · EXISTING CODEBASE
					</div>
					<h1 className="font-inter text-2xl sm:text-3xl font-[620] tracking-tight text-snow leading-tight">
						Hubungkan codebase kamu
					</h1>
					<p className="mt-2 text-xs sm:text-sm text-fog max-w-xl leading-relaxed">
						PrdFy tidak meminta upload ZIP. Jalankan sync langsung dari
						repository melalui AI coding agent kamu.
					</p>
				</div>
			</div>

			{/* Modal-style Container from existing-codebase-flow.html */}
			<div className="mx-auto w-full max-w-2xl rounded-xl border border-iron bg-obsidian/90 shadow-2xl backdrop-blur-xl overflow-hidden">
				{/* Modal Head */}
				<div className="border-b border-graphite p-5 sm:p-6">
					<h2 className="font-inter text-lg sm:text-xl font-[600] text-snow">
						Sync codebase dengan PrdFy
					</h2>
					<p className="mt-1.5 text-xs sm:text-sm text-fog leading-relaxed">
						Salin prompt ini dan paste ke Claude Code, Cursor, Windsurf, atau AI
						agent lain dari root repository kamu.
					</p>
				</div>

				{/* Modal Body */}
				<div className="p-5 sm:p-6 flex flex-col gap-6">
					{/* Step 1 */}
					<div className="flex items-start gap-3.5">
						<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-iron text-xs font-mono text-mist">
							1
						</span>
						<div className="flex flex-1 flex-col gap-2">
							<div className="text-xs font-semibold text-mist">
								Copy prompt untuk AI agent
							</div>
							<div className="relative rounded-lg border border-graphite bg-onyx p-3.5 sm:p-4 text-xs font-mono leading-relaxed text-mist min-h-[90px]">
								{payload ? (
									<>
										<button
											type="button"
											onClick={handleCopy}
											className="absolute top-2.5 right-2.5 inline-flex items-center gap-1.5 rounded border border-iron bg-obsidian px-2.5 py-1 text-[11px] font-sans text-fog hover:text-snow transition hover:bg-steel"
										>
											{copied ? (
												<>
													<Check size={12} className="text-emerald-400" />
													<span className="text-emerald-400">Tersalin</span>
												</>
											) : (
												<>
													<Copy size={12} />
													<span>Salin</span>
												</>
											)}
										</button>
										<div className="pr-16 max-h-48 overflow-y-auto hide-scrollbar whitespace-pre-wrap select-all text-snow">
											{promptText}
										</div>
										{copyError && (
											<p className="mt-2 text-[11px] text-crimson font-sans">
												{copyError}
											</p>
										)}
									</>
								) : isStarting ? (
									<div className="flex items-center justify-center gap-2 py-6 text-xs text-fog font-sans">
										<Loader2 size={14} className="animate-spin text-blue-400" />
										<span>Menyiapkan token sesi...</span>
									</div>
								) : (
									<div className="flex items-center justify-center py-6 text-xs text-fog font-sans">
										<span>Memuat instruksi sync...</span>
									</div>
								)}
							</div>
						</div>
					</div>

					{/* Step 2 */}
					<div className="flex items-start gap-3.5">
						<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-iron text-xs font-mono text-mist">
							2
						</span>
						<div className="flex flex-col gap-1">
							<div className="text-xs font-semibold text-mist">
								Buka AI coding agent di repository kamu
							</div>
							<p className="text-[11px] text-fog leading-relaxed">
								Pastikan agent berjalan dari root folder project yang ingin
								dianalisis.
							</p>
						</div>
					</div>

					{/* Step 3 */}
					<div className="flex items-start gap-3.5">
						<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-iron text-xs font-mono text-mist">
							3
						</span>
						<div className="flex flex-col gap-1">
							<div className="text-xs font-semibold text-mist">
								Paste prompt lalu jalankan
							</div>
							<p className="text-[11px] text-fog leading-relaxed">
								PrdFy akan menampilkan status dan berpindah layar ketika CLI
								berhasil terhubung.
							</p>
						</div>
					</div>
				</div>

				{/* Modal Foot */}
				<div className="flex items-center justify-end border-t border-graphite bg-charcoal/60 px-5 py-4 sm:px-6">
					<button
						type="button"
						onClick={onAgentStarted}
						disabled={!payload || isStarting}
						className="inline-flex items-center justify-center rounded-md bg-snow px-4 py-2 font-inter text-xs font-semibold text-onyx shadow-sm hover:brightness-110 transition disabled:cursor-not-allowed disabled:opacity-50"
					>
						Saya sudah menjalankan agent
					</button>
				</div>
			</div>
		</div>
	);
}
