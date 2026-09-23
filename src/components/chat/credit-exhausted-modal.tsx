"use client";

import {
	AlertCircle,
	Check,
	Coins,
	CreditCard,
	Loader2,
	X,
} from "lucide-react";
import * as React from "react";
import { PricingComponent } from "@/components/ui/pricing-card";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useUserPlan } from "@/hooks/use-user-plan";
import { TOPUP_PACKAGES, type TopUpPackage } from "@/lib/constants";
import { prdFyPlans } from "@/lib/pricing-data";
import { saveResumeIntent } from "@/lib/prompt-handoff";
import { cn, formatDate } from "@/lib/utils";
import { useUIStore } from "@/store";

interface CreditExhaustedModalProps {
	isOpen: boolean;
	onClose: () => void;
	errorMessage: string;
	projectId: string;
	stage: "prd" | "ac" | "task";
	currentPlan?: string;
	// ponytail: plan-gate paywalls reuse this modal with a stage-specific title
	// ("Lanjut ke AC butuh Pro") instead of the credit-depletion default.
	title?: string;
	requiredCredits?: number;
	availableCredits?: number;
	quote?: {
		estimatedCredits?: number;
		maximumCredits?: number;
		pricingVersion?: string;
	};
}

export function CreditExhaustedModal({
	isOpen,
	onClose,
	errorMessage,
	projectId,
	stage,
	currentPlan = "free",
	title = "Kredit Habis",
	requiredCredits,
	availableCredits,
	quote,
}: CreditExhaustedModalProps) {
	// ponytail: shared TanStack Query hook — deduped across all components.
	// Previously raw fetch("/api/user/plan") in useEffect.
	const { data: planData } = useUserPlan();
	const plan = planData?.plan ?? currentPlan;
	const showToast = useUIStore((s) => s.showToast);
	const dialogRef = useFocusTrap<HTMLDivElement>({
		isOpen,
		onEscape: onClose,
	});

	const isPaidTopUp = Boolean(
		plan !== "free" &&
			planData?.topUpEligible &&
			!title.toLowerCase().includes("pro"),
	);
	const [view, setView] = React.useState<"topup" | "subscription">(() =>
		isPaidTopUp ? "topup" : "subscription",
	);
	const [selectedPackageId, setSelectedPackageId] = React.useState<string>(
		TOPUP_PACKAGES[0]?.id ?? "topup-15",
	);
	const [loading, setLoading] = React.useState(false);

	React.useEffect(() => {
		if (isOpen) {
			setView(isPaidTopUp ? "topup" : "subscription");
		}
	}, [isOpen, isPaidTopUp]);

	const selectedPackage =
		TOPUP_PACKAGES.find((p) => p.id === selectedPackageId) ?? TOPUP_PACKAGES[0];
	const remainingCredits =
		availableCredits ?? planData?.remaining ?? planData?.credits ?? 0;
	const currentPeriodEnd = planData?.currentPeriodEnd;
	const formattedExpiry = currentPeriodEnd
		? formatDate(currentPeriodEnd)
		: null;

	const handlePlanSelect = async (planId: string) => {
		if (planId === "free") return;
		setLoading(true);
		try {
			saveResumeIntent(projectId, stage);
			const returnUrl =
				typeof window !== "undefined"
					? `${window.location.pathname}${window.location.search}${window.location.hash}`
					: "/";
			const res = await fetch("/api/payments/create", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					planId,
					returnUrl,
					projectId,
				}),
			});
			const rawData: unknown = await res.json().catch(() => null);
			let apiError: string | undefined;
			let redirectUrl: string | undefined;

			if (typeof rawData === "object" && rawData !== null) {
				if ("error" in rawData && typeof rawData.error === "string") {
					apiError = rawData.error;
				}
				if (
					"redirect_url" in rawData &&
					typeof rawData.redirect_url === "string"
				) {
					redirectUrl = rawData.redirect_url;
				}
			}

			if (!res.ok) {
				if (res.status === 401) {
					window.location.href = `/login?redirect=${encodeURIComponent(returnUrl)}`;
				} else {
					showToast(apiError || "Gagal memproses pembayaran.", "error");
				}
				return;
			}
			if (redirectUrl) {
				window.location.href = redirectUrl;
			}
		} catch {
			showToast("Gagal menghubungi server.", "error");
		} finally {
			setLoading(false);
		}
	};

	if (!isOpen) return null;

	return (
		<div
			ref={dialogRef}
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-in fade-in duration-200 overflow-y-auto"
			role="dialog"
			aria-modal="true"
			aria-labelledby="credit-exhausted-modal-title"
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
		>
			<button
				type="button"
				className="fixed inset-0 cursor-default bg-transparent border-none p-0 w-full h-full"
				aria-label="Tutup modal"
				tabIndex={-1}
				onClick={onClose}
			/>
			<div
				className={cn(
					"relative z-10 w-full overflow-y-auto max-h-[85vh] rounded-xl bg-obsidian shadow-[var(--shadow-overlay)] animate-in zoom-in-95 duration-200 my-4",
					view === "topup" ? "max-w-xl" : "max-w-5xl",
				)}
			>
				{/* Header */}
				<div className="relative p-4 pb-0 text-center">
					<button
						type="button"
						onClick={onClose}
						className="absolute right-4 top-4 text-fog transition-colors hover:text-snow cursor-pointer"
						aria-label="Tutup"
					>
						<X size={20} />
					</button>
					<div
						className={cn(
							"mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full",
							view === "topup"
								? "bg-indigo/10 text-indigo"
								: "bg-crimson/10 text-crimson",
						)}
					>
						{view === "topup" ? (
							<CreditCard size={20} strokeWidth={2} />
						) : (
							<AlertCircle size={20} strokeWidth={2} />
						)}
					</div>
					<h3
						id="credit-exhausted-modal-title"
						className="font-inter text-xl font-[510] text-snow"
					>
						{view === "topup" ? "Isi Ulang Kredit Instan" : title}
					</h3>
					<p className="mt-2 font-inter text-sm text-fog">{errorMessage}</p>

					{(requiredCredits !== undefined || quote) && (
						<div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200 text-left mx-auto max-w-md">
							{requiredCredits !== undefined && (
								<div className="flex justify-between items-center py-0.5">
									<span className="text-fog">Kebutuhan Kredit:</span>
									<span className="font-semibold text-snow font-mono">
										{requiredCredits} kredit
									</span>
								</div>
							)}
							{availableCredits !== undefined && (
								<div className="flex justify-between items-center py-0.5">
									<span className="text-fog">Saldo Tersedia:</span>
									<span className="font-semibold text-snow font-mono">
										{availableCredits} kredit
									</span>
								</div>
							)}
							{quote && (
								<div className="mt-1 pt-1 border-t border-amber-500/20 flex justify-between items-center text-[11px] text-fog">
									<span>Estimasi: {quote.estimatedCredits ?? "-"} kredit</span>
									<span>Maksimum: {quote.maximumCredits ?? "-"} kredit</span>
								</div>
							)}
						</div>
					)}
				</div>

				{/* Content Body */}
				{view === "topup" ? (
					<div className="p-4 sm:p-6 space-y-4">
						{/* Current Balance Status */}
						<div className="rounded-lg border border-graphite/60 bg-charcoal/50 p-3 text-xs">
							<div className="flex items-center justify-between">
								<span className="flex items-center gap-1.5 text-fog">
									<Coins size={14} className="text-fog" aria-hidden />
									Saldo Kredit Saat Ini:
								</span>
								<span className="font-mono font-medium text-snow">
									{remainingCredits} kredit
								</span>
							</div>
							{formattedExpiry && (
								<div className="mt-1.5 flex items-center justify-between border-t border-graphite/40 pt-1.5 text-fog">
									<span>Periode Berjalan:</span>
									<span>Berakhir pada {formattedExpiry}</span>
								</div>
							)}
						</div>

						{/* Package Selector */}
						<div className="space-y-2.5">
							<p className="text-xs font-[510] text-fog uppercase tracking-wider">
								Pilihan Paket
							</p>
							<div className="max-h-[300px] overflow-y-auto space-y-2.5 pr-1">
								{TOPUP_PACKAGES.map((pkg: TopUpPackage) => {
									const isSelected = pkg.id === selectedPackage?.id;
									const priceStr = pkg.priceIdr.toLocaleString("id-ID");
									const perUnit = Math.round(
										pkg.priceIdr / pkg.credits,
									).toLocaleString("id-ID");

									return (
										<button
											key={pkg.id}
											type="button"
											onClick={() => setSelectedPackageId(pkg.id)}
											className={cn(
												"w-full text-left rounded-xl border p-3.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fog/40 cursor-pointer",
												isSelected
													? "border-snow bg-white/10 shadow-sm"
													: "border-graphite bg-charcoal/30 hover:border-fog/40 hover:bg-white/[0.03]",
											)}
										>
											<div className="flex items-start justify-between gap-3">
												<div className="flex items-center gap-2.5">
													<div
														className={cn(
															"flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
															isSelected
																? "border-snow bg-snow text-onyx"
																: "border-graphite bg-transparent",
														)}
													>
														{isSelected && <Check size={10} strokeWidth={3} />}
													</div>
													<div>
														<div className="flex items-center gap-2">
															<span className="text-sm font-semibold text-snow">
																{pkg.name} ({pkg.credits} Kredit)
															</span>
															{pkg.recommended && (
																<span className="rounded border border-fog/30 bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-snow">
																	Rekomendasi
																</span>
															)}
														</div>
														<p className="mt-0.5 text-xs text-fog leading-relaxed">
															{pkg.description}
														</p>
													</div>
												</div>
												<div className="text-right shrink-0">
													<div className="font-mono text-sm font-semibold text-snow">
														Rp {priceStr}
													</div>
													<div className="text-[11px] text-fog font-mono">
														Rp {perUnit}/kredit
													</div>
												</div>
											</div>
										</button>
									);
								})}
							</div>
						</div>

						{/* Upsell Banner to Subscription */}
						<button
							type="button"
							onClick={() => setView("subscription")}
							className="w-full text-left rounded-xl border border-graphite bg-charcoal/60 p-3.5 hover:border-fog/40 hover:bg-white/[0.03] transition flex items-center justify-between cursor-pointer"
						>
							<div>
								<span className="text-xs font-semibold text-snow">
									Mau kuota lebih banyak & fitur lengkap?
								</span>
								<p className="text-[11px] text-fog mt-0.5">
									Mulai Rp 49.000/bulan untuk 30 kredit, full AC, Task & Kanban.
								</p>
							</div>
							<span className="flex items-center gap-1 font-mono text-xs text-snow font-medium shrink-0 ml-2">
								{"Lihat Paket Langganan ->"}
							</span>
						</button>

						{/* Buy Action Button */}
						<button
							type="button"
							disabled={loading || !selectedPackage}
							onClick={() =>
								selectedPackage && handlePlanSelect(selectedPackage.id)
							}
							aria-label={`Beli ${selectedPackage?.credits ?? 0} Kredit — Rp ${selectedPackage ? selectedPackage.priceIdr.toLocaleString("id-ID") : 0}`}
							className="btn-primary flex h-10 w-full items-center justify-center gap-2 rounded-lg font-inter text-sm font-[510] transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-50 cursor-pointer"
						>
							{loading ? (
								<>
									<Loader2 size={16} className="animate-spin" aria-hidden />
									<span>Memproses Pembayaran...</span>
								</>
							) : (
								<span>
									Beli {selectedPackage?.credits} Kredit — Rp{" "}
									{selectedPackage?.priceIdr.toLocaleString("id-ID")}
								</span>
							)}
						</button>
					</div>
				) : (
					<div className="px-2 pb-3">
						{isPaidTopUp && (
							<div className="mb-2 px-2 pt-2">
								<button
									type="button"
									onClick={() => setView("topup")}
									className="inline-flex items-center gap-1.5 text-xs text-fog hover:text-snow transition-colors cursor-pointer"
								>
									{"<- Kembali ke Pilihan Top Up"}
								</button>
							</div>
						)}
						<PricingComponent
							plans={prdFyPlans}
							onPlanSelect={handlePlanSelect}
							currentPlan="free"
							creditsExhausted={planData?.creditsExhausted === true}
							showComparison={false}
							showHeader={false}
							compact
							className="!py-3 md:!py-3"
						/>
					</div>
				)}
			</div>
		</div>
	);
}
