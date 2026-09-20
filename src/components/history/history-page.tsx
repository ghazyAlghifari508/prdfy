"use client";

import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowRight, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { DeleteProjectModal } from "@/components/prd/delete-project-modal";
import { useUserPlan } from "@/hooks/use-user-plan";
import { HISTORY_PAGE_SIZE } from "@/lib/constants";
import { resolveHistoryUrl } from "@/lib/flow-progress";
import { filterHistory, paginate } from "@/lib/history-filter";
import { saveSuppressAutoGen } from "@/lib/prompt-handoff";
import type { HistoryItem } from "@/routes/history";
import { useChatStore, useUIStore } from "@/store";

function isHaltedByCredits(item: HistoryItem): boolean {
	if (item.step === "ac" && item.acStatus === "pending") return true;
	if (item.step === "task" && item.taskStatus === "pending") return true;
	return false;
}

const STEP_BADGE: Record<string, { label: string; className: string }> = {
	question: { label: "Pertanyaan", className: "bg-indigo/15 text-indigo" },
	prd: { label: "PRD", className: "bg-emerald/15 text-emerald" },
	ac: { label: "AC", className: "bg-amber/15 text-amber" },
	task: { label: "Task", className: "bg-violet/15 text-violet" },
};

// ponytail: parse concrete history href like "/ask/<uuid>" into typed TanStack route.
// Link's `to` expects the pattern "/ask/$id" + params, not the concrete string.
// Using `to={href as never}` would bypass typing and do a full reload; this keeps SPA.
function parseHistoryHref(
	href: string,
):
	| { to: "/ask/$id"; params: { id: string } }
	| { to: "/prd/$id"; params: { id: string } }
	| { to: "/ac/$id"; params: { id: string } }
	| { to: "/task/$id"; params: { id: string } }
	| { to: "/kanban/$id"; params: { id: string } }
	| null {
	const m = href.match(/^\/(ask|prd|ac|task|kanban)\/([^/]+)$/);
	if (!m) return null;
	const [, seg, id] = m;
	if (seg === "ask") return { to: "/ask/$id", params: { id } };
	if (seg === "prd") return { to: "/prd/$id", params: { id } };
	if (seg === "ac") return { to: "/ac/$id", params: { id } };
	if (seg === "task") return { to: "/task/$id", params: { id } };
	if (seg === "kanban") return { to: "/kanban/$id", params: { id } };
	return null;
}

