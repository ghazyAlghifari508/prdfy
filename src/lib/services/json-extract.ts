/**
 * Extract JSON object text from a raw LLM completion that may wrap it in a
 * markdown fence.
 *
 * Candidates are tried in order and the first one that parses wins:
 * 1. greedy fence match (last ```) — a non-greedy match breaks when JSON
 *    string values themselves contain a backtick fence (e.g. task "details"
 *    describing a shell command);
 * 2. non-greedy first fence — covers a valid JSON fence followed by an
 *    unrelated later fence that the greedy match would swallow;
 * 3. string-aware brace scan — finds the first balanced {...} span instead
 *    of blindly slicing first-{ to last-}, so prose braces can't corrupt it.
 * Falls back to the trimmed raw text when nothing validates.
 */
function tryParse(candidate: string): string | null {
	try {
		JSON.parse(candidate);
		return candidate;
	} catch {
		return null;
	}
}

function scanBalancedObject(raw: string): string | null {
	let depth = 0;
	let start = -1;
	let inString = false;
	let escaped = false;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		// Backtick code spans are opaque prose (e.g. `{foo}` in docs) —
		// their braces must not open or close the JSON candidate.
		if (ch === "`") {
			const close = raw.indexOf("`", i + 1);
			i = close === -1 ? raw.length : close;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === "{") {
			if (depth === 0) start = i;
			depth++;
		} else if (ch === "}") {
			if (depth === 0) continue;
			depth--;
			if (depth === 0 && start !== -1) return raw.slice(start, i + 1);
		}
	}
	return null;
}

export function extractJson(raw: string): string {
	const greedy = raw.match(/```(?:json)?\s*([\s\S]*)```/i);
	if (greedy) {
		const valid = tryParse(greedy[1].trim());
		if (valid) return valid;
	}
	const lazy = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (lazy) {
		const valid = tryParse(lazy[1].trim());
		if (valid) return valid;
	}
	const scanned = scanBalancedObject(raw);
	if (scanned) {
		const valid = tryParse(scanned);
		if (valid) return valid;
	}
	return raw.trim();
}
