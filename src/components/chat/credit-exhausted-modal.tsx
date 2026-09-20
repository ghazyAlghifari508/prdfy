"use client";

import { AlertCircle, X } from "lucide-react";
import { PricingComponent } from "@/components/ui/pricing-card";
import { TopUpCard } from "@/components/ui/top-up-card";
import { useUserPlan } from "@/hooks/use-user-plan";
import { type PriceTier, prdFyPlans } from "@/lib/pricing-data";
import { saveResumeIntent } from "@/lib/prompt-handoff";
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

	const handlePlanSelect = async (planId: string) => {
		if (planId === "free") return;
		try {
			saveResumeIntent(projectId, stage);
			const res = await fetch("/api/payments/create", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					planId,
					returnUrl: window.location.pathname,
					projectId,
				}),
			});
			const data = await res.json();
			if (!res.ok) {
				if (res.status === 401) {
					window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
				} else {
					showToast(data.error || "Gagal memproses pembayaran.", "error");
				}
				return;
			}
			if (data.redirect_url) {
				window.location.href = data.redirect_url;
			}
		} catch {
			showToast("Gagal menghubungi server.", "error");
		}
	};

	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-in fade-in duration-200 overflow-y-auto"
			role="dialog"
			aria-modal="true"
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
			<div className="relative z-10 w-full max-w-5xl overflow-y-auto max-h-[80vh] rounded-xl bg-obsidian shadow-[var(--shadow-overlay)] animate-in zoom-in-95 duration-200 my-4">
				{/* Header */}
				<div className="relative p-4 pb-0 text-center">
					<button
						type="button"
						onClick={onClose}
						className="absolute right-4 top-4 text-fog transition-colors hover:text-snow"
						aria-label="Tutup"
					>
						<X size={20} />
					</button>
					<div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-crimson/10 text-crimson">
						<AlertCircle size={20} strokeWidth={2} />
					</div>
					<h3 className="font-inter text-xl font-[510] text-snow">{title}</h3>
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

				{/* Embedded pricing cards */}
				<div className="px-2 pb-3">
					{/* Credits gone but period still running = ideal top-up case
					    (spec §7). Paused users get the renewal cards instead. */}
					{planData?.subscriptionState === "active_paid" && (
						<TopUpCard className="mx-2 mb-2" />
					)}
					<PricingComponent
						plans={prdFyPlans as [PriceTier, PriceTier, PriceTier]}
						onPlanSelect={handlePlanSelect}
						currentPlan={plan}
						showComparison={false}
						showHeader={false}
						compact
						className="!py-3 md:!py-3"
					/>
				</div>
			</div>
		</div>
	);
}
