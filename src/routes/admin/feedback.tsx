import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	Bug,
	CheckCircle2,
	Inbox,
	MessageSquare,
	Search,
	Sparkles,
} from "lucide-react";
import { useState } from "react";
import { AdminMetricCard } from "@/components/admin/admin-metric-card";
import { useStreamerMode } from "@/components/admin/streamer-mode-context";
import { listErrorReports, listFeedback } from "@/lib/services/admin-service";

export const Route = createFileRoute("/admin/feedback")({
	staleTime: 30_000,
	loader: async () => {
		const [feedback, errors] = await Promise.all([
			listFeedback({ data: {} }),
			listErrorReports(),
		]);
		return { feedback, errors };
	},
	component: AdminFeedbackPage,
});

function AdminFeedbackPage() {
	const { feedback, errors } = Route.useLoaderData();
	const { isStreamerMode, maskName, maskEmail } = useStreamerMode();
	const [activeTab, setActiveTab] = useState<"feedback" | "errors">("feedback");
	const [typeFilter, setTypeFilter] = useState<string>("all");
	const [search, setSearch] = useState("");

	const filteredFeedback = feedback.filter((f) => {
		const matchesSearch =
			!search ||
			f.message.toLowerCase().includes(search.toLowerCase()) ||
			f.userEmail?.toLowerCase().includes(search.toLowerCase()) ||
			f.userName?.toLowerCase().includes(search.toLowerCase());
		const matchesType = typeFilter === "all" || f.type === typeFilter;
		return matchesSearch && matchesType;
	});

	const filteredErrors = errors.filter((e) => {
		return (
			!search ||
			e.errorMessage.toLowerCase().includes(search.toLowerCase()) ||
			e.context?.toLowerCase().includes(search.toLowerCase()) ||
			e.userEmail?.toLowerCase().includes(search.toLowerCase())
		);
	});

	const generalCount = feedback.filter((f) => f.type === "general").length;
	const featureCount = feedback.filter((f) => f.type === "feature").length;
	const bugCount =
		errors.length + feedback.filter((f) => f.type === "bug").length;

	return (
		<div className="mx-auto max-w-7xl space-y-8 font-inter">
			{/* Quick Workspace Back Link */}
			<div className="flex items-center">
				<Link
					to="/"
					className="inline-flex items-center gap-1.5 text-xs font-[510] text-fog transition-colors hover:text-snow"
				>
					<ArrowLeft size={14} />
					<span>Kembali ke Workspace</span>
				</Link>
			</div>

			{/* Header */}
			<header className="border-b border-graphite pb-6">
				<h1 className="text-2xl font-[510] text-snow">
					Feedback & Laporan Error
				</h1>
				<p className="mt-1 text-sm text-fog">
					Daftar masukan pengguna, permintaan fitur, dan catatan crash sistem.
				</p>
			</header>

			{/* Metric Summary Bar */}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<AdminMetricCard
					label="Total Masukan"
					value={feedback.length + errors.length}
					subtext="Feedback & log error"
					icon={Inbox}
				/>
				<AdminMetricCard
					label="Feedback Umum"
					value={generalCount}
					subtext="Masukan & saran pengguna"
					icon={MessageSquare}
				/>
				<AdminMetricCard
					label="Permintaan Fitur"
					value={featureCount}
					subtext="Ide & wishlist pengguna"
					icon={Sparkles}
				/>
				<AdminMetricCard
					label="Bug & Crash"
					value={bugCount}
					subtext="Tiket bug & error sistem"
					icon={Bug}
				/>
			</div>

			{/* Filters and Tabs Bar */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex gap-1.5 overflow-x-auto">
					<button
						type="button"
						onClick={() => {
							setActiveTab("feedback");
							setTypeFilter("all");
						}}
						className={`rounded-md px-3 py-1.5 text-xs font-[510] transition-colors ${
							activeTab === "feedback"
								? "bg-snow text-onyx"
								: "border border-graphite bg-charcoal text-fog hover:border-fog/40 hover:text-snow"
						}`}
					>
						Feedback Pengguna ({feedback.length})
					</button>

					<button
						type="button"
						onClick={() => {
							setActiveTab("errors");
							setTypeFilter("all");
						}}
						className={`rounded-md px-3 py-1.5 text-xs font-[510] transition-colors ${
							activeTab === "errors"
								? "bg-snow text-onyx"
								: "border border-graphite bg-charcoal text-fog hover:border-fog/40 hover:text-snow"
						}`}
					>
						Laporan Error ({errors.length})
					</button>
				</div>

				<div className="flex items-center gap-2">
					{/* Type filter for feedback */}
					{activeTab === "feedback" && (
						<div className="flex gap-1">
							{(["all", "bug", "feature", "general"] as const).map((t) => (
								<button
									key={t}
									type="button"
									onClick={() => setTypeFilter(t)}
									className={`rounded px-2 py-1 text-[11px] font-[510] capitalize transition-colors ${
										typeFilter === t
											? "bg-white/15 text-snow border border-graphite"
											: "text-fog hover:text-snow"
									}`}
								>
									{t === "all" ? "Semua" : t}
								</button>
							))}
						</div>
					)}

					<div className="relative w-48 sm:w-64">
						<Search
							size={14}
							className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fog"
						/>
						<input
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Cari..."
							className="w-full rounded-lg border border-graphite bg-charcoal py-1.5 pl-8 pr-3 text-xs text-snow placeholder:text-fog/60 focus:border-fog/40 focus:outline-none"
						/>
					</div>
				</div>
			</div>

			{/* Main Content List */}
			{activeTab === "feedback" ? (
				<div className="space-y-3">
					{filteredFeedback.length === 0 ? (
						<div className="flex flex-col items-center justify-center rounded-xl border border-graphite bg-charcoal/40 py-16 text-center">
							<div className="flex h-10 w-10 items-center justify-center rounded-full bg-obsidian border border-graphite text-fog mb-3">
								<Inbox size={18} />
							</div>
							<p className="text-sm font-[510] text-snow">Belum ada feedback</p>
							<p className="mt-1 text-xs text-fog max-w-sm">
								Feedback dan bug report yang dikirimkan user dari halaman
								Settings akan tercatat di sini.
							</p>
						</div>
					) : (
						<div className="overflow-x-auto rounded-xl border border-graphite bg-charcoal shadow-[var(--shadow-inset)]">
							<table className="w-full text-left text-xs">
								<thead>
									<tr className="border-b border-graphite bg-obsidian text-fog">
										<th className="px-4 py-3 font-[510]">Tipe</th>
										<th className="px-4 py-3 font-[510]">Pesan Feedback</th>
										<th className="px-4 py-3 font-[510]">Pengirim</th>
										<th className="px-4 py-3 font-[510] text-right">Waktu</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-graphite">
									{filteredFeedback.map((f) => (
										<tr
											key={f.id}
											className="transition-colors hover:bg-white/[0.02]"
										>
											<td className="px-4 py-3 whitespace-nowrap">
												<span
													className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
														f.type === "bug"
															? "bg-rose-500/10 text-rose-300 border border-rose-500/20"
															: f.type === "feature"
																? "bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
																: "bg-white/5 text-fog border border-graphite"
													}`}
												>
													{f.type === "bug" ? (
														<Bug size={10} />
													) : f.type === "feature" ? (
														<Sparkles size={10} />
													) : (
														<MessageSquare size={10} />
													)}
													{f.type}
												</span>
											</td>

											<td className="px-4 py-3">
												<p className="font-normal text-snow whitespace-pre-wrap max-w-xl">
													{f.message}
												</p>
											</td>

											<td className="px-4 py-3 whitespace-nowrap">
												<p className="font-[510] text-snow">
													{isStreamerMode
														? maskName(f.userName)
														: f.userName || "Tanpa Nama"}
												</p>
												<p className="text-[11px] text-fog">
													{isStreamerMode
														? maskEmail(f.userEmail)
														: f.userEmail || "Anonymous"}
												</p>
											</td>

											<td className="px-4 py-3 text-right text-fog whitespace-nowrap">
												{f.createdAt
													? new Date(f.createdAt).toLocaleDateString("id-ID", {
															day: "numeric",
															month: "short",
															year: "numeric",
															hour: "2-digit",
															minute: "2-digit",
														})
													: "-"}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			) : (
				<div className="space-y-3">
					{filteredErrors.length === 0 ? (
						<div className="flex flex-col items-center justify-center rounded-xl border border-graphite bg-charcoal/40 py-16 text-center">
							<div className="flex h-10 w-10 items-center justify-center rounded-full bg-obsidian border border-graphite text-emerald-400 mb-3">
								<CheckCircle2 size={18} />
							</div>
							<p className="text-sm font-[510] text-snow">
								Semua sistem berjalan normal
							</p>
							<p className="mt-1 text-xs text-fog max-w-sm">
								Tidak ada error client-side yang dilaporkan saat ini.
							</p>
						</div>
					) : (
						<div className="overflow-x-auto rounded-xl border border-graphite bg-charcoal shadow-[var(--shadow-inset)]">
							<table className="w-full text-left text-xs">
								<thead>
									<tr className="border-b border-graphite bg-obsidian text-fog">
										<th className="px-4 py-3 font-[510]">Error Message</th>
										<th className="px-4 py-3 font-[510]">Konteks / Stack</th>
										<th className="px-4 py-3 font-[510]">User</th>
										<th className="px-4 py-3 font-[510] text-right">Waktu</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-graphite">
									{filteredErrors.map((e) => (
										<tr
											key={e.id}
											className="transition-colors hover:bg-white/[0.02]"
										>
											<td className="px-4 py-3 font-mono text-rose-300 max-w-xs truncate">
												{e.errorMessage}
											</td>
											<td className="px-4 py-3 font-mono text-fog max-w-md truncate">
												{e.context || "-"}
											</td>
											<td className="px-4 py-3 text-fog whitespace-nowrap">
												{isStreamerMode
													? maskEmail(e.userEmail)
													: e.userEmail || "-"}
											</td>
											<td className="px-4 py-3 text-right text-fog whitespace-nowrap">
												{e.createdAt
													? new Date(e.createdAt).toLocaleDateString("id-ID", {
															day: "numeric",
															month: "short",
															year: "numeric",
															hour: "2-digit",
															minute: "2-digit",
														})
													: "-"}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
