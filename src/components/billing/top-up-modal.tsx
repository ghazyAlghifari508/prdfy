"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertCircle, Coins, CreditCard, Loader2, X } from "lucide-react";
import * as React from "react";
import { useUserPlan } from "@/hooks/use-user-plan";
import { TOPUP_SKU } from "@/lib/constants";
import { cn, formatDate } from "@/lib/utils";

export interface TopUpModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function TopUpModal({ open, onOpenChange }: TopUpModalProps) {
	const { data: planData } = useUserPlan();
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	React.useEffect(() => {
		if (open) {
			setError(null);
		}
	}, [open]);

	const remainingCredits = planData?.remaining ?? planData?.credits ?? 0;
	const currentPeriodEnd = planData?.currentPeriodEnd;
	const formattedExpiry = currentPeriodEnd
		? formatDate(currentPeriodEnd)
		: null;

	const formattedPrice = TOPUP_SKU.priceIdr.toLocaleString("id-ID");
	const perCreditPrice = Math.round(
		TOPUP_SKU.priceIdr / TOPUP_SKU.credits,
	).toLocaleString("id-ID");

	const handleBuy = async () => {
		setLoading(true);
		setError(null);

		try {
			const res = await fetch("/api/payments/create", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ planId: TOPUP_SKU.id }),
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
						"fixed left-[50%] top-[50%] z-50 flex flex-col w-full max-w-md translate-x-[-50%] translate-y-[-50%] rounded-xl border border-graphite bg-obsidian text-snow shadow-xl duration-200 outline-none p-6",
						"data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
					)}
				>
					{/* Header */}
					<div className="flex items-start justify-between gap-4 pb-4 border-b border-graphite/60">
						<div className="flex items-center gap-3">
							<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-graphite bg-charcoal text-snow">
								<CreditCard size={18} aria-hidden />
							</div>
							<div>
								<DialogPrimitive.Title className="text-base font-semibold text-snow">
									Isi Ulang Kredit
								</DialogPrimitive.Title>
								<DialogPrimitive.Description className="mt-0.5 text-xs text-fog">
									Tambahkan kuota kredit instan untuk akun aktif kamu tanpa
									mengubah periode langganan.
								</DialogPrimitive.Description>
							</div>
						</div>
						<DialogPrimitive.Close
							className="rounded-md p-1.5 text-fog transition-colors hover:bg-white/5 hover:text-snow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
							aria-label="Tutup modal"
						>
							<X size={18} />
						</DialogPrimitive.Close>
					</div>

					{/* Current Balance Status */}
					<div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs">
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
							<div className="mt-1.5 flex items-center justify-between border-t border-white/5 pt-1.5 text-mist">
								<span>Periode Berjalan:</span>
								<span>Berakhir pada {formattedExpiry}</span>
							</div>
						)}
					</div>

					{/* Package Details Card */}
					<div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
						<div className="flex items-baseline justify-between">
							<span className="text-sm font-semibold text-snow">
								{TOPUP_SKU.credits} Kredit PRDFY
							</span>
							<div className="text-right">
								<span className="font-mono text-base font-semibold text-snow">
									Rp {formattedPrice}
								</span>
								<span className="ml-1 text-[11px] text-fog">
									(Rp {perCreditPrice} / kredit)
								</span>
							</div>
						</div>
						<p className="mt-2 text-xs leading-relaxed text-fog">
							Kredit bersifat aditif (ditambahkan ke saldo berjalan), tidak
							memperpanjang masa aktif, dan hangus bersama di akhir periode
							langganan.
						</p>
					</div>

					{/* Error Alert Banner */}
					{error && (
						<div
							role="alert"
							className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400"
						>
							<AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden />
							<span className="leading-relaxed">{error}</span>
						</div>
					)}

					{/* Actions */}
					<div className="mt-6 flex flex-col gap-2">
						<button
							type="button"
							disabled={loading}
							onClick={handleBuy}
							aria-label={`Beli ${TOPUP_SKU.credits} Kredit — Rp ${formattedPrice}`}
							className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-snow px-4 py-2.5 text-sm font-medium text-obsidian transition-colors hover:bg-snow/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{loading ? (
								<>
									<Loader2 size={16} className="animate-spin" aria-hidden />
									<span>Memproses...</span>
								</>
							) : (
								<span>Beli Sekarang</span>
							)}
						</button>
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
