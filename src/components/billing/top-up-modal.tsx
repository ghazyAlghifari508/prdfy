"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
	AlertCircle,
	Check,
	Coins,
	CreditCard,
	Loader2,
	X,
} from "lucide-react";
import * as React from "react";
import { useUserPlan } from "@/hooks/use-user-plan";
import { TOPUP_PACKAGES, type TopUpPackage } from "@/lib/constants";
import { cn, formatDate } from "@/lib/utils";

export interface TopUpModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function TopUpModal({ open, onOpenChange }: TopUpModalProps) {
	const { data: planData } = useUserPlan();
	const [selectedPackageId, setSelectedPackageId] = React.useState<string>(
		TOPUP_PACKAGES[0]?.id ?? "topup-15",
	);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	React.useEffect(() => {
		if (open) {
			setError(null);
		}
	}, [open]);

	const selectedPackage =
		TOPUP_PACKAGES.find((p) => p.id === selectedPackageId) ?? TOPUP_PACKAGES[0];

	const remainingCredits = planData?.remaining ?? planData?.credits ?? 0;
	const currentPeriodEnd = planData?.currentPeriodEnd;
	const formattedExpiry = currentPeriodEnd
		? formatDate(currentPeriodEnd)
		: null;

	const handleBuy = async () => {
		if (!selectedPackage) return;
		setLoading(true);
		setError(null);

		try {
			const res = await fetch("/api/payments/create", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ planId: selectedPackage.id }),
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
					window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
					return;
				}
				setError(
					apiError || "Gagal membuat transaksi pembayaran. Silakan coba lagi.",
				);
				return;
			}

			if (redirectUrl) {
				window.location.href = redirectUrl;
				return;
			}

			setError(
				"Respon pembayaran tidak valid dari server. Silakan hubungi dukungan.",
			);
		} catch {
			setError("Gagal menghubungi server. Periksa koneksi internet Anda.");
		} finally {
			setLoading(false);
		}
	};

	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/75 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
				<DialogPrimitive.Content
					className={cn(
						"fixed left-[50%] top-[50%] z-50 flex flex-col w-full max-w-lg max-h-[85vh] translate-x-[-50%] translate-y-[-50%] rounded-xl border border-graphite bg-obsidian text-snow shadow-xl duration-200 outline-none p-6",
						"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
					)}
				>
					{/* Header */}
					<div className="flex items-start justify-between gap-4 pb-4 border-b border-graphite/60 shrink-0">
						<div className="flex items-center gap-3">
							<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-graphite bg-charcoal text-snow">
								<CreditCard size={18} aria-hidden />
							</div>
							<div>
								<DialogPrimitive.Title className="text-base font-semibold text-snow">
									Isi Ulang Kredit
								</DialogPrimitive.Title>
								<DialogPrimitive.Description className="mt-0.5 text-xs text-fog">
									Pilih paket kredit instan untuk akun aktif kamu tanpa mengubah
									periode langganan.
								</DialogPrimitive.Description>
							</div>
						</div>
						<DialogPrimitive.Close
							className="rounded-md p-1.5 text-fog transition-colors hover:bg-white/5 hover:text-snow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fog/40"
							aria-label="Tutup modal"
						>
							<X size={18} />
						</DialogPrimitive.Close>
					</div>

					{/* Current Balance Status */}
					<div className="mt-4 rounded-lg border border-graphite/60 bg-charcoal/50 p-3 text-xs shrink-0">
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

					{/* Scrollable Package List Container */}
					<div className="mt-4 flex-1 overflow-y-auto space-y-2.5 pr-1">
						<p className="text-xs font-[510] text-fog uppercase tracking-wider mb-2">
							Pilihan Paket
						</p>
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
										"w-full text-left rounded-xl border p-4 transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fog/40",
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
														<span className="rounded border border-fog/30 bg-white/10 px-1.5 py-0.2 text-[10px] font-medium text-snow">
															Rekomendasi
														</span>
													)}
												</div>
												<p className="mt-1 text-xs text-fog leading-relaxed">
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

					<p className="mt-3 text-[11px] leading-relaxed text-fog border-t border-graphite/40 pt-3 shrink-0">
						Kredit bersifat aditif (ditambahkan ke saldo berjalan), tidak
						memperpanjang masa aktif, dan hangus bersama di akhir periode
						langganan.
					</p>

					{/* Error Alert Banner */}
					{error && (
						<div
							role="alert"
							className="mt-3 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400 shrink-0"
						>
							<AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden />
							<span className="leading-relaxed">{error}</span>
						</div>
					)}

					{/* Actions */}
					<div className="mt-4 flex flex-col gap-2 shrink-0">
						<button
							type="button"
							disabled={loading || !selectedPackage}
							onClick={handleBuy}
							aria-label={`Beli ${selectedPackage?.credits ?? 0} Kredit — Rp ${selectedPackage ? selectedPackage.priceIdr.toLocaleString("id-ID") : 0}`}
							className="btn-primary flex h-10 w-full items-center justify-center gap-2 rounded-lg font-inter text-sm font-[510] transition-all hover:brightness-105 active:scale-[0.99] disabled:opacity-50"
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
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
