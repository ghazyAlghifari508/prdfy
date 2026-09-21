import type { HistoryItem } from "@/routes/history";
export function filterHistory(
	items: HistoryItem[],
	query: string,
	stepFilter: string | null,
): HistoryItem[] {
	let r = items;
	// Normalize once and search with the trimmed value: leading/trailing
	// whitespace must not become part of the search term.
	const q = query.trim().toLowerCase();
	if (q) {
		r = r.filter(
			(i) =>
				i.name.toLowerCase().includes(q) ||
				(i.preview ?? "").toLowerCase().includes(q),
		);
	}
	if (stepFilter) r = r.filter((i) => (i.step ?? "prd") === stepFilter);
	return r;
}
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
	// Normalize invalid pagination into the first page of a sane size:
	// zero/negative/fractional inputs must not produce wrong-end slices.
	const safePage =
		Number.isSafeInteger(page) && page > 0 ? page : 1;
	const safeSize =
		Number.isSafeInteger(pageSize) && pageSize > 0
			? Math.min(pageSize, 100)
			: 10;
	const start = (safePage - 1) * safeSize;
	return items.slice(start, start + safeSize);
}