export function HistoryPage({ items }: { items: HistoryItem[] }) {
	// ponytail: shared TanStack Query hook — deduped across all components.
	const { refetch: refetchPlan } = useUserPlan();
	const router = useRouter();
	const navigate = useNavigate();
	const showToast = useUIStore((s) => s.showToast);
	const [localItems, setLocalItems] = useState<HistoryItem[]>(items);
	const [deleteId, setDeleteId] = useState<string | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const [query, setQuery] = useState("");
	const [stepFilter, setStepFilter] = useState<string | null>(null);
	const [page, setPage] = useState(1);
	const filtered = filterHistory(localItems, query, stepFilter);
	const totalPages = Math.max(
		1,
		Math.ceil(filtered.length / HISTORY_PAGE_SIZE),
	);
	const clampedPage = Math.min(page, totalPages);
	const paged = paginate(filtered, clampedPage, HISTORY_PAGE_SIZE);

	useEffect(() => {
		setLocalItems(items);
	}, [items]);

	useEffect(() => {
		setPage(1);
	}, [query, stepFilter]);

	useEffect(() => {
		if (page > totalPages) setPage(totalPages);
	}, [page, totalPages]);

	const openDelete = (id: string) => setDeleteId(id);
	const closeDelete = () => setDeleteId(null);

	const confirmDelete = async () => {
		if (!deleteId) return;
		setIsDeleting(true);
		// Optimistic: drop card now so UI feels instant. Restore on failure.
		const snapshot = localItems;
		setLocalItems((prev) => prev.filter((i) => i.id !== deleteId));
		try {
			const res = await fetch(`/api/projects/${deleteId}`, {
				method: "DELETE",
			});
			// ponytail: 404 = row already gone (idempotent delete). Treat as success
			// so stale History cards (e.g. cross-tab delete) disappear cleanly.
			if (!res.ok && res.status !== 404)
				throw new Error("Gagal menghapus proyek");
			showToast("Proyek dihapus.", "success");
			closeDelete();
			// Sync with server state (catches any drift, e.g. step changes).
			router.invalidate();
		} catch (err) {
			console.error("Delete project failed:", err);
			setLocalItems(snapshot);
			showToast("Gagal menghapus proyek. Coba lagi.", "error");
		} finally {
			setIsDeleting(false);
		}
	};

	if (localItems.length === 0) {
		return (
			<main className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center bg-onyx px-6">
				<h1 className="font-inter text-2xl font-[510] text-snow">
					Riwayat Proyek
				</h1>
				<p className="mt-2 font-inter text-sm text-fog">
					Belum ada proyek. Mulai dari Home untuk membuat PRD pertama Anda.
				</p>
				<button
					type="button"
					onClick={() => navigate({ to: "/" })}
					className="btn-primary mt-6 rounded-md px-5 py-2.5 font-inter text-sm font-[510]"
				>
					Buat Proyek
				</button>
			</main>
		);
	}

	return (
		<main className="min-h-[calc(100vh-3.5rem)] bg-onyx px-6 py-10">
			<div className="mx-auto max-w-4xl">
				<header className="mb-8">
					<h1 className="font-inter text-2xl font-[510] text-snow">
						Riwayat Proyek
					</h1>
					<p className="mt-1 font-inter text-sm text-fog">
						Lanjutkan dari titik terakhir Anda tinggalkan.
					</p>
				</header>

				<div className="mb-6 flex flex-col gap-4">
					<div className="relative">
						<Search
							size={16}
							className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fog"
							aria-hidden
						/>
						<input
							type="text"
							placeholder="Cari proyek..."
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							className="w-full rounded-lg border border-graphite bg-charcoal py-2.5 pl-10 pr-4 font-inter text-sm text-snow placeholder:text-fog/60 focus:border-fog/40 focus:outline-none"
						/>
					</div>
					<div className="flex flex-wrap gap-2">
						{(
							[
								{ id: null, label: "Semua" },
								{ id: "prd", label: "PRD" },
								{ id: "ac", label: "AC" },
								{ id: "task", label: "Task" },
							] as const
						).map((chip) => {
							const active = stepFilter === chip.id;
							return (
								<button
									key={chip.label}
									type="button"
									onClick={() => setStepFilter(chip.id)}
									className={`rounded-full px-3 py-1.5 font-inter text-xs font-[510] transition-colors ${
										active
											? "bg-snow text-onyx"
											: "border border-graphite bg-charcoal text-fog hover:border-fog/40 hover:text-snow"
									}`}
								>
									{chip.label}
								</button>
							);
						})}
					</div>
				</div>

				{filtered.length === 0 ? (
					<p className="py-12 text-center font-inter text-sm text-fog">
						Tidak ada proyek yang cocok dengan pencarian Anda.
					</p>
				) : (
					<ul className="space-y-3">
						{paged.map((item) => {
							const badge = STEP_BADGE[item.step ?? "prd"] ?? STEP_BADGE.prd;
							const href = resolveHistoryUrl(item);
							const halted = isHaltedByCredits(item);
							const link = parseHistoryHref(href);

							const handleClick = async (e: React.MouseEvent) => {
								if (!halted) return;
								e.preventDefault();
								saveSuppressAutoGen(item.id);

								try {
									// ponytail: use refetchPlan() from shared TanStack Query hook
									// instead of raw fetch("/api/user/plan"). Deduped across components.
									const freshPlan = await refetchPlan();
									const remaining = freshPlan.data?.remaining;
									if (
										remaining === 0 ||
										(remaining !== "unlimited" && Number(remaining ?? 0) <= 0)
									) {
										const stage = item.step === "task" ? "task" : "ac";
										useChatStore.getState().setCreditsExhausted({
											stage,
											message:
												"Kredit kamu sudah habis. Beli kredit untuk melanjutkan.",
										});
									}
								} catch {
									// proceed anyway; landing page will handle
								}

								// SPA navigation via TanStack Router; preserve resolveHistoryUrl logic
								if (link) navigate(link);
								else window.location.href = href;
							};

							// ponytail: SPA via Link keeps navigation inside TanStack Router; fallback <a> only for unparseable href (should never happen).
							const cardInner = (
								<>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<h2 className="truncate font-inter text-base font-[510] text-snow">
												{item.name}
											</h2>
											<span
												className={`rounded-full px-2 py-0.5 font-inter text-[11px] font-[510] ${badge.className}`}
											>
												{badge.label}
											</span>
											{halted && (
												<span className="rounded-full px-2 py-0.5 font-inter text-[11px] font-[510] bg-crimson/15 text-crimson">
													Terhenti
												</span>
											)}
										</div>
										{item.preview && (
											<p className="mt-1 line-clamp-2 font-inter text-xs text-fog">
												{item.preview}
											</p>
										)}
										<p className="mt-1.5 font-inter text-[11px] text-slate">
											Diperbarui {formatDate(item.updatedAt)}
										</p>
									</div>

								<ArrowRight
									size={16}
									className="shrink-0 text-fog opacity-0 transition-opacity group-hover:opacity-100"
									aria-hidden
								/>
							</>
						);

						return (
							<li
								key={item.id}
								className="group flex items-center gap-4 rounded-xl border border-graphite bg-charcoal/60 p-4 transition-colors hover:border-fog/40 hover:bg-charcoal"
							>
								{link ? (
									<Link
										to={link.to}
										params={link.params}
										onClick={handleClick}
										className="flex min-w-0 flex-1 items-center gap-4"
									>
										{cardInner}
									</Link>
								) : (
									<a
										href={href}
										onClick={handleClick}
										className="flex min-w-0 flex-1 items-center gap-4"
									>
										{cardInner}
									</a>
								)}
								<button
									type="button"
									onClick={() => openDelete(item.id)}
									className="shrink-0 rounded-md p-1.5 text-crimson transition-colors hover:bg-crimson/10"
									aria-label={`Hapus proyek ${item.name}`}
								>
									<Trash2 size={16} />
								</button>
							</li>
						);
						})}
					</ul>
				)}

				{filtered.length > HISTORY_PAGE_SIZE && (
					<div className="mt-6 flex items-center justify-between">
						<button
							type="button"
							onClick={() => setPage((p) => Math.max(1, p - 1))}
							disabled={clampedPage <= 1}
							className="rounded-md border border-graphite bg-charcoal px-4 py-2 font-inter text-sm text-snow transition-colors hover:border-fog/40 disabled:opacity-40 disabled:cursor-not-allowed"
						>
							Sebelumnya
						</button>
						<span className="font-inter text-sm text-fog">
							Halaman {clampedPage} dari {totalPages}
						</span>
						<button
							type="button"
							onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
							disabled={clampedPage >= totalPages}
							className="rounded-md border border-graphite bg-charcoal px-4 py-2 font-inter text-sm text-snow transition-colors hover:border-fog/40 disabled:opacity-40 disabled:cursor-not-allowed"
						>
							Selanjutnya
						</button>
					</div>
				)}
			</div>

			<DeleteProjectModal
				isOpen={deleteId !== null}
				onClose={closeDelete}
				onConfirm={confirmDelete}
				isDeleting={isDeleting}
			/>
		</main>
	);
}

// ponytail: locale formatter. Date comes as ISO/Date from server fn; guard both.
function formatDate(d: Date | string): string {
	const date = typeof d === "string" ? new Date(d) : d;
	return new Intl.DateTimeFormat("id-ID", {
		day: "numeric",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
}
