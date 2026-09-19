"use client";

import { Check } from "lucide-react";
import type { CodebaseAnalysis } from "@/lib/codebase-analysis";

function valueOrUnknown(value?: string | null): string {
	return value && value.trim().length > 0 ? value : "Tidak terdeteksi";
}

function formatTimestamp(value?: string): string {
	if (!value) return "Tidak tersedia";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "Tidak tersedia";
	return date.toLocaleString("id-ID");
}

interface CodebaseReviewProps {
	analysis: CodebaseAnalysis;
	snapshotId: string;
	snapshotCreatedAt?: string;
	fileCount?: number;
	excludedCount?: number;
	isWorking?: boolean;
	onRetrySync: () => void;
	onRetryAnalysis: () => void;
	onContinue: () => void;
	onBackToSync?: () => void;
}

export function CodebaseReview({
	analysis,
	snapshotId,
	snapshotCreatedAt,
	fileCount,
	excludedCount,
	isWorking = false,
	onRetrySync,
	onRetryAnalysis,
	onContinue,
	onBackToSync,
}: CodebaseReviewProps) {
	const envRows: Array<[string, string | undefined | null]> = [
		["FRAMEWORK", analysis.framework],
		["LANGUAGE", analysis.language],
		["DATABASE", analysis.database],
		["AUTHENTICATION", analysis.auth],
		["PACKAGE MANAGER", analysis.packageManager],
	];

	const uncertainFindings = (analysis.findings ?? []).filter(
		(finding) => finding.uncertainty && finding.uncertainty.length > 0,
	);

	return (
		<div className="w-full animate-enter flex flex-col gap-6">
			{/* Page Head matching existing-codebase-flow.html screen 04 */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<div className="text-[11px] font-mono tracking-widest uppercase text-fog mb-2">
						CODEBASE ANALYSIS · REVIEW BEFORE GENERATE
					</div>
					<h1 className="font-inter text-2xl sm:text-3xl font-[620] tracking-tight text-snow leading-tight">
						Kami menemukan konteks aplikasimu.
					</h1>
					<p className="mt-2 text-xs sm:text-sm text-fog max-w-xl leading-relaxed">
						Review ringkasan ini sebelum PrdFy membuat pertanyaan. Kamu bisa
						mengoreksi hasil deteksi yang tidak sesuai.
					</p>
				</div>
				<span className="inline-flex items-center gap-2 rounded-full border border-iron bg-charcoal/80 px-3 py-1.5 text-xs text-fog backdrop-blur-md self-start sm:self-auto">
					<span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
					Sync selesai
				</span>
			</div>

			{/* Summary Grid (2 Columns: Detected Environment + Repository Map) */}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				{/* Panel 1: Detected environment */}
				<div className="rounded-xl border border-graphite bg-charcoal/90 shadow-2xl backdrop-blur-md overflow-hidden flex flex-col">
					<div className="flex items-center justify-between border-b border-graphite p-4 sm:p-5">
						<h3 className="font-inter text-sm font-[600] text-snow">
							Detected environment
						</h3>
						<Check size={14} className="text-emerald-400 font-bold" />
					</div>
					<div className="flex flex-col divide-y divide-graphite/60 p-0">
						{envRows.map(([label, value]) => {
							const valStr = valueOrUnknown(value);
							const isUnknown = valStr === "Tidak terdeteksi";
							return (
								<div
									key={label}
									className="flex items-center justify-between px-4 sm:px-5 py-3 text-xs"
								>
									<label className="font-mono text-[10px] text-slate tracking-wider">
										{label}
									</label>
									<strong
										className={`font-mono text-xs font-semibold ${
											isUnknown ? "text-slate italic font-normal" : "text-mist"
										}`}
									>
										{valStr}
									</strong>
								</div>
							);
						})}
					</div>
					{analysis.dependencies && analysis.dependencies.length > 0 && (
						<div className="border-t border-graphite/80 px-4 sm:px-5 py-3 bg-obsidian/40">
							<span className="block font-mono text-[10px] uppercase text-slate mb-1.5 tracking-wider">
								DEPENDENSI UTAMA
							</span>
							<div className="flex flex-wrap gap-1.5">
								{analysis.dependencies.map((dep) => (
									<span
										key={dep}
										className="rounded border border-iron bg-obsidian px-2 py-0.5 font-mono text-[11px] text-mist"
									>
										{dep}
									</span>
								))}
							</div>
						</div>
					)}
				</div>

				{/* Panel 2: Repository map */}
				<div className="rounded-xl border border-graphite bg-charcoal/90 shadow-2xl backdrop-blur-md overflow-hidden flex flex-col">
					<div className="flex items-center justify-between border-b border-graphite p-4 sm:p-5">
						<h3 className="font-inter text-sm font-[600] text-snow">
							Repository map
						</h3>
						<span className="font-mono text-[11px] text-fog">
							{fileCount ?? 0} files indexed ({excludedCount ?? 0} excluded)
						</span>
					</div>
					<div className="p-4 sm:p-5 flex-1 flex flex-col gap-3 text-xs">
						{analysis.moduleMap && analysis.moduleMap.length > 0 ? (
							<div className="flex flex-col gap-1.5 font-mono text-[11px] text-mist rounded-lg border border-graphite/60 bg-onyx p-3 max-h-56 overflow-y-auto hide-scrollbar">
								{analysis.moduleMap.map((entry) => (
									<div
										key={entry.path}
										className="flex items-center gap-2 py-0.5"
									>
										<span className="text-fog">▾</span>
										<b className="text-snow">{entry.path}</b>
										<span className="text-slate text-[10px] ml-auto">
											{entry.summary}
										</span>
									</div>
								))}
							</div>
						) : (
							<p className="text-slate italic">Tidak terdeteksi</p>
						)}

						{analysis.relevantFiles && analysis.relevantFiles.length > 0 && (
							<div className="mt-auto border-t border-graphite/60 pt-2 text-[11px] text-fog">
								<span>File relevan: </span>
								<span className="font-mono text-snow">
									{analysis.relevantFiles.join(", ")}
								</span>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Panel 3: Potential Impact Areas from existing-codebase-flow.html */}
			<div className="rounded-xl border border-graphite bg-charcoal/90 shadow-2xl backdrop-blur-md overflow-hidden">
				<div className="flex items-center justify-between border-b border-graphite p-4 sm:p-5">
					<h3 className="font-inter text-sm font-[600] text-snow">
						Potential impact areas
					</h3>
					<span className="rounded-full border border-iron bg-obsidian px-2.5 py-0.5 font-mono text-[10px] text-fog">
						AI generated · review
					</span>
				</div>

				<div className="p-4 sm:p-5 flex flex-col gap-5">
					{analysis.impactAreas && analysis.impactAreas.length > 0 ? (
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
							{analysis.impactAreas.map((area, idx) => (
								<div
									key={area}
									className="rounded-lg border border-graphite/80 bg-obsidian/60 p-3.5 flex flex-col gap-1"
								>
									<h4 className="font-inter text-xs font-semibold text-snow">
										{idx === 0
											? "Database & State"
											: idx === 1
												? "Application & Logic"
												: "Interface & Routing"}
									</h4>
									<p className="text-[11px] text-fog leading-relaxed">
										{area}
									</p>
								</div>
							))}
						</div>
					) : (
						<p className="text-slate italic text-xs">Tidak terdeteksi</p>
					)}

					{/* Findings & Uncertainties */}
					{analysis.findings && analysis.findings.length > 0 && (
						<div className="rounded-lg border border-graphite/60 bg-obsidian/40 p-3.5 flex flex-col gap-2">
							<span className="font-mono text-[10px] uppercase text-slate tracking-wider">
								TEMUAN DAN KETIDAKPASTIAN
							</span>
							<div className="flex flex-col gap-2">
								{analysis.findings.map((f) => (
									<div key={f.title} className="text-xs flex flex-col gap-0.5">
										<div className="flex items-center gap-2">
											<span className="font-medium text-snow">{f.title}</span>
											{f.uncertainty && (
												<span className="rounded bg-amber-500/15 border border-amber-500/25 px-1.5 py-0.2 text-[10px] text-amber-300">
													Perlu verifikasi
												</span>
											)}
										</div>
										<span className="text-fog text-[11px]">{f.detail}</span>
										{f.uncertainty && (
											<span className="text-slate text-[10px] italic">
												Jalur refresh token tidak terlihat di snapshot:{" "}
												{f.uncertainty}
											</span>
										)}
									</div>
								))}
							</div>
						</div>
					)}

					{uncertainFindings.length === 0 &&
						analysis.findings &&
						analysis.findings.length > 0 && (
							<p className="text-[11px] text-fog italic">
								Semua temuan di atas tanpa ketidakpastian tercatat.
							</p>
						)}

					{analysis.limitations && analysis.limitations.length > 0 && (
						<div className="text-[11px] text-fog flex flex-col gap-1">
							<span className="text-slate font-mono text-[10px] uppercase">
								Keterbatasan:
							</span>
							{analysis.limitations.map((lim) => (
								<span key={lim}>• {lim}</span>
							))}
						</div>
					)}

					{/* Screen Nav matching existing-codebase-flow.html */}
					<div className="flex flex-wrap items-center justify-between gap-3 border-t border-graphite pt-4 text-xs">
						<div className="flex items-center gap-3 text-fog text-[11px]">
							<span>
								ID: <span className="font-mono text-snow">{snapshotId}</span>
							</span>
							<span>· {formatTimestamp(snapshotCreatedAt)}</span>
						</div>

						<div className="flex items-center gap-2">
							{onBackToSync && (
								<button
									type="button"
									onClick={onBackToSync}
									className="rounded border border-iron bg-obsidian px-3 py-1.5 text-xs text-mist hover:text-snow transition hover:bg-steel"
								>
									Lihat log sync
								</button>
							)}
							<button
								type="button"
								onClick={onRetrySync}
								disabled={isWorking}
								className="rounded border border-iron bg-obsidian px-3 py-1.5 text-xs text-mist hover:text-snow transition hover:bg-steel disabled:opacity-50"
							>
								Sync ulang
							</button>
							<button
								type="button"
								onClick={onRetryAnalysis}
								disabled={isWorking}
								className="rounded border border-iron bg-obsidian px-3 py-1.5 text-xs text-mist hover:text-snow transition hover:bg-steel disabled:opacity-50"
							>
								{isWorking ? "Memproses..." : "Analisis ulang"}
							</button>
							<button
								type="button"
								onClick={onContinue}
								disabled={isWorking}
								className="inline-flex items-center gap-1.5 rounded bg-snow px-4 py-1.5 font-inter text-xs font-semibold text-onyx shadow-sm hover:brightness-110 transition disabled:opacity-50"
							>
								<span>Lanjut ke Pertanyaan</span>
								<span className="font-mono text-xs">-&gt;</span>
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
