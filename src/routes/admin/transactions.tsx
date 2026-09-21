import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	CheckCircle2,
	Clock,
	CreditCard,
	Search,
} from "lucide-react";
import { useState } from "react";
import { AdminMetricCard } from "@/components/admin/admin-metric-card";
import { useStreamerMode } from "@/components/admin/streamer-mode-context";
import {
	type AdminTransactionItem,
	listAdminTransactions,
} from "@/lib/services/admin-service";

export const Route = createFileRoute("/admin/transactions")({
	staleTime: 30_000,
	loader: async () => {
		return await listAdminTransactions({ data: { limit: 100 } });
	},
	component: AdminTransactionsPage,
});

function AdminTransactionsPage() {
	const { transactions } = Route.useLoaderData();
	const { isStreamerMode, maskOrderId, maskName, maskEmail, maskCurrency } =
		useStreamerMode();

	const [search, setSearch] = useState("");
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [planFilter, setPlanFilter] = useState<string>("all");

	const filteredTransactions = transactions.filter(
		(tx: AdminTransactionItem) => {
			const q = search.toLowerCase();
			const matchesSearch =
				!search ||
				tx.orderId.toLowerCase().includes(q) ||
				tx.userName?.toLowerCase().includes(q) ||
				tx.userEmail?.toLowerCase().includes(q);

			const matchesStatus =
				statusFilter === "all" ||
				(statusFilter === "success" &&
					(tx.status === "success" ||
						tx.status === "settlement" ||
						tx.status === "capture")) ||
				(statusFilter === "expire" &&
					(tx.status === "expire" ||
						tx.status === "failed" ||
						tx.status === "cancel")) ||
				tx.status === statusFilter;
			const matchesPlan = planFilter === "all" || tx.plan === planFilter;

			return matchesSearch && matchesStatus && matchesPlan;
		},
	);

	const successCount = transactions.filter(
		(t) => t.status === "success" || t.status === "settlement",
	).length;
	const pendingCount = transactions.filter(
		(t) => t.status === "pending",
	).length;
	const totalRevenue = transactions
		.filter((t) => t.status === "success" || t.status === "settlement")
		.reduce((sum, t) => sum + (t.amount ?? 0), 0);

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
					Transaksi Booster & Langganan
				</h1>
				<p className="mt-1 text-sm text-fog">
					Kelola riwayat pesanan kredit booster, status pembayaran Midtrans /
					Mayar, dan performa finansial.
				</p>
			</header>

			{/* Metric Summary Bar */}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<AdminMetricCard
					label="Total Transaksi"
					value={transactions.length}
					subtext="Pesanan tercatat di sistem"
					icon={CreditCard}
				/>
				<AdminMetricCard
					label="Transaksi Sukses"
					value={successCount}
					subtext="Berhasil terbayar"
					icon={CheckCircle2}
				/>
				<AdminMetricCard
					label="Menunggu Pembayaran"
					value={pendingCount}
					subtext="Status pending di payment gateway"
					icon={Clock}
				/>
				<AdminMetricCard
					label="Total Penerimaan"
					value={totalRevenue}
					subtext="Akumulasi pembayaran sukses"
					icon={CreditCard}
					isCurrency={true}
				/>
			</div>

			{/* Filters */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="relative flex-1 max-w-md">
					<Search
						size={15}
						className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fog"
					/>
					<input
						type="text"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Cari order ID, email, atau nama..."
						className="w-full rounded-lg border border-graphite bg-charcoal py-2 pl-9 pr-4 text-xs font-inter text-snow placeholder:text-fog/60 focus:border-fog/40 focus:outline-none"
					/>
				</div>

				<div className="flex flex-wrap gap-1.5">
					<div className="flex rounded-lg border border-graphite bg-charcoal p-0.5">
						{(
							[
								{ id: "all", label: "Semua Status" },
								{ id: "success", label: "Sukses" },
								{ id: "pending", label: "Pending" },
								{ id: "expire", label: "Expired" },
							] as const
						).map((tab) => (
							<button
								key={tab.id}
								type="button"
								onClick={() => setStatusFilter(tab.id)}
								className={`rounded-md px-2.5 py-1 text-xs font-[510] transition-colors ${
									statusFilter === tab.id
										? "bg-snow text-onyx shadow-sm"
										: "text-fog hover:text-snow"
								}`}
							>
								{tab.label}
							</button>
						))}
					</div>

					<div className="flex rounded-lg border border-graphite bg-charcoal p-0.5">
						{(
							[
								{ id: "all", label: "Semua Paket" },
								{ id: "hengker", label: "Hengker" },
								{ id: "pro", label: "Pro" },
							] as const
						).map((tab) => (
							<button
								key={tab.id}
								type="button"
								onClick={() => setPlanFilter(tab.id)}
								className={`rounded-md px-2.5 py-1 text-xs font-[510] transition-colors ${
									planFilter === tab.id
										? "bg-snow text-onyx shadow-sm"
										: "text-fog hover:text-snow"
								}`}
							>
								{tab.label}
							</button>
						))}
					</div>
				</div>
			</div>

			{/* Transactions Table */}
			<div className="overflow-hidden rounded-xl border border-graphite bg-charcoal shadow-sm">
				<div className="overflow-x-auto">
					<table className="w-full text-left text-xs font-inter">
						<thead className="border-b border-graphite bg-obsidian/40 text-fog">
							<tr>
								<th className="px-5 py-3 font-semibold">Order ID</th>
								<th className="px-5 py-3 font-semibold">Pengguna</th>
								<th className="px-5 py-3 font-semibold">Paket</th>
								<th className="px-5 py-3 font-semibold">Nominal</th>
								<th className="px-5 py-3 font-semibold">Status</th>
								<th className="px-5 py-3 font-semibold">Tanggal</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-graphite">
							{filteredTransactions.length === 0 ? (
								<tr>
									<td
										colSpan={6}
										className="px-5 py-10 text-center text-sm text-fog"
									>
										Tidak ada transaksi yang cocok dengan filter pencarian.
									</td>
								</tr>
							) : (
								filteredTransactions.map((tx: AdminTransactionItem) => {
									const isSuccess =
										tx.status === "success" || tx.status === "settlement";
									const isPending = tx.status === "pending";

									return (
										<tr
											key={tx.id}
											className="transition-colors hover:bg-white/[0.02]"
										>
											<td className="px-5 py-3.5 font-mono text-[11px] text-snow">
												{isStreamerMode ? maskOrderId(tx.orderId) : tx.orderId}
											</td>
											<td className="px-5 py-3.5">
												<div className="font-medium text-snow">
													{isStreamerMode
														? maskName(tx.userName)
														: (tx.userName ?? "Tanpa Nama")}
												</div>
												<div className="text-[11px] text-fog">
													{isStreamerMode
														? maskEmail(tx.userEmail)
														: (tx.userEmail ?? "-")}
												</div>
											</td>
											<td className="px-5 py-3.5">
												<span
													className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
														tx.plan === "hengker"
															? "bg-amber-500/10 text-amber-300 border border-amber-500/20"
															: "bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
													}`}
												>
													{tx.plan}
												</span>
											</td>
											<td className="px-5 py-3.5 font-mono font-medium text-snow">
												{isStreamerMode
													? maskCurrency(tx.amount)
													: new Intl.NumberFormat("id-ID", {
															style: "currency",
															currency: "IDR",
															maximumFractionDigits: 0,
														}).format(tx.amount)}
											</td>
											<td className="px-5 py-3.5">
												<span
													className={`inline-flex items-center rounded-md px-2.5 py-0.5 text-[11px] font-medium ${
														isSuccess
															? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
															: isPending
																? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
																: "bg-crimson/10 text-crimson border border-crimson/20"
													}`}
												>
													{isSuccess
														? "Selesai"
														: isPending
															? "Pending"
															: "Gagal / Expired"}
												</span>
											</td>
											<td className="px-5 py-3.5 text-fog">
												{tx.createdAt
													? new Intl.DateTimeFormat("id-ID", {
															day: "numeric",
															month: "short",
															year: "numeric",
															hour: "2-digit",
															minute: "2-digit",
														}).format(new Date(tx.createdAt))
													: "-"}
											</td>
										</tr>
									);
								})
							)}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}
