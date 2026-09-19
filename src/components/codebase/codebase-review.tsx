"use client";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader>
					<CardTitle>Hasil Analisis Codebase</CardTitle>
					<CardDescription>
						Ringkasan advisori dari snapshot yang disinkronkan. Nilai yang tidak
						terdeteksi ditampilkan apa adanya.
					</CardDescription>
				</CardHeader>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Lingkungan terdeteksi</CardTitle>
				</CardHeader>
				<CardContent>
					<dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
						{envRows.map(([label, value]) => (
							<div key={label}>
								<dt className="text-fog">{label}</dt>
								<dd className="text-snow">{valueOrUnknown(value)}</dd>
							</div>
						))}
						{analysis.dependencies && analysis.dependencies.length > 0 && (
							<div className="md:col-span-2">
								<dt className="text-fog">Dependensi utama</dt>
								<dd className="text-snow">
									{analysis.dependencies.join(", ")}
								</dd>
							</div>
						)}
					</dl>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Peta repositori</CardTitle>
					<CardDescription>
						Modul dan file yang relevan menurut analisis.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-2 text-sm">
					{analysis.moduleMap && analysis.moduleMap.length > 0 ? (
						<ul className="flex flex-col gap-1">
							{analysis.moduleMap.map((entry) => (
								<li key={entry.path} className="text-snow">
									<span className="font-mono text-xs">{entry.path}</span>
									<span className="text-fog"> — {entry.summary}</span>
								</li>
							))}
						</ul>
					) : (
						<p className="text-fog">Tidak terdeteksi</p>
					)}
					{analysis.relevantFiles && analysis.relevantFiles.length > 0 && (
						<p className="text-fog">
							File relevan:{" "}
							<span className="font-mono text-xs text-snow">
								{analysis.relevantFiles.join(", ")}
							</span>
						</p>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Ringkasan eksklusi</CardTitle>
					<CardDescription>
						Hanya jumlah yang ditampilkan; isi file tidak pernah dikirim ke
						halaman ini.
					</CardDescription>
				</CardHeader>
				<CardContent className="text-sm text-snow">
					{fileCount ?? 0} file terupload, {excludedCount ?? 0} file dieksklusi
					(isi tidak ditampilkan).
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Area dampak</CardTitle>
				</CardHeader>
				<CardContent className="text-sm">
					{analysis.impactAreas && analysis.impactAreas.length > 0 ? (
						<ul className="flex flex-col gap-1">
							{analysis.impactAreas.map((area) => (
								<li key={area} className="text-snow">
									{area}
								</li>
							))}
						</ul>
					) : (
						<p className="text-fog">Tidak terdeteksi</p>
					)}
					{analysis.limitations && analysis.limitations.length > 0 && (
						<div className="mt-2">
							<p className="text-fog">Keterbatasan:</p>
							<ul className="flex flex-col gap-1">
								{analysis.limitations.map((limitation) => (
									<li key={limitation} className="text-snow">
										{limitation}
									</li>
								))}
							</ul>
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Temuan dan ketidakpastian</CardTitle>
					<CardDescription>
						Temuan bertanda perlu verifikasi belum pasti — periksa sebelum
						generasi.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-3 text-sm">
					{analysis.findings && analysis.findings.length > 0 ? (
						analysis.findings.map((finding) => (
							<div key={finding.title} className="flex flex-col gap-1">
								<p className="font-medium text-snow">
									{finding.title}{" "}
									{finding.uncertainty && (
										<span className="ml-1 rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
											Perlu verifikasi
										</span>
									)}
								</p>
								<p className="text-fog">{finding.detail}</p>
								{finding.uncertainty && (
									<p className="text-fog">
										Ketidakpastian: {finding.uncertainty}
									</p>
								)}
							</div>
						))
					) : (
						<p className="text-fog">Tidak ada temuan.</p>
					)}
					{uncertainFindings.length === 0 &&
						analysis.findings &&
						analysis.findings.length > 0 && (
							<p className="text-fog">
								Semua temuan di atas tanpa ketidakpastian tercatat.
							</p>
						)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Snapshot</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-1 text-sm">
					<p className="text-fog">
						ID snapshot:{" "}
						<span className="font-mono text-xs text-snow">{snapshotId}</span>
					</p>
					<p className="text-fog">
						Waktu sync:{" "}
						<span className="text-snow">
							{formatTimestamp(snapshotCreatedAt)}
						</span>
					</p>
				</CardContent>
			</Card>

			<div className="flex flex-wrap justify-end gap-2">
				<Button variant="outline" onClick={onRetrySync} disabled={isWorking}>
					Sync ulang
				</Button>
				<Button
					variant="secondary"
					onClick={onRetryAnalysis}
					disabled={isWorking}
				>
					{isWorking ? "Memproses" : "Analisis ulang"}
				</Button>
				<Button onClick={onContinue} disabled={isWorking}>
					Lanjut ke Ask
				</Button>
			</div>
		</div>
	);
}
