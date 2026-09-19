"use client";

import {
	AlertTriangle,
	ArrowRight,
	Check,
	Code2,
	FolderGit2,
	Layers,
	RefreshCw,
	Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
}: CodebaseReviewProps) {
	const envRows: Array<[string, string | undefined | null]> = [
		["Framework", analysis.framework],
		["Bahasa", analysis.language],
		["Package manager", analysis.packageManager],
		["Database", analysis.database],
		["Auth", analysis.auth],
	];
	const uncertainFindings = (analysis.findings ?? []).filter(
		(finding) => finding.uncertainty && finding.uncertainty.length > 0,
	);

	return (
		<div className="flex flex-col gap-6 animate-fade-in text-card-foreground">
			{/* Review Header */}
			<div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-graphite bg-card p-5 shadow-sm sm:p-6">
				<div className="flex flex-col gap-1">
					<div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-fog">
						<Sparkles size={13} className="text-blue-600 dark:text-blue-400" />
						<span>Analisis Codebase · Konteks Siap</span>
					</div>
					<h2 className="font-inter text-xl font-[550] text-snow sm:text-2xl">
						Hasil Analisis Codebase
					</h2>
					<p className="text-xs text-fog max-w-2xl">
						Ringkasan advisori dari snapshot yang disinkronkan. Nilai yang tidak
						terdeteksi ditampilkan apa adanya. Tinjau hasil ini sebelum lanjut
						ke penyusunan pertanyaan (Ask).
					</p>
				</div>
				<span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
					<span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
					Siap digunakan
				</span>
			</div>

			{/* Bento Grid: Environment & Repository Map */}
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
				{/* Detected Environment Card */}
				<div className="flex flex-col rounded-xl border border-graphite bg-card p-5 shadow-sm sm:p-6">
					<div className="flex items-center justify-between border-b border-graphite pb-3.5">
						<div className="flex items-center gap-2.5">
							<div className="flex h-7 w-7 items-center justify-center rounded-md border border-iron bg-muted text-mist">
								<Code2 size={15} />
							</div>
							<h3 className="font-inter text-sm font-[550] text-snow">
								Lingkungan terdeteksi
							</h3>
						</div>
						<span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono">
							✓ Auto-detected
						</span>
					</div>

					<div className="mt-4 flex flex-col divide-y divide-graphite/60">
						{envRows.map(([label, value]) => {
							const valStr = valueOrUnknown(value);
							const isUnknown = valStr === "Tidak terdeteksi";
							return (
								<div
									key={label}
									className="flex items-center justify-between py-2.5 text-xs"
								>
									<span className="text-fog font-medium">{label}</span>
									<span
										className={`font-mono text-right ${
											isUnknown ? "text-slate italic" : "text-snow font-medium"
										}`}
									>
										{valStr}
									</span>
								</div>
							);
						})}
					</div>

					{analysis.dependencies && analysis.dependencies.length > 0 && (
						<div className="mt-4 border-t border-graphite pt-3">
							<p className="text-[11px] font-mono uppercase text-slate mb-2">
								Dependensi utama
							</p>
							<div className="flex flex-wrap gap-1.5">
								{analysis.dependencies.map((dep) => (
									<span
										key={dep}
										className="rounded border border-iron bg-muted px-2 py-0.5 font-mono text-[11px] text-mist"
									>
										{dep}
									</span>
								))}
							</div>
						</div>
					)}
				</div>

				{/* Repository Map Card */}
				<div className="flex flex-col rounded-xl border border-graphite bg-card p-5 shadow-sm sm:p-6">
					<div className="flex items-center justify-between border-b border-graphite pb-3.5">
						<div className="flex items-center gap-2.5">
							<div className="flex h-7 w-7 items-center justify-center rounded-md border border-iron bg-muted text-mist">
								<FolderGit2 size={15} />
							</div>
							<h3 className="font-inter text-sm font-[550] text-snow">
								Peta repositori
							</h3>
						</div>
						<span className="text-[11px] font-mono text-fog">
							{fileCount ?? 0} file terupload, {excludedCount ?? 0} file
							dieksklusi
						</span>
					</div>

					<div className="mt-4 flex-1 flex flex-col gap-3 text-xs">
						<p className="text-xs text-fog">
							Modul dan file yang relevan menurut analisis.
						</p>

						{analysis.moduleMap && analysis.moduleMap.length > 0 ? (
							<div className="flex flex-col gap-2 rounded-lg border border-graphite bg-muted/30 p-3 max-h-64 overflow-y-auto hide-scrollbar">
								{analysis.moduleMap.map((entry) => (
									<div
										key={entry.path}
										className="flex flex-col gap-0.5 rounded border border-graphite/60 bg-card p-2 text-xs"
									>
										<span className="font-mono text-blue-700 dark:text-blue-300 font-medium">
											{entry.path}
										</span>
										<span className="text-[11px] text-fog">
											— {entry.summary}
										</span>
									</div>
								))}
							</div>
						) : (
							<p className="text-slate italic">Tidak terdeteksi</p>
						)}

						{analysis.relevantFiles && analysis.relevantFiles.length > 0 && (
							<div className="mt-auto border-t border-graphite pt-3 text-[11px]">
								<span className="text-fog">File relevan: </span>
								<span className="font-mono text-snow">
									{analysis.relevantFiles.join(", ")}
								</span>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Second Row: Impact Areas & Findings */}
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
				{/* Impact Areas */}
				<div className="flex flex-col rounded-xl border border-graphite bg-card p-5 shadow-sm sm:p-6">
					<div className="flex items-center gap-2.5 border-b border-graphite pb-3.5">
						<div className="flex h-7 w-7 items-center justify-center rounded-md border border-iron bg-muted text-mist">
							<Layers size={15} />
						</div>
						<h3 className="font-inter text-sm font-[550] text-snow">
							Area dampak
						</h3>
					</div>

					<div className="mt-4 flex flex-col gap-3 text-xs">
						{analysis.impactAreas && analysis.impactAreas.length > 0 ? (
							<ul className="flex flex-col gap-2">
								{analysis.impactAreas.map((area) => (
									<li
										key={area}
										className="flex items-start gap-2 rounded-lg border border-graphite bg-muted/30 p-2.5 text-snow"
									>
										<span className="mt-0.5 text-blue-600 dark:text-blue-400 font-mono">◈</span>
										<span>{area}</span>
									</li>
								))}
							</ul>
						) : (
							<p className="text-slate italic">Tidak terdeteksi</p>
						)}

						{analysis.limitations && analysis.limitations.length > 0 && (
							<div className="mt-3 rounded-lg border border-graphite bg-muted/40 p-3">
								<p className="text-[11px] font-mono uppercase text-slate mb-1.5">
									Keterbatasan:
								</p>
								<ul className="flex flex-col gap-1 text-[11px] text-fog">
									{analysis.limitations.map((limitation) => (
										<li key={limitation}>• {limitation}</li>
									))}
								</ul>
							</div>
						)}
					</div>
				</div>

				{/* Findings & Uncertainties */}
				<div className="flex flex-col rounded-xl border border-graphite bg-card p-5 shadow-sm sm:p-6">
					<div className="flex items-center gap-2.5 border-b border-graphite pb-3.5">
						<div className="flex h-7 w-7 items-center justify-center rounded-md border border-iron bg-muted text-mist">
							<AlertTriangle size={15} className="text-amber-500" />
						</div>
						<div>
							<h3 className="font-inter text-sm font-[550] text-snow">
								Temuan dan ketidakpastian
							</h3>
							<p className="text-[11px] text-fog">
								Temuan bertanda perlu verifikasi belum pasti — periksa sebelum
								generasi.
							</p>
						</div>
					</div>

					<div className="mt-4 flex flex-col gap-3 text-xs">
						{analysis.findings && analysis.findings.length > 0 ? (
							analysis.findings.map((finding) => (
								<div
									key={finding.title}
									className="flex flex-col gap-1.5 rounded-lg border border-graphite bg-muted/30 p-3"
								>
									<div className="flex items-center justify-between gap-2">
										<p className="font-semibold text-snow">{finding.title}</p>
										{finding.uncertainty && (
											<span className="rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-500/15 dark:border-amber-500/25 dark:text-amber-300 shrink-0">
												Perlu verifikasi
											</span>
										)}
									</div>
									<p className="text-fog leading-relaxed">{finding.detail}</p>
									{finding.uncertainty && (
										<p className="text-[11px] text-amber-700 dark:text-amber-300 italic">
											Ketidakpastian: {finding.uncertainty}
										</p>
									)}
								</div>
							))
						) : (
							<p className="text-slate italic">Tidak ada temuan.</p>
						)}
						{uncertainFindings.length === 0 &&
							analysis.findings &&
							analysis.findings.length > 0 && (
								<p className="text-[11px] text-fog italic px-1">
									Semua temuan di atas tanpa ketidakpastian tercatat.
								</p>
							)}
					</div>
				</div>
			</div>

			{/* Snapshot Footer Details */}
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-graphite bg-card px-5 py-3.5 text-xs shadow-sm">
				<div className="flex flex-wrap items-center gap-4 text-fog">
					<div>
						ID snapshot:{" "}
						<span className="font-mono text-snow font-medium">{snapshotId}</span>
					</div>
					<div>
						Waktu sync:{" "}
						<span className="text-snow font-medium">
							{formatTimestamp(snapshotCreatedAt)}
						</span>
					</div>
				</div>

				{/* Action CTAs */}
				<div className="flex flex-wrap items-center gap-2.5">
					<Button
						variant="outline"
						onClick={onRetrySync}
						disabled={isWorking}
						className="border-iron bg-surface text-xs hover:bg-muted text-mist"
					>
						<RefreshCw size={12} className="mr-1.5" />
						Sync ulang
					</Button>
					<Button
						variant="outline"
						onClick={onRetryAnalysis}
						disabled={isWorking}
						className="border-iron bg-surface text-xs hover:bg-muted text-mist"
					>
						<RefreshCw size={12} className="mr-1.5" />
						{isWorking ? "Memproses" : "Analisis ulang"}
					</Button>
					<Button
						onClick={onContinue}
						disabled={isWorking}
						className="btn-primary rounded-md px-5 py-2 font-inter text-xs font-[550]"
					>
						<span>Lanjut ke Ask</span>
						<ArrowRight size={13} className="ml-1.5" />
					</Button>
				</div>
			</div>
		</div>
	);
}
