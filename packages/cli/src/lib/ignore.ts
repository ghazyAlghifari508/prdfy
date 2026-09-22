/**
 * `.prdfyignore` parsing and built-in exclusion rules for codebase sync.
 *
 * `.prdfyignore` supplements built-in protection; it can never override
 * secret or unsafe-path exclusions. Built-ins are enforced independently
 * by the repository scanner.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface IgnoreRules {
	/** Absolute repository root the rules were read from. */
	root: string;
	/** Custom patterns from `.prdfyignore` (negations dropped, see below). */
	patterns: string[];
	/** Raw file content (`""` when the file is absent). */
	raw: string;
	/** Negation lines that were dropped because user rules cannot lift built-ins. */
	droppedNegations: string[];
}

const IGNORE_FILENAME = ".prdfyignore";

/**
 * Default `.prdfyignore` written on first sync. Every pattern is commented
 * out: built-in exclusions already cover secrets, build output, and binaries,
 * and an active pattern here would silently change which files get uploaded.
 */
export const PRDFY_IGNORE_TEMPLATE = `# .prdfyignore — exclusions untuk sync codebase PrdFy.
#
# File ini bersifat lokal. JANGAN commit ke repositori.
#
# PrdFy CLI sudah mengecualikan hal berikut secara otomatis, jadi tidak perlu
# ditulis ulang di sini:
#   - file rahasia      : .env*, *.pem, *.key, *.p12, *.pfx, sertifikat
#   - dependensi & build: node_modules/, dist/, build/, coverage/, .git/
#   - dump database     : *.sql, *.sqlite, *.db, *.dump
#   - file binary       : gambar, audio, video, arsip, executable
#
# Tambahkan pola di bawah untuk mengecualikan path khusus repositori kamu.
# Satu pola per baris. Mendukung *, **, ?, dan awalan direktori diakhiri "/".
# Baris diawali "#" diabaikan. Pola negasi ("!...") diabaikan agar tidak
# membatalkan perlindungan bawaan.
#
# Contoh:
# internal/
# scripts/seed-data/
# *.log
`;

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
 * user rules cannot lift built-in secret/unsafe-path protection. Dropped
 * negations are reported so the caller can warn instead of failing silently.
 */
export async function readPrdfyIgnore(root: string): Promise<IgnoreRules> {
	const filePath = join(root, IGNORE_FILENAME);
	let raw = "";
	try {
		raw = await readFile(filePath, "utf-8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
			return { root, patterns: [], raw: "", droppedNegations: [] };
		}
		throw err;
	}
	const patterns: string[] = [];
	const droppedNegations: string[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		// Negations are inert: they must never re-include built-in exclusions.
		if (trimmed.startsWith("!")) {
			droppedNegations.push(trimmed);
			continue;
		}
		patterns.push(trimmed);
	}
	return { root, patterns, raw, droppedNegations };
}

/**
 * Create `.prdfyignore` from the default template when it does not exist.
 * Idempotent: an existing file is never read-modified or overwritten, so user
 * rules always survive. Returns whether the file was created by this call.
 * The file is local sync configuration; this module never invokes git, so it
 * can never be committed or pushed automatically.
 */
export async function ensurePrdfyIgnore(
	root: string,
): Promise<{ created: boolean }> {
	const filePath = join(root, IGNORE_FILENAME);
	try {
		await readFile(filePath, "utf-8");
		return { created: false };
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
	}
	// "wx" fails if the path appeared concurrently, so two runs cannot clobber
	// each other and an existing file is never truncated.
	try {
		await writeFile(filePath, PRDFY_IGNORE_TEMPLATE, {
			encoding: "utf-8",
			flag: "wx",
		});
		return { created: true };
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === "EEXIST") {
			return { created: false };
		}
		throw err;
	}
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
