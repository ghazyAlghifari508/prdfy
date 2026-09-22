/**
 * Authoritative Page / Screen inventory extraction.
 *
 * The PRD owns the product-surface map. It lives as a subsection of `User Flow`
 * (never a top-level section, so the revision protocol and the 8-section
 * completeness contract stay untouched):
 *
 *   ### 5.3 Pages & Screens
 *   #### Product List
 *   Tujuan: ...
 *
 * Task generation references those surfaces instead of inventing its own
 * inventory, so this module reads the page names back out of the PRD markdown.
 *
 * Scope of the guarantee: extraction is deterministic for documents that follow
 * the mandated format. A document without the subsection yields an empty
 * inventory — callers must treat that as "no authoritative inventory available"
 * and skip surface validation rather than inventing one.
 */

/** Heading of the inventory subsection, with or without its `5.3` numbering. */
const PAGES_HEADING_RE =
	/^#{3,4}\s*(?:\d+(?:\.\d+)*[.)]?\s*)?Pages\s*&\s*Screens\s*$/i;

/** A single surface entry. Level 4 keeps it inside the subsection. */
const PAGE_ENTRY_RE = /^####\s+(.+?)\s*$/;

/** Any heading that closes the inventory subsection. */
const SUBSECTION_END_RE = /^#{1,3}\s+/;

const MAX_PAGES = 200;
const MAX_PAGE_NAME_CHARS = 200;

/** Bound the scanned document so a pathological PRD cannot stall extraction. */
const MAX_SCAN_CHARS = 200_000;

function stripLeadingNumbering(text: string): string {
	return text
		.trim()
		.replace(/^\d+(?:\.\d+)*[.)]?\s*/, "")
		.trim();
}

function cleanPageName(raw: string): string {
	// Markdown emphasis around a name is formatting, not part of the name.
	const unemphasized = raw
		.replace(/^\*\*(.+?)\*\*$/, "$1")
		.replace(/^__(.+?)__$/, "$1")
		.replace(/^`(.+?)`$/, "$1")
		.replace(/[*_`]/g, "")
		.trim();
	return stripLeadingNumbering(unemphasized).slice(0, MAX_PAGE_NAME_CHARS);
}

/** Normalized comparison key: case-insensitive, whitespace-collapsed, unnumbered. */
export function normalizePageName(name: string): string {
	return stripLeadingNumbering(name).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Page names declared by the PRD, in document order, de-duplicated by
 * normalized name. Returns [] when the document has no inventory subsection.
 */
export function extractPageInventory(prdMarkdown: string): string[] {
	if (!prdMarkdown) return [];
	const content = prdMarkdown.slice(0, MAX_SCAN_CHARS);
	const lines = content.split(/\r?\n/);

	const out: string[] = [];
	const seen = new Set<string>();
	let insideInventory = false;

	for (const line of lines) {
		if (!insideInventory) {
			if (PAGES_HEADING_RE.test(line)) insideInventory = true;
			continue;
		}
		if (SUBSECTION_END_RE.test(line)) break;

		const entry = PAGE_ENTRY_RE.exec(line);
		if (!entry) continue;
		const name = cleanPageName(entry[1]);
		if (!name) continue;
		const key = normalizePageName(name);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(name);
		if (out.length >= MAX_PAGES) break;
	}

	return out;
}

/**
 * Surfaces declared by a task that the authoritative inventory does not
 * define, preserving the task's own spelling for the error message. Empty when
 * every surface resolves, or when the inventory is empty (legacy PRD: there is
 * nothing authoritative to validate against).
 */
export function findUnknownSurfaces(
	surfaces: string[],
	inventory: string[],
): string[] {
	if (inventory.length === 0) return [];
	const known = new Set(inventory.map(normalizePageName));
	const unknown: string[] = [];
	for (const surface of surfaces) {
		const name = surface.trim();
		if (!name) continue;
		if (known.has(normalizePageName(name))) continue;
		if (unknown.includes(name)) continue;
		unknown.push(name);
	}
	return unknown;
}
