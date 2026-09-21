import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	Ban,
	Crown,
	Search,
	Shield,
	UserCheck,
	Users,
} from "lucide-react";
import { useState } from "react";
import { AdminMetricCard } from "@/components/admin/admin-metric-card";
import { useStreamerMode } from "@/components/admin/streamer-mode-context";
import {
	listUsers,
	resetUserCredit,
	setUserAdmin,
	setUserBanned,
	updateUserPlan,
} from "@/lib/services/admin-service";
import { requireAdminServer } from "@/lib/session";
import { useUIStore } from "@/store";

export const Route = createFileRoute("/admin/users")({
	staleTime: 30_000,
	loader: async () => {
		const [rows, adminUser] = await Promise.all([
			listUsers({ data: { limit: 100 } }),
			requireAdminServer(),
		]);
		return { rows, currentUserId: adminUser.id };
	},
	component: AdminUsersPage,
});

function AdminUsersPage() {
	const { rows, currentUserId } = Route.useLoaderData();
	const { isStreamerMode, maskName, maskEmail } = useStreamerMode();
	const [search, setSearch] = useState("");
	const [planFilter, setPlanFilter] = useState<string>("all");
	const [loadingAction, setLoadingAction] = useState<string | null>(null);
	const showToast = useUIStore((s) => s.showToast);

	const isMutating = loadingAction !== null;

	const handleAction = async (actionName: string, fn: () => Promise<void>) => {
		setLoadingAction(actionName);
		try {
			await fn();
			showToast("Aksi berhasil dijalankan", "success");
			window.location.reload();
		} catch (err) {
			console.error(err);
			showToast("Gagal menjalankan aksi", "error");
		} finally {
			setLoadingAction(null);
		}
	};

	const filteredRows = rows.filter(({ user, sub }) => {
		const matchesSearch =
			!search ||
			user.email.toLowerCase().includes(search.toLowerCase()) ||
			user.name?.toLowerCase().includes(search.toLowerCase());
		const matchesPlan =
			planFilter === "all" || (sub?.plan ?? "free") === planFilter;
		return matchesSearch && matchesPlan;
	});

	const freeCount = rows.filter(
		(r) => (r.sub?.plan ?? "free") === "free",
	).length;
	const proCount = rows.filter((r) => r.sub?.plan === "pro").length;
	const hengkerCount = rows.filter((r) => r.sub?.plan === "hengker").length;
	const adminCount = rows.filter(
		(r) =>
			Boolean(r.user.isAdmin) || (r.user as { role?: string }).role === "admin",
	).length;

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
				<h1 className="text-2xl font-[510] text-snow">Manajemen Pengguna</h1>
				<p className="mt-1 text-sm text-fog">
					Kelola hak akses, status paket langganan, dan batasan akun pengguna.
				</p>
			</header>

			{/* Metric Summary Bar */}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
				<AdminMetricCard
					label="Total Pengguna"
					value={rows.length}
					subtext="Akun pengguna terdaftar"
					icon={Users}
				/>
				<AdminMetricCard
					label="Paket Free"
					value={freeCount}
					subtext="Pengguna tier gratis"
					icon={Users}
				/>
				<AdminMetricCard
					label="Paket Pro"
					value={proCount}
					subtext="Pengguna paket Pro"
					icon={UserCheck}
				/>
				<AdminMetricCard
					label="Paket Hengker"
					value={hengkerCount}
					subtext="Pengguna tier tertinggi"
					icon={Crown}
				/>
				<AdminMetricCard
					label="Administrator"
					value={adminCount}
					subtext="Akses penuh ke sistem"
					icon={Shield}
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
						placeholder="Cari email atau nama pengguna..."
						className="w-full rounded-lg border border-graphite bg-charcoal py-2 pl-9 pr-4 text-xs font-inter text-snow placeholder:text-fog/60 focus:border-fog/40 focus:outline-none"
					/>
				</div>

				<div className="flex gap-1.5 overflow-x-auto">
					{(["all", "free", "pro", "hengker"] as const).map((p) => (
						<button
							key={p}
							type="button"
							onClick={() => setPlanFilter(p)}
							className={`rounded-md px-3 py-1.5 text-xs font-[510] capitalize transition-colors ${
								planFilter === p
									? "bg-snow text-onyx"
									: "border border-graphite bg-charcoal text-fog hover:border-fog/40 hover:text-snow"
							}`}
						>
							{p === "all" ? "Semua Paket" : p}
						</button>
					))}
				</div>
			</div>

			{/* Users Table */}
			<div className="overflow-x-auto rounded-xl border border-graphite bg-charcoal shadow-[var(--shadow-inset)]">
				<table className="w-full text-left text-xs font-inter">
					<thead>
						<tr className="border-b border-graphite bg-obsidian text-fog">
							<th className="px-4 py-3.5 font-[510]">Pengguna</th>
							<th className="px-4 py-3.5 font-[510]">Paket</th>
							<th className="px-4 py-3.5 font-[510]">Kredit</th>
							<th className="px-4 py-3.5 font-[510]">Hak Akses</th>
							<th className="px-4 py-3.5 font-[510]">Status</th>
							<th className="px-4 py-3.5 font-[510] text-right">Aksi</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-graphite">
						{filteredRows.length === 0 ? (
							<tr>
								<td colSpan={6} className="py-12 text-center text-fog">
									Tidak ada pengguna yang ditemukan.
								</td>
							</tr>
						) : (
							filteredRows.map(({ user, sub }) => {
								const plan = sub?.plan ?? "free";
								const isBanned = Boolean(user.bannedAt);
								const isAdmin = Boolean(user.isAdmin);
								const isSelf = user.id === currentUserId;
								const initial = (user.name ||
									user.email ||
									"?")[0].toUpperCase();

								return (
									<tr
										key={user.id}
										className="transition-colors hover:bg-white/[0.02]"
									>
										{/* User info */}
										<td className="px-4 py-3">
											<div className="flex items-center gap-3">
												<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-obsidian border border-graphite text-xs font-semibold text-mist">
													{initial}
												</div>
												<div className="min-w-0">
													<p className="truncate font-[510] text-snow">
														{isStreamerMode
															? maskName(user.name)
															: user.name || "Tanpa Nama"}
													</p>
													<p className="truncate text-fog text-[11px]">
														{isStreamerMode
															? maskEmail(user.email)
															: user.email}
													</p>
												</div>
											</div>
										</td>

										{/* Plan Badge */}
										<td className="px-4 py-3">
											<span
												className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
													plan === "hengker"
														? "bg-amber-400/10 text-amber-300 border border-amber-400/20"
														: plan === "pro"
															? "bg-indigo-400/10 text-indigo-300 border border-indigo-400/20"
															: "bg-white/5 text-fog border border-graphite"
												}`}
											>
												{plan}
											</span>
										</td>

										{/* Credits */}
										<td className="px-4 py-3 text-fog">
											<span className="text-snow font-medium">
												{sub?.creditsUsed ?? 0}
											</span>
											<span className="text-[11px]">
												{" "}
												/ {sub?.credits ?? 0}
											</span>
										</td>

										{/* Role */}
										<td className="px-4 py-3">
											{isAdmin ? (
												<span className="inline-flex items-center gap-1 text-[11px] font-[510] text-indigo-300">
													<Shield size={12} />
													Admin
												</span>
											) : (
												<span className="text-fog text-[11px]">Member</span>
											)}
										</td>

										{/* Status */}
										<td className="px-4 py-3">
											{isBanned ? (
												<span className="inline-flex items-center gap-1 rounded bg-rose-500/10 px-2 py-0.5 text-[10px] font-[510] text-rose-300 border border-rose-500/20">
													<Ban size={10} />
													Banned
												</span>
											) : (
												<span className="inline-flex items-center rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-[510] text-emerald-400 border border-emerald-500/20">
													Aktif
												</span>
											)}
										</td>

										{/* Actions */}
										<td className="px-4 py-3 text-right">
											<div className="flex items-center justify-end gap-1.5">
												{/* Plan switches */}
												{plan !== "pro" && (
													<button
														type="button"
														disabled={isMutating}
														onClick={() =>
															handleAction(`plan-pro-${user.id}`, () =>
																updateUserPlan({
																	data: { userId: user.id, plan: "pro" },
																}),
															)
														}
														className="rounded border border-graphite bg-obsidian px-2 py-1 text-[11px] text-fog hover:border-fog/40 hover:text-snow disabled:opacity-50"
														title="Ubah paket ke Pro"
													>
														Set Pro
													</button>
												)}

												{plan !== "hengker" && (
													<button
														type="button"
														disabled={isMutating}
														onClick={() =>
															handleAction(`plan-hengker-${user.id}`, () =>
																updateUserPlan({
																	data: { userId: user.id, plan: "hengker" },
																}),
															)
														}
														className="rounded border border-graphite bg-obsidian px-2 py-1 text-[11px] text-fog hover:border-fog/40 hover:text-snow disabled:opacity-50"
														title="Ubah paket ke Hengker"
													>
														Set Hengker
													</button>
												)}

												{/* Reset credit */}
												<button
													type="button"
													disabled={isMutating}
													onClick={() =>
														handleAction(`credit-${user.id}`, () =>
															resetUserCredit({ data: { userId: user.id } }),
														)
													}
													className="rounded border border-graphite bg-obsidian px-2 py-1 text-[11px] text-fog hover:border-fog/40 hover:text-snow disabled:opacity-50"
													title="Reset pemakaian kredit ke 0"
												>
													Reset Kredit
												</button>

												{/* Toggle Admin */}
												<button
													type="button"
													disabled={isMutating || (isSelf && isAdmin)}
													onClick={() =>
														handleAction(`admin-${user.id}`, () =>
															setUserAdmin({
																data: { userId: user.id, isAdmin: !isAdmin },
															}),
														)
													}
													className="rounded border border-graphite bg-obsidian px-2 py-1 text-[11px] text-fog hover:border-fog/40 hover:text-snow disabled:opacity-50"
													title={
														isSelf && isAdmin
															? "Tidak dapat mencabut hak admin akun sendiri"
															: isAdmin
																? "Cabut Admin"
																: "Jadikan Admin"
													}
												>
													{isAdmin ? "Cabut Admin" : "Jadikan Admin"}
												</button>

												{/* Ban / Unban */}
												<button
													type="button"
													disabled={isMutating || isSelf}
													onClick={() =>
														handleAction(`ban-${user.id}`, () =>
															setUserBanned({
																data: { userId: user.id, banned: !isBanned },
															}),
														)
													}
													className={`rounded border px-2 py-1 text-[11px] transition-colors disabled:opacity-50 ${
														isBanned
															? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
															: "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
													}`}
													title={
														isSelf
															? "Tidak dapat mem-ban akun sendiri"
															: isBanned
																? "Buka Ban"
																: "Ban"
													}
												>
													{isBanned ? "Buka Ban" : "Ban"}
												</button>
											</div>
										</td>
									</tr>
								);
							})
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}
