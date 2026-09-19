/**
 * `.prdfyignore` parsing and built-in exclusion rules for codebase sync.
 *
 * `.prdfyignore` supplements built-in protection; it can never override
 * secret or unsafe-path exclusions. Built-ins are enforced independently
 * by the repository scanner.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface IgnoreRules {
	/** Absolute repository root the rules were read from. */
	root: string;
	/** Custom patterns from `.prdfyignore` (negations dropped, see below). */
	patterns: string[];
	/** Raw file content (`""` when the file is absent). */
	raw: string;
}

const IGNORE_FILENAME = ".prdfyignore";

/** Directory names that are always excluded, at any depth. */
const BUILT_IN_DIRECTORIES = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"coverage",
	".next",
	"out",
	"credentials",
	"secrets",
]);

/** File extensions that are always excluded (keys, certs, dumps, backups). */
const BUILT_IN_EXTENSIONS = new Set([
	".pem",
	".key",
	".p12",
	".pfx",
	".crt",
	".cer",
	".der",
	".sql",
	".dump",
	".sqlite",
	".sqlite3",
	".db",
	".bak",
	".orig",
	".rej",
]);

export type BuiltInExclusionReason =
	| "built-in:vcs"
	| "built-in:dependency"
	| "built-in:build"
	| "built-in:dotenv"
	| "built-in:key-material"
	| "built-in:database-dump"
	| "built-in:backup"
	| "built-in:secret-directory"
	| "built-in:ignore-file";

/**
 * Read `.prdfyignore` from the repository root without mutating the repo.
 * Missing file yields empty patterns. Negation rules (`!...`) are dropped:
 * user rules cannot lift built-in secret/unsafe-path protection.
 */
export async function readPrdfyIgnore(root: string): Promise<IgnoreRules> {
	const filePath = join(root, IGNORE_FILENAME);
	let raw = "";
	try {
		raw = await readFile(filePath, "utf-8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
			return { root, patterns: [], raw: "" };
		}
		throw err;
	}
	const patterns: string[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		// Negations are inert: they must never re-include built-in exclusions.
		if (trimmed.startsWith("!")) continue;
		patterns.push(trimmed);
	}
	return { root, patterns, raw };
}

function globToRegExp(glob: string): RegExp {
	let source = "";
	let i = 0;
	while (i < glob.length) {
		const ch = glob[i];
		if (ch === "*") {
			if (glob[i + 1] === "*") {
				// "**" spans path separators; an optional trailing "/" follows.
				if (glob[i + 2] === "/") {
					source += "(?:.*/)?";
					i += 3;
				} else {
					source += ".*";
					i += 2;
				}
			} else {
				source += "[^/]*";
				i += 1;
			}
		} else if (ch === "?") {
			source += "[^/]";
			i += 1;
		} else if (ch === "[") {
			const close = glob.indexOf("]", i + 1);
			if (close === -1) {
				source += "\\[";
				i += 1;
			} else {
				source += glob.slice(i, close + 1);
				i = close + 1;
			}
		} else {
			source += ch.replace(/[.+^${}()|\\]/g, "\\$&");
			i += 1;
		}
	}
	return new RegExp(`^${source}$`);
}

function matchGlob(pattern: string, value: string): boolean {
	return globToRegExp(pattern).test(value);
}

/**
 * Match a repository-relative `/`-separated path against custom patterns.
 * Supports trailing-`/` directory prefixes plus `*`, `**`, `?` globs.
 * Patterns without a `/` also match the basename.
 */
export function matchesCustomIgnore(
	normalizedPath: string,
	isDirectory: boolean,
	patterns: readonly string[],
): boolean {
	const basename = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
	for (let rawPattern of patterns) {
		rawPattern = rawPattern.trim();
		if (rawPattern === "" || rawPattern.startsWith("#")) continue;
		if (rawPattern.startsWith("!")) continue;
		// A leading "/" anchors to the root; strip it since paths are relative.
		const pattern = rawPattern.startsWith("/")
			? rawPattern.slice(1)
			: rawPattern;
		if (pattern.endsWith("/")) {
			const prefix = pattern.slice(0, -1);
			if (
				normalizedPath === prefix ||
				normalizedPath.startsWith(`${prefix}/`)
			) {
				return true;
			}
			continue;
		}
		if (matchGlob(pattern, normalizedPath)) return true;
		if (!pattern.includes("/") && matchGlob(pattern, basename)) return true;
		// Directory match without trailing slash excludes its subtree too.
		if (isDirectory && normalizedPath === pattern) return true;
	}
	return false;
}

/**
 * Built-in exclusion check. Independent of `.prdfyignore`: custom rules
 * cannot override these. Returns the category reason when excluded.
 */
export function isBuiltInExcluded(
	normalizedPath: string,
	isDirectory: boolean,
): { excluded: boolean; reason?: BuiltInExclusionReason } {
	const segments = normalizedPath.split("/");
	for (const segment of segments) {
		if (segment === ".git") return { excluded: true, reason: "built-in:vcs" };
		if (segment === "node_modules") {
			return { excluded: true, reason: "built-in:dependency" };
		}
		if (
			segment === "dist" ||
			segment === "build" ||
			segment === "coverage" ||
			segment === ".next" ||
			segment === "out"
		) {
			return { excluded: true, reason: "built-in:build" };
		}
		if (segment === "credentials" || segment === "secrets") {
			return { excluded: true, reason: "built-in:secret-directory" };
		}
	}
	const basename = segments[segments.length - 1];
	// The CLI's own control file is local config, never source content.
	if (basename === IGNORE_FILENAME) {
		return { excluded: true, reason: "built-in:ignore-file" };
	}
	if (basename === ".env" || basename.startsWith(".env.")) {
		return { excluded: true, reason: "built-in:dotenv" };
	}
	if (!isDirectory) {
		const dot = basename.lastIndexOf(".");
		// Trailing "~" editor backups have no extension to look up.
		if (basename.endsWith("~")) {
			return { excluded: true, reason: "built-in:backup" };
		}
		if (dot > 0) {
			const ext = basename.slice(dot).toLowerCase();
			if (BUILT_IN_EXTENSIONS.has(ext)) {
				if (
					ext === ".pem" ||
					ext === ".key" ||
					ext === ".p12" ||
					ext === ".pfx" ||
					ext === ".crt" ||
					ext === ".cer" ||
					ext === ".der"
				) {
					return { excluded: true, reason: "built-in:key-material" };
				}
				if (
					ext === ".sql" ||
					ext === ".dump" ||
					ext === ".sqlite" ||
					ext === ".sqlite3" ||
					ext === ".db"
				) {
					return { excluded: true, reason: "built-in:database-dump" };
				}
				return { excluded: true, reason: "built-in:backup" };
			}
		}
	}
	if (isDirectory && BUILT_IN_DIRECTORIES.has(basename)) {
		return { excluded: true, reason: "built-in:build" };
	}
	return { excluded: false };
}
