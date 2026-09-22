"use client";

import { useLocation, useNavigate } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import * as React from "react";
import { syncPaymentStatus } from "@/app/actions/payment";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { TopUpCard } from "@/components/ui/top-up-card";
import { useUserPlan } from "@/hooks/use-user-plan";
import { TOPUP_SKU } from "@/lib/constants";
import { type Feature, type PriceTier, prdFyPlans } from "@/lib/pricing-data";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store";

// --- Utility Components ---

const FeatureItem: React.FC<{ feature: Feature }> = ({ feature }) => {
	const Icon = feature.isIncluded ? Check : X;
	const iconColor = feature.isIncluded ? "text-mist" : "text-slate/60";

	return (
		<li className="flex items-start space-x-3 py-2">
			<Icon
				className={cn("h-4 w-4 flex-shrink-0 mt-0.5", iconColor)}
				aria-hidden="true"
			/>
			<span
				className={cn(
					"font-inter text-sm",
					feature.isIncluded ? "text-mist" : "text-slate",
				)}
			>
				{feature.name}
			</span>
		</li>
	);
};

// --- Main Pricing Cards ---

interface PricingComponentProps extends React.HTMLAttributes<HTMLDivElement> {
	plans: [PriceTier, PriceTier, PriceTier];
	onPlanSelect: (planId: string) => void;
	currentPlan?: string;
	showComparison?: boolean;
	/** Smaller header + spacing for modal embedding */
	compact?: boolean;
	/** Hide the "Pilih Paket yang Sesuai" header (modal embedding) */
	showHeader?: boolean;
	/**
	 * Paid plan whose allowance is spent. Renewing the same tier would reset the
	 * running period, so those cards point at the top-up card instead.
	 */
	creditsExhausted?: boolean;
}

