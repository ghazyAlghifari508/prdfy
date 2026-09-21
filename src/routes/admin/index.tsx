import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	ArrowUpRight,
	CreditCard,
	FolderGit2,
	Layers,
	MessageSquare,
	Users,
} from "lucide-react";
import { useRef, useState } from "react";
import { AdminMetricCard } from "@/components/admin/admin-metric-card";
import { useStreamerMode } from "@/components/admin/streamer-mode-context";
import { TrendLineChart } from "@/components/admin/trend-line-chart";
import {
	type AdminDashboardMetrics,
	type DailyTrendPoint,
	getAdminDashboardMetrics,
	getAdminTrendMetrics,
} from "@/lib/services/admin-service";

export const Route = createFileRoute("/admin/")({
	staleTime: 30_000,
	loader: async (): Promise<AdminDashboardMetrics> => {
		return await getAdminDashboardMetrics();
	},
	component: AdminDashboardPage,
});

function getStatusBadge(status: string) {
	const normalized = status.toLowerCase();
	if (["success", "settlement", "paid"].includes(normalized)) {
		return (
			<span className="inline-flex items-center rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-400">
				Selesai
			</span>
		);
	}
	if (["pending", "challenge"].includes(normalized)) {
		return (
			<span className="inline-flex items-center rounded border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-300">
				Pending
			</span>
		);
	}
	return (
		<span className="inline-flex items-center rounded border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-rose-300">
			{status}
		</span>
	);
}

function getPlanBadge(plan: string) {
	const p = plan.toLowerCase();
	if (p === "hengker") {
		return (
			<span className="inline-flex items-center rounded border border-amber-400/20 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
				Hengker
			</span>
		);
	}
	if (p === "pro") {
		return (
			<span className="inline-flex items-center rounded border border-indigo-400/20 bg-indigo-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
				Pro
			</span>
		);
	}
	return (
		<span className="inline-flex items-center rounded border border-graphite bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-mist">
			{plan}
		</span>
	);
}

function getStepBadge(step: string | null) {
	const s = (step || "draft").toLowerCase();
	const labelMap: Record<string, string> = {
		idea: "Ide",
		questions: "Tanya Jawab",
		prd: "PRD",
		ac: "AC",
		kanban: "Kanban",
	};
	const label = labelMap[s] || s;
	return (
		<span className="rounded border border-graphite bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-mist">
			{label}
		</span>
	);
}

