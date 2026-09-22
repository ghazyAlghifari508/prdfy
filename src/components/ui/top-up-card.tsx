"use client";

import { CreditCard } from "lucide-react";
import * as React from "react";
import { TOPUP_SKU } from "@/lib/constants";
import { useUIStore } from "@/store";

/**
 * Mid-period credit top-up card (spec §7). Parents decide visibility from
 * useUserPlan().topUpEligible; this component assumes it should render. Dark
 * tokens (snow/fog/white-alpha) match BOTH mounting surfaces: /pricing
 * (bg-onyx) and the credit-exhausted modal (bg-obsidian).
 *
 * Credits are additive: the plan, status, and any running period are left
 * untouched, so buying never extends or resets the subscription.
 */
export function TopUpCard({ className }: { className?: string }) {
	const showToast = useUIStore((s) => s.showToast);
	const [loading, setLoading] = React.useState(false);

	const handleBuy = async () => {
		setLoading(true);
		try {
			const res = await fetch("/api/payments/create", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ planId: TOPUP_SKU.id }),
			});
			const data = (await res.json()) as {
				error?: string;
				redirect_url?: string;
			};
			if (!res.ok) {
				if (res.status === 401) {
					window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
					return;
				}
				showToast(data.error || "Gagal memproses pembayaran.", "error");
				return;
			}
			if (data.redirect_url) {
				window.location.href = data.redirect_url;
			}
		} catch {
			showToast("Gagal menghubungi server.", "error");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div
			id="topup"
			className={`scroll-mt-24 rounded-xl border border-white/10 bg-white/5 p-5 ${className ?? ""}`}
		>
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div>
					<h3 className="flex items-center gap-2 font-inter text-base font-[510] text-snow">
						<CreditCard size={16} aria-hidden />
						Top Up Kredit
					</h3>
					<p className="mt-1 text-sm text-fog">
						{TOPUP_SKU.credits} kredit · Rp{" "}
						{TOPUP_SKU.priceIdr.toLocaleString("id-ID")}
					</p>
					<p className="mt-1 text-xs text-fog">
						Tanpa menambah masa aktif · sisa kredit ikut hangus di akhir periode
						berjalan
					</p>
				</div>
				<button
					type="button"
					disabled={loading}
					onClick={handleBuy}
					className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-snow transition-colors hover:bg-white/20 disabled:opacity-50"
				>
					{loading ? "Memproses..." : "Top Up Sekarang"}
				</button>
			</div>
		</div>
	);
}
