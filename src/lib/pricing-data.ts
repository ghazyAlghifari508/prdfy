export interface Feature {
	key: string;
	name: string;
	isIncluded: boolean;
	tooltip?: string;
}

export interface PriceTier {
	id: "free" | "pro" | "hengker";
	name: string;
	description: string;
	/** Monthly price in IDR. Credits reset every BILLING_PERIOD_DAYS. */
	price: number;
	credits: number;
	isPopular: boolean;
	buttonLabel: string;
	features: Feature[];
}

/**
 * Shared row order so the comparison table lines up across tiers.
 * Reflects the current feature set in src/types/database.ts (FEATURES).
 * Model selection was removed — PrdFy uses a single 9Router combo
 * (src/lib/model-config.ts) with no user-facing picker.
 */
const FEATURE_ROWS = [
	// "setiap 30 hari", not "tiap bulan": billing periods are 30-day windows
	// from purchase (addDays), not calendar months.
	{ key: "monthly-reset", name: "Kredit reset setiap 30 hari" },
	{ key: "prd", name: "Generate PRD" },
	{ key: "revisi", name: "Revisi tanpa batas" },
	{ key: "export-md", name: "Export ke Markdown" },
	{ key: "workflow", name: "Full workflow (AC + Task + Kanban)" },
	{ key: "share", name: "Bagikan PRD (Share Link)" },
	{ key: "version-30", name: "Riwayat 30 versi" },
	{ key: "version-unlimited", name: "Riwayat versi tak terbatas" },
	{ key: "priority", name: "Antrean prioritas" },
] as const;

function buildFeatures(included: readonly string[]): Feature[] {
	return FEATURE_ROWS.map((row) => ({
		key: row.key,
		name: row.name,
		isIncluded: included.includes(row.key),
	}));
}

export const prdFyPlans: [PriceTier, PriceTier, PriceTier] = [
	{
		id: "free",
		name: "Free",
		description: "2 kredit PRD per bulan. Gratis selamanya.",
		price: 0,
		credits: 2,
		isPopular: false,
		buttonLabel: "Mulai Gratis",
		features: buildFeatures(["monthly-reset", "prd", "revisi", "export-md"]),
	},
	{
		id: "pro",
		name: "Pro",
		description: "30 kredit/bulan, full workflow dari PRD sampai Kanban.",
		price: 49000,
		credits: 30,
		isPopular: true,
		buttonLabel: "Berlangganan Pro",
		features: buildFeatures([
			"monthly-reset",
			"prd",
			"revisi",
			"export-md",
			"workflow",
			"share",
			"version-30",
		]),
	},
	{
		id: "hengker",
		name: "Hengker",
		// No "model premium" claim: all tiers share the single 9Router
		// combo with no user-facing picker, so Hengker must not promise a
		// different model.
		description: "105 kredit/bulan dan antrean prioritas.",
		price: 149000,
		credits: 105,
		isPopular: false,
		buttonLabel: "Berlangganan Hengker",
		features: buildFeatures(FEATURE_ROWS.map((row) => row.key)),
	},
];
