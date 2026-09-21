export function cn(
	...classes: (string | boolean | undefined | null)[]
): string {
	return classes.filter(Boolean).join(" ");
}

export function formatDate(date: string | Date): string {
	const d = date instanceof Date ? date : new Date(date);
	// Invalid inputs must not render a user-visible "Invalid Date" string.
	if (!Number.isFinite(d.getTime())) return "—";
	return d.toLocaleDateString("id-ID", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

export function formatCurrency(amount: number): string {
	// Non-finite amounts must never leak NaN/Infinity into money UI.
	if (!Number.isFinite(amount)) return "Rp0";
	return new Intl.NumberFormat("id-ID", {
		style: "currency",
		currency: "IDR",
		minimumFractionDigits: 0,
		maximumFractionDigits: 0,
	}).format(amount);
}

// ponytail: generateShareToken moved to prd-service.ts - used node:crypto which
// crashes browser bundles when utils.ts (shared by all client components via cn)
// is imported. Keep crypto server-side only.