function formatShortDate(date: Date | string | null | undefined): string {
	if (!date) return "—";
	const d = new Date(date);
	return d.toLocaleDateString("id-ID", {
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function AdminDashboardPage() {
	const metrics = Route.useLoaderData();
	const { maskOrderId, maskName, maskCurrency } = useStreamerMode();

	const [trendData, setTrendData] = useState<DailyTrendPoint[]>(
		metrics.trendData || [],
	);
	const [isLoadingTrend, setIsLoadingTrend] = useState<boolean>(false);
	const trendRequestRef = useRef(0);

	const handleRangeChange = async (days: number) => {
		const requestId = ++trendRequestRef.current;
		setIsLoadingTrend(true);
		try {
			const res = await getAdminTrendMetrics({ data: { days } });
			if (requestId === trendRequestRef.current) {
				setTrendData(res);
			}
		} catch (err) {
			console.error("Failed to fetch trend data:", err);
		} finally {
			if (requestId === trendRequestRef.current) {
				setIsLoadingTrend(false);
			}
		}
	};

	const hengkerCount =
		metrics.planDistribution?.find((p) => p.plan === "hengker")?.count ?? 0;
	const proCount =
		metrics.planDistribution?.find((p) => p.plan === "pro")?.count ?? 0;
	const totalPipelineOutputs =
		(metrics.prdCount ?? 0) +
		(metrics.acCount ?? 0) +
		(metrics.tasksCount ?? 0);
	const openTicketsCount =
		(metrics.feedbackCount ?? 0) + (metrics.errorCount ?? 0);

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

			{/* Page Header */}
			<header className="border-b border-graphite pb-6">
				<h1 className="font-inter text-2xl font-[510] text-snow">
					System Overview
				</h1>
				<p className="mt-1 text-sm text-fog">
					Metrik real-time pengguna, aktivitas pipeline AI, dan performa
					finansial platform.
				</p>
			</header>

			{/* 5 Key Metric Cards */}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
				<AdminMetricCard
					label="Total Pengguna"
					value={metrics.usersCount}
					subtext={`${hengkerCount} Hengker · ${proCount} Pro`}
					icon={Users}
				/>
				<AdminMetricCard
					label="Status Pipeline"
					value={totalPipelineOutputs}
					subtext={`${metrics.prdCount} PRD · ${metrics.acCount} AC · ${metrics.tasksCount} Task`}
					icon={Layers}
				/>
				<AdminMetricCard
					label="Proyek Siap"
					value={metrics.projectsCount}
					subtext="Proyek ide produk aktif"
					icon={FolderGit2}
				/>
				<AdminMetricCard
					label="Tiket Terbuka"
					value={openTicketsCount}
					subtext={`${metrics.feedbackCount} Saran · ${metrics.errorCount} Error`}
					icon={MessageSquare}
				/>
				<AdminMetricCard
					label="Pendapatan Bulan Ini"
					value={metrics.currentMonthRevenue}
					subtext="Total pembayaran sukses bulan ini"
					icon={CreditCard}
					isCurrency={true}
				/>
			</div>

			{/* Trend Line Chart Section */}
			<section className="relative">
				<TrendLineChart
					initialData={metrics.trendData}
					data={trendData}
					onRangeChange={handleRangeChange}
					className={
						isLoadingTrend
							? "opacity-70 transition-opacity"
							: "transition-opacity"
					}
				/>
				{isLoadingTrend && (
					<div className="absolute right-6 top-6 flex items-center gap-2 rounded-full border border-graphite bg-obsidian/80 px-3 py-1 text-[11px] text-fog backdrop-blur">
						<span className="h-1.5 w-1.5 animate-ping rounded-full bg-emerald-400" />
						Memperbarui grafik...
					</div>
				)}
			</section>

			{/* Bottom Two-Column Activity Cards */}
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
				{/* Card 1: Transaksi Booster Terbaru */}
				<section className="flex flex-col justify-between rounded-xl border border-graphite bg-charcoal p-5 sm:p-6 shadow-[var(--shadow-inset)]">
					<div>
						<div className="mb-4 flex items-center justify-between">
							<div>
								<h2 className="text-base font-[510] text-snow">
									Transaksi Booster Terbaru
								</h2>
								<p className="text-xs text-fog">
									Riwayat pesanan kredit & paket Mayar / Midtrans
								</p>
							</div>
							<Link
								to="/admin/transactions"
								className="text-xs font-medium text-fog hover:text-snow transition-colors"
							>
								Lihat Semua
							</Link>
						</div>

						{!metrics.recentTransactions ||
						metrics.recentTransactions.length === 0 ? (
							<div className="py-12 text-center text-xs text-fog">
								Belum ada transaksi booster tercatat.
							</div>
						) : (
							<div className="divide-y divide-graphite rounded-lg border border-graphite bg-obsidian">
								{metrics.recentTransactions.map((tx) => (
									<div
										key={tx.id}
										className="flex flex-col gap-2 p-3.5 sm:flex-row sm:items-center sm:justify-between transition-colors hover:bg-white/[0.02]"
									>
										<div className="min-w-0 flex-1 pr-2">
											<div className="flex items-center gap-2">
												<span className="font-mono text-xs font-medium text-snow">
													{maskOrderId(tx.orderId)}
												</span>
												{getPlanBadge(tx.plan)}
											</div>
											<p className="mt-1 truncate text-xs text-fog">
												{maskName(tx.userName || tx.userEmail)} ·{" "}
												{formatShortDate(tx.createdAt)}
											</p>
										</div>

										<div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
											{getStatusBadge(tx.status)}
											<span className="font-mono text-xs font-medium text-snow">
												{maskCurrency(tx.amount)}
											</span>
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				</section>

				{/* Card 2: Proyek Terbaru */}
				<section className="flex flex-col justify-between rounded-xl border border-graphite bg-charcoal p-5 sm:p-6 shadow-[var(--shadow-inset)]">
					<div>
						<div className="mb-4 flex items-center justify-between">
							<div>
								<h2 className="text-base font-[510] text-snow">
									Proyek Terbaru
								</h2>
								<p className="text-xs text-fog">
									Aktivitas pembuatan proyek paling akhir
								</p>
							</div>
							<Link
								to="/admin/projects"
								className="text-xs font-medium text-fog hover:text-snow transition-colors"
							>
								Kelola Proyek
							</Link>
						</div>

						{!metrics.recentProjects || metrics.recentProjects.length === 0 ? (
							<div className="py-12 text-center text-xs text-fog">
								Belum ada proyek yang dibuat.
							</div>
						) : (
							<div className="divide-y divide-graphite rounded-lg border border-graphite bg-obsidian">
								{metrics.recentProjects.map((p) => (
									<div
										key={p.id}
										className="flex items-center justify-between p-3.5 transition-colors hover:bg-white/[0.02]"
									>
										<div className="min-w-0 flex-1 pr-3">
											<p className="truncate text-sm font-[510] text-snow">
												{p.name}
											</p>
											<p className="mt-0.5 truncate text-xs text-fog">
												{maskName(p.userName || p.userEmail)} ·{" "}
												{formatShortDate(p.createdAt)}
											</p>
										</div>

										<div className="flex items-center gap-2.5 shrink-0">
											{getStepBadge(p.step)}
											<Link
												to="/prd/$id"
												params={{ id: p.id }}
												className="rounded p-1 text-fog hover:bg-white/5 hover:text-snow transition-colors"
												title="Buka proyek"
											>
												<ArrowUpRight size={16} />
											</Link>
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				</section>
			</div>
		</div>
	);
}
