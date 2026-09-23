"use client";

import { Check, FileCode, Folder } from "lucide-react";
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

function splitPath(fullPath: string): {
	dir: string;
	name: string;
	isFile: boolean;
} {
	const normalized = fullPath.trim();
	const isFile = /\.[a-z0-9]+$/i.test(normalized);
	const lastSlash = normalized.lastIndexOf("/");
	if (lastSlash === -1) {
		return { dir: "", name: normalized, isFile };
	}
	return {
		dir: normalized.slice(0, lastSlash + 1),
		name: normalized.slice(lastSlash + 1),
		isFile,
	};
}

interface CodebaseReviewProps {
	analysis: CodebaseAnalysis;
	snapshotId: string;
	snapshotCreatedAt?: string;
	fileCount?: number;
	excludedCount?: number;
	isWorking?: boolean;
	errorMessage?: string | null;
	onRetrySync?: () => void;
	onRetryAnalysis?: () => void;
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
	errorMessage,
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
				<span className="inline-flex items-center gap-1.5 rounded-md border border-graphite bg-charcoal px-2.5 py-1 text-xs font-[510] text-fog self-start sm:self-auto">
					Sync selesai
				</span>
			</div>

			{/* Summary Grid (2 Columns: Detected Environment + Repository Map) */}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				{/* Panel 1: Detected environment */}
				<div className="rounded-xl border border-graphite bg-charcoal overflow-hidden flex flex-col shadow-sm">
					<div className="flex items-center justify-between border-b border-graphite p-4 sm:p-5">
						<h3 className="font-inter text-sm font-[600] text-snow">
							Detected environment
						</h3>
						<Check size={14} className="text-emerald-500 font-bold" />
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
									<span className="font-mono text-[10px] text-slate tracking-wider">
										{label}
									</span>
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
										className="rounded border border-graphite/80 bg-obsidian px-2 py-0.5 font-mono text-[11px] text-mist"
									>
										{dep}
									</span>
								))}
							</div>
						</div>
					)}
				</div>

				{/* Panel 2: Repository map */}
				<div className="rounded-xl border border-graphite bg-charcoal overflow-hidden flex flex-col shadow-sm">
					<div className="flex items-center justify-between border-b border-graphite p-4 sm:p-5">
						<h3 className="font-inter text-sm font-[600] text-snow">
							Repository map
						</h3>
						<span className="font-mono text-[11px] text-fog">
							{fileCount === undefined ? "—" : fileCount} files indexed (
							{excludedCount === undefined ? "—" : excludedCount} excluded)
						</span>
					</div>
					<div className="p-4 sm:p-5 flex-1 flex flex-col gap-4 text-xs">
						{analysis.moduleMap && analysis.moduleMap.length > 0 ? (
							<div className="rounded-lg border border-graphite/60 bg-onyx/50 divide-y divide-graphite/40 overflow-hidden max-h-64 overflow-y-auto">
								{analysis.moduleMap.map((entry) => {
									const parsed = splitPath(entry.path);
									return (
										<div
											key={entry.path}
											className="group flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between px-3 py-2 text-xs transition-colors hover:bg-steel/10 dark:hover:bg-steel/20"
										>
											<div className="flex items-center gap-2 min-w-0 sm:max-w-[52%]">
												{parsed.isFile ? (
													<FileCode
														size={14}
														className="text-slate shrink-0"
														aria-hidden="true"
													/>
												) : (
													<Folder
														size={14}
														className="text-slate shrink-0"
														aria-hidden="true"
													/>
												)}
												<span
													className="font-mono text-[11px] truncate text-snow"
													title={entry.path}
												>
													{parsed.dir && (
														<span className="text-slate font-normal">
															{parsed.dir}
														</span>
													)}
													<strong className="font-semibold text-snow">
														{parsed.name}
													</strong>
												</span>
											</div>
											<span
												className="text-[11px] text-fog sm:text-right sm:max-w-[46%] truncate"
												title={entry.summary}
											>
												{entry.summary}
											</span>
										</div>
									);
								})}
							</div>
						) : (
							<p className="text-slate italic text-xs">Tidak terdeteksi</p>
						)}

						{analysis.relevantFiles && analysis.relevantFiles.length > 0 && (
							<div className="mt-auto border-t border-graphite/60 pt-3 flex flex-col gap-2">
								<span className="font-mono text-[10px] uppercase text-slate tracking-wider">
									FILE RELEVAN ({analysis.relevantFiles.length})
								</span>
								<div className="rounded-lg border border-graphite/40 bg-onyx/30 divide-y divide-graphite/30 max-h-40 overflow-y-auto">
									{analysis.relevantFiles.map((file) => {
										const parsed = splitPath(file);
										return (
											<div
												key={file}
												className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-steel/10 dark:hover:bg-steel/20 transition-colors"
											>
												<FileCode
													size={13}
													className="text-slate shrink-0"
													aria-hidden="true"
												/>
												<span
													className="font-mono text-[11px] text-snow truncate"
													title={file}
												>
													{parsed.dir && (
														<span className="text-slate font-normal">
															{parsed.dir}
														</span>
													)}
													<strong className="font-medium text-snow">
														{parsed.name}
													</strong>
												</span>
											</div>
										);
									})}
								</div>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Panel 3: Potential Impact Areas from existing-codebase-flow.html */}
			<div className="rounded-xl border border-graphite bg-charcoal overflow-hidden shadow-sm">
				<div className="flex items-center justify-between border-b border-graphite p-4 sm:p-5">
					<h3 className="font-inter text-sm font-[600] text-snow">
						Potential impact areas
					</h3>
					<span className="rounded border border-graphite bg-obsidian px-2.5 py-0.5 font-mono text-[10px] text-fog">
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
									<p className="text-[11px] text-fog leading-relaxed">{area}</p>
								</div>
							))}
						</div>
					) : (
						<p className="text-slate italic text-xs">Tidak terdeteksi</p>
					)}

					{/* Findings & Uncertainties */}
					{analysis.findings && analysis.findings.length > 0 && (
						<div className="rounded-lg border border-graphite/60 bg-obsidian/40 p-4 flex flex-col gap-3">
							<span className="font-mono text-[10px] uppercase text-slate tracking-wider">
								TEMUAN DAN KETIDAKPASTIAN
							</span>
							<div className="flex flex-col gap-2.5">
								{analysis.findings.map((f) => (
									<div key={f.title} className="text-xs flex flex-col gap-1">
										<div className="flex items-center gap-2">
											<span className="font-medium text-snow">{f.title}</span>
											{f.uncertainty && (
												<span className="inline-flex items-center rounded border border-amber-600/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
													Perlu verifikasi
												</span>
											)}
										</div>
										<span className="text-fog text-[11px] leading-relaxed">
											{f.detail}
										</span>
										{f.uncertainty && (
											<span className="text-slate text-[11px] italic">
												Perlu verifikasi: {f.uncertainty}
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

					{/* Error Recovery Banner (only shown if error occurred) */}
					{errorMessage && (
						<div
							role="alert"
							className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-crimson/30 bg-crimson/10 p-3.5 text-xs text-crimson"
						>
							<div className="flex items-center gap-2">
								<span className="font-semibold">Gagal:</span>
								<span>{errorMessage}</span>
							</div>
							<div className="flex items-center gap-2">
								{onRetrySync && (
									<button
										type="button"
										onClick={onRetrySync}
										disabled={isWorking}
										className="rounded border border-crimson/40 px-3 py-1.5 text-xs font-medium text-crimson hover:bg-crimson/15 transition disabled:opacity-50"
									>
										Sync ulang
									</button>
								)}
								{onRetryAnalysis && (
									<button
										type="button"
										onClick={onRetryAnalysis}
										disabled={isWorking}
										className="rounded border border-crimson/40 px-3 py-1.5 text-xs font-medium text-crimson hover:bg-crimson/15 transition disabled:opacity-50"
									>
										{isWorking ? "Memproses..." : "Analisis ulang"}
									</button>
								)}
							</div>
						</div>
					)}

					{/* Screen Nav / Actions */}
					<div className="flex flex-wrap items-center justify-between gap-3 border-t border-graphite pt-4 text-xs">
						<div className="flex items-center gap-3 text-fog text-[11px]">
							<span>
								ID: <span className="font-mono text-snow">{snapshotId}</span>
							</span>
							<span>· {formatTimestamp(snapshotCreatedAt)}</span>
						</div>

						<div className="flex items-center gap-3">
							{onBackToSync && (
								<button
									type="button"
									onClick={onBackToSync}
									className="rounded-lg border border-graphite bg-transparent px-3 py-1.5 text-xs font-medium text-fog hover:text-snow hover:border-iron hover:bg-steel/10 transition cursor-pointer"
								>
									Lihat log sync
								</button>
							)}
							<button
								type="button"
								onClick={onContinue}
								disabled={isWorking}
								className="inline-flex items-center gap-1.5 rounded-lg bg-snow px-4 py-1.5 font-inter text-xs font-semibold text-onyx shadow-sm hover:brightness-105 active:scale-[0.98] transition disabled:opacity-50 cursor-pointer"
							>
								<span>Lanjut ke Pertanyaan</span>
								<span className="font-mono text-xs" aria-hidden="true">
									-&gt;
								</span>
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
