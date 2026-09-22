import { APP_TIME_ZONE } from "@/lib/constants";

export function cn(
	...classes: (string | boolean | undefined | null)[]
): string {
	return classes.filter(Boolean).join(" ");
}

/**
 * Calendar date in the product timezone. Instants are rendered in
 * `APP_TIME_ZONE` rather than the host/browser zone so a payment made late in
 * the Jakarta evening never displays as the following day (or vice versa).
 */
export function formatDate(date: string | Date): string {
	const d = date instanceof Date ? date : new Date(date);
	// Invalid inputs must not render a user-visible "Invalid Date" string.
	if (!Number.isFinite(d.getTime())) return "—";
	return d.toLocaleDateString("id-ID", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: APP_TIME_ZONE,
	});
}

/** Date plus local time of day, both in the product timezone. */
export function formatDateTime(date: string | Date): string {
	const d = date instanceof Date ? date : new Date(date);
	if (!Number.isFinite(d.getTime())) return "—";
	const day = d.toLocaleDateString("id-ID", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: APP_TIME_ZONE,
	});
	const time = d.toLocaleTimeString("id-ID", {
		hour: "2-digit",
		minute: "2-digit",
		timeZone: APP_TIME_ZONE,
	});
	return `${day}, ${time}`;
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
