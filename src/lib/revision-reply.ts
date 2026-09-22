/**
 * User-facing completion message for a PRD revision turn.
 *
 * The revision protocol asks the model for a natural reply sentence followed by
 * `:::UPDATE_SECTION[...]` patch blocks. Only the prose before the first block
 * is ever visible to the user (the blocks are the patch payload, not a message),
 * so a model that introduces its patches with a colon ("...terdampak:") left the
 * user reading a sentence that stops mid-thought.
 *
 * The sections that were actually merged are known deterministically server-side,
 * so the completion clause is derived from those names instead of from model
 * prose or the user prompt. This module is pure: no DB, no provider, no clock.
 */
import { normalizeLanguage, type OutputLanguage } from "@/lib/language";

/** Protocol marker that opens a patch block. */
const UPDATE_SECTION_MARKER = ":::UPDATE_SECTION";

/**
 * Section boundary comments. The revision protocol asks the model to wrap each
 * patch body in them, and the merge writes the canonical pair itself — so a body
 * that already carries them (the common case, since the prompt's example shows
 * them) would otherwise persist two opening markers per section and double on
 * every subsequent revision. Both forms are matched: `<!-- SECTION: X -->` and
 * the closing `<!-- /SECTION -->`.
 */
const SECTION_MARKER_RE = /<!--\s*(?:\/\s*SECTION|SECTION\s*:[^>]*?)\s*-->/gi;

/**
 * Remove section boundary comments from a patch body. The stored document's
 * markers are owned by the merge, never by the model's payload.
 */
export function stripSectionMarkers(content: string): string {
	return content.replace(SECTION_MARKER_RE, "").trim();
}

export interface RevisionReplyInput {
	/** Full streamed model response for this revision turn. */
	rawResponse: string;
	/** Section names actually merged into the persisted PRD, in merge order. */
	patchedSections: string[];
	/** Output language of the project. */
	language: OutputLanguage;
}

/**
 * Trailing punctuation that promises a continuation. A reply ending in one of
 * these is incomplete on its own, so the applied-sections clause continues it.
 */
const DANGLING_TAIL_RE = /[:：,，;；\-–—]+\s*$|\.{2,}\s*$|…\s*$/;

function endsWithDanglingIntroducer(text: string): boolean {
	return DANGLING_TAIL_RE.test(text);
}

function normalizeSectionNames(sections: string[]): string[] {
	const out: string[] = [];
	for (const raw of sections) {
		const name = raw.trim();
		if (!name) continue;
		if (out.includes(name)) continue;
		out.push(name);
	}
	return out;
}

function appliedClause(sections: string[], language: OutputLanguage): string {
	const list = sections.join(", ");
	return language === "en"
		? `Changes were applied to the following sections: ${list}.`
		: `Perubahan diterapkan pada section: ${list}.`;
}

function noChangeMessage(language: OutputLanguage): string {
	return language === "en"
		? "No PRD sections were changed by this request."
		: "Tidak ada section PRD yang berubah dari permintaan ini.";
}

/**
 * Build the assistant reply persisted and rendered after a revision.
 *
 * - A response with no patch block is a plain answer and is returned whole.
 * - When sections were patched, the reply always names them, so it can never
 *   end on a dangling introducer and never exposes protocol markers.
 */
export function buildRevisionAssistantReply(input: RevisionReplyInput): string {
	const language = normalizeLanguage(input.language);
	const raw = input.rawResponse ?? "";

	if (!raw.includes(UPDATE_SECTION_MARKER)) {
		// A reply without patch blocks is a plain answer. An empty one is not a
		// revision: say so instead of claiming a change that never happened.
		const plain = raw.trim();
		return plain || noChangeMessage(language);
	}

	const preamble = raw.split(UPDATE_SECTION_MARKER)[0].trim();
	const sections = normalizeSectionNames(input.patchedSections);

	if (sections.length === 0) {
		// Patch blocks were emitted but nothing merged: never confirm a change
		// that did not happen.
		return preamble && !endsWithDanglingIntroducer(preamble)
			? preamble
			: noChangeMessage(language);
	}

	if (!preamble) return appliedClause(sections, language);
	if (endsWithDanglingIntroducer(preamble)) {
		return `${preamble} ${sections.join(", ")}.`;
	}
	return `${preamble} ${appliedClause(sections, language)}`;
}
