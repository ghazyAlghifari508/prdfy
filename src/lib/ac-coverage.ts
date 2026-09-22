/**
 * Deterministic requirement-traceability for the AC -> Task boundary.
 *
 * Acceptance Criteria headings are the authoritative requirement identifiers
 * (`### AC-1.1 Judul`). Task output declares coverage structurally
 * (`covers: ["AC-1.1"]`) instead of burying references in prose, so coverage
 * can be verified server-side instead of trusted from model prose.
 *
 * This module is pure: it parses AC markdown, reads the declared coverage out
 * of a task tree, and reports what is covered, missing, or unknown. It never
 * throws on malformed input and never guesses identifiers.
 */

/** AC identifier: `AC-<section>.<index>`, e.g. AC-1.1, AC-12.3. */
const AC_ID_RE = /\bAC-(\d+)\.(\d+)\b/gi;

/**
 * Heading line that DEFINES a requirement. Only headings declare requirements:
 * an `AC-X.Y` mentioned in prose (e.g. "lihat AC-1.2") is a reference, not a
 * new requirement, and must not be treated as one.
 */
const AC_HEADING_RE = /^#{1,6}\s+(.*)$/;

/** Canonical uppercase form, so `ac-1.1` and `AC-1.1` are the same identifier. */
export function canonicalAcId(id: string): string {
	return id.toUpperCase();
}

function acIdFromMatch(section: string, index: string): string {
	return `AC-${section}.${index}`;
}

/**
 * Extract every requirement identifier DEFINED by an AC document, in document
 * order, de-duplicated. Requirements are declared by headings that contain an
 * `AC-X.Y` token.
 */
export function extractAcIds(acMarkdown: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const line of acMarkdown.split(/\r?\n/)) {
		const heading = AC_HEADING_RE.exec(line);
		if (!heading) continue;
		for (const match of heading[1].matchAll(AC_ID_RE)) {
			const id = acIdFromMatch(match[1], match[2]);
			if (seen.has(id)) continue;
			seen.add(id);
			out.push(id);
		}
	}
	return out;
}

/**
 * Extract every requirement identifier REFERENCED anywhere in a document
 * (headings and prose). Used to validate that a task's declared coverage
 * points at a requirement that actually exists.
 */
export function extractReferencedAcIds(text: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const match of text.matchAll(AC_ID_RE)) {
		const id = acIdFromMatch(match[1], match[2]);
		if (seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

export interface AcCoverageReport {
	/** Requirements defined by the AC document, in document order. */
	defined: string[];
	/** Declared coverage that resolves to a defined requirement. */
	covered: string[];
	/** Defined requirements with no declared coverage. */
	missing: string[];
	/** Declared coverage that references an undefined requirement. */
	unknown: string[];
	/** True when nothing is missing and nothing is unknown. */
	complete: boolean;
}

export interface CoverageInput {
	/** Requirement ids declared covered, already collected from the task tree. */
	declared: string[];
	/** Requirement ids defined by the authoritative AC document. */
	defined: string[];
}

/**
 * Compare declared coverage against defined requirements. Ids are normalized
 * (case-insensitive, de-duplicated) before comparison.
 *
 * `covered` and `missing` both follow the AC document order, so a report reads
 * like the requirement document it describes.
 */
export function buildCoverageReport(input: CoverageInput): AcCoverageReport {
	const definedSeen = new Set<string>();
	const defined: string[] = [];
	for (const raw of input.defined) {
		const id = canonicalAcId(raw);
		if (definedSeen.has(id)) continue;
		definedSeen.add(id);
		defined.push(id);
	}

	const declaredSeen = new Set<string>();
	const unknown: string[] = [];
	for (const raw of input.declared) {
		const id = canonicalAcId(raw);
		if (declaredSeen.has(id)) continue;
		declaredSeen.add(id);
		if (!definedSeen.has(id)) unknown.push(id);
	}

	const covered = defined.filter((id) => declaredSeen.has(id));
	const missing = defined.filter((id) => !declaredSeen.has(id));
	return {
		defined,
		covered,
		missing,
		unknown,
		complete: missing.length === 0 && unknown.length === 0,
	};
}