export const PricingComponent: React.FC<PricingComponentProps> = ({
	plans,
	onPlanSelect,
	currentPlan = "free",
	showComparison = true,
	compact = false,
	showHeader = true,
	creditsExhausted = false,
	className,
	...props
}) => {
	if (plans.length !== 3) {
		console.error("PricingComponent requires exactly 3 pricing tiers.");
		return null;
	}

	const allFeatures = plans[0].features.map((f) => f.name);

	const formatIdr = (num: number) => num.toLocaleString("id-ID");

	const PricingCards = (
		<div className="grid gap-6 md:grid-cols-3">
			{plans.map((plan) => {
				const isFeatured = plan.isPopular;

				return (
					<Card
						key={plan.id}
						className={cn(
							"flex flex-col transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-1",
							isFeatured &&
								"border border-indigo/40 shadow-[inset_0_0_0_1px_rgba(94,106,210,0.8),var(--shadow-linear-xl)] md:scale-[1.02]",
						)}
					>
						<CardHeader className="p-6 pb-4 relative">
							{isFeatured && (
								<div className="absolute left-0 top-0 h-1 w-full rounded-t-xl bg-indigo"></div>
							)}
							<div className="flex justify-between items-start mt-2">
								<CardTitle className="text-2xl font-normal">
									{plan.name}
								</CardTitle>
								{isFeatured && (
									<span className="rounded-[2px] bg-indigo/20 px-3 py-1 font-inter text-xs font-[510] text-mist shadow-[inset_0_0_0_1px_rgba(94,106,210,0.45)]">
										Paling Laris
									</span>
								)}
							</div>
							<CardDescription className="text-sm mt-1">
								{plan.description}
							</CardDescription>
							<div className="mt-4 font-inter">
								<p className="text-4xl font-light text-snow">
									{plan.price === 0 ? "Gratis" : `Rp ${formatIdr(plan.price)}`}
								</p>
								{plan.credits > 0 && (
									<p className="mt-1 text-xs font-[510] text-fog">
										{plan.credits} kredit
										{plan.price > 0 ? " /bulan" : ""}
									</p>
								)}
							</div>
						</CardHeader>
						<CardContent className="flex-grow p-6 pt-0">
							<h4 className="mb-2 mt-4 font-inter text-sm font-[510] text-snow">
								Fitur Utama:
							</h4>
							<ul className="list-none space-y-0">
								{plan.features.slice(0, 5).map((feature) => (
									<FeatureItem key={feature.name} feature={feature} />
								))}
								{plan.features.length > 5 && (
									<li className="mt-2 font-inter text-sm text-fog">
										+ {plan.features.length - 5} fitur lainnya
									</li>
								)}
							</ul>
						</CardContent>
						<CardFooter className="p-6 pt-0">
							{(() => {
								const isCurrentPlan = currentPlan === plan.id;
								const isFreeCard = plan.id === "free";

								// ponytail: credit model — all paid tiers always purchasable.
								// Free card disabled only if already on free (nothing to buy).
								let buttonLabel = plan.buttonLabel;
								// Checkout target: a plan tier, or the top-up SKU when the
								// current plan's allowance is spent (renewing would reset the
								// running period and forfeit the remaining days).
								let buttonTarget: PriceTier["id"] | typeof TOPUP_SKU.id =
									plan.id;
								const isDisabled = isFreeCard && isCurrentPlan;

								if (isCurrentPlan && !isFreeCard) {
									buttonLabel = `Beli Lagi ${plan.name}`;
								}

								if (creditsExhausted && isCurrentPlan && !isFreeCard) {
									buttonLabel = "Top Up Kredit";
									buttonTarget = TOPUP_SKU.id;
								}

								return (
									<Button
										onClick={() => !isDisabled && onPlanSelect(buttonTarget)}
										disabled={isDisabled}
										className={cn(
											"w-full font-inter font-[510] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
											isDisabled
												? "opacity-50 cursor-not-allowed"
												: "cursor-pointer",
											isFeatured && !isDisabled
												? "btn-primary hover:brightness-105"
												: !isDisabled
													? "border border-snow/70 bg-transparent text-snow hover:bg-white/5"
													: "bg-steel/30 text-slate",
										)}
										size="lg"
										aria-label={`Pilih paket ${plan.name}`}
									>
										{buttonLabel}
									</Button>
								);
							})()}
						</CardFooter>
					</Card>
				);
			})}
		</div>
	);

	const ComparisonTable = (
		<div className="mt-16 hidden overflow-x-auto rounded-xl bg-obsidian shadow-[var(--shadow-inset)] md:block">
			<table className="min-w-full divide-y divide-graphite">
				<thead>
					<tr className="bg-charcoal">
						<th
							scope="col"
							className="w-[200px] whitespace-nowrap px-6 py-4 text-left font-inter text-sm font-[510] text-snow"
						>
							Fitur Lengkap
						</th>
						{plans.map((plan) => (
							<th
								key={`th-${plan.id}`}
								scope="col"
								className={cn(
									"whitespace-nowrap px-6 py-4 text-center font-inter text-sm font-[510] text-snow",
									plan.isPopular && "bg-indigo/10",
								)}
							>
								{plan.name}
							</th>
						))}
					</tr>
				</thead>
				<tbody className="divide-y divide-graphite bg-obsidian font-inter">
					{allFeatures.map((featureName, index) => (
						<tr
							key={featureName}
							className={cn(
								"transition-colors hover:bg-white/5",
								index % 2 === 0 ? "bg-obsidian" : "bg-charcoal/60",
							)}
						>
							<td className="whitespace-nowrap px-6 py-3 text-left text-sm font-[510] text-mist">
								{featureName}
							</td>
							{plans.map((plan) => {
								const feature = plan.features.find(
									(f) => f.name === featureName,
								);
								const isIncluded = feature?.isIncluded ?? false;
								const Icon = isIncluded ? Check : X;
								const iconColor = isIncluded ? "text-mist" : "text-slate/60";

								return (
									<td
										key={`${plan.id}-${featureName}`}
										className={cn(
											"px-6 py-3 text-center transition-all duration-150",
											plan.isPopular && "bg-indigo/10",
										)}
									>
										<Icon
											className={cn("h-5 w-5 mx-auto", iconColor)}
											aria-hidden="true"
										/>
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);

	return (
		<div
			className={cn(
				"mx-auto w-full max-w-[1200px] px-4 py-12 sm:px-6 md:py-20 lg:px-8",
				className,
			)}
			{...props}
		>
			{showHeader && (
				<header className={cn("text-center", compact ? "mb-2" : "mb-10")}>
					<h2
						className={cn(
							"font-inter font-light leading-tight text-snow",
							compact
								? "text-xl"
								: "text-[40px] max-md:text-[36px] md:text-[48px]",
						)}
					>
						Pilih Paket yang Sesuai
					</h2>
					<p
						className={cn(
							"mx-auto max-w-2xl font-inter leading-relaxed text-fog",
							compact ? "mt-1 text-xs" : "mt-3 text-[17px]",
						)}
					>
						1 kredit = 1 tahap (PRD, AC, atau Task). Kredit tidak pernah hangus.
					</p>
				</header>
			)}

			<section aria-labelledby="pricing-plans">{PricingCards}</section>

			{showComparison && (
				<section aria-label="Feature Comparison Table" className="mt-16">
					<h3 className="mb-6 hidden text-center font-inter text-[48px] font-light leading-tight text-snow max-md:text-[36px] md:block">
						Perbandingan Fitur
					</h3>
					{ComparisonTable}
				</section>
			)}
		</div>
	);
};

// --- Wrapper with state ---

export default function PricingWrapper() {
	const navigate = useNavigate();
	const searchStr = useLocation({ select: (l) => l.searchStr });
	const searchParams = new URLSearchParams(searchStr);
	const showToast = useUIStore((state) => state.showToast);
	// ponytail: shared TanStack Query hook — deduped across all components.
	// Previously raw fetch("/api/user/plan") in useEffect.
	const { data: planData, refetch: refetchPlan } = useUserPlan();
	const currentPlan = planData?.plan ?? "free";

	// Sync payment status when redirected back from Midtrans
	React.useEffect(() => {
		const orderId = searchParams.get("order_id");
		const payment = searchParams.get("payment");
		const txStatus = searchParams.get("transaction_status");

		if (
			orderId &&
			(payment === "success" ||
				txStatus === "settlement" ||
				txStatus === "capture")
		) {
			const sync = async () => {
				try {
					const res = await syncPaymentStatus({ data: orderId });
					if (res.success && res.plan) {
						refetchPlan();
						showToast(
							`Berhasil beli kredit untuk paket ${res.plan.charAt(0).toUpperCase() + res.plan.slice(1)}!`,
							"success",
						);
						navigate({ to: "/pricing", replace: true });
					}
				} catch (e) {
					console.error("Gagal sinkronisasi pembayaran:", e);
				}
			};
			sync();
		}
	}, [searchParams, showToast, navigate, refetchPlan]);

	const handlePlanSelect = async (planId: string) => {
		if (planId === "free") {
			navigate({ to: "/" });
			return;
		}

		try {
			const res = await fetch("/api/payments/create", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ planId }),
			});
			const data = await res.json();

			if (!res.ok) {
				if (res.status === 401) {
					navigate({ to: "/login", search: { redirect: "/pricing" } });
				} else {
					showToast(
						data.error || "Terjadi kesalahan saat memproses pembayaran.",
						"error",
					);
				}
				return;
			}

			if (data.redirect_url) {
				window.location.href = data.redirect_url;
			}
		} catch (e: unknown) {
			console.error(e);
			showToast("Gagal menghubungi server.", "error");
		}
	};

	return (
		<>
			<PricingComponent
				plans={prdFyPlans}
				onPlanSelect={handlePlanSelect}
				currentPlan={currentPlan}
				creditsExhausted={planData?.creditsExhausted === true}
			/>
			{/* Mid-period top-up: visible to any paid plan that can still buy
			    credits (active period or legacy grandfathered). */}
			{planData?.topUpEligible && <TopUpCard className="mt-6" />}
		</>
	);
}
