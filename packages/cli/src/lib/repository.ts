/**
 * Repository scanner for codebase sync.
 *
 * Walks the repository without following symlinks, normalizes every path to
 * a safe repository-relative `/`-separated form, applies built-in exclusions
 * plus `.prdfyignore` custom rules, and returns exclusion metadata without
 * file contents. Source content loading happens later in `manifest.ts`.
 */

import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import {
	dirname,
	isAbsolute,
	join,
	parse,
	relative,
	resolve,
	sep,
} from "node:path";
import {
	type IgnoreRules,
	isBuiltInExcluded,
	matchesCustomIgnore,
} from "./ignore.js";

/**
 * Resolve the repository root for a sync run.
 *
 * An explicit `--root` always wins. Otherwise walk up from `startDir` to the
 * nearest ancestor containing a `.git` entry, so an agent launched from a
 * subdirectory still scans the whole repository. A `.git` file counts as a
 * match, not only a directory, so git worktrees and submodules resolve.
 * Without any marker the start directory is kept, matching prior behavior.
 *
 * Walks the filesystem directly rather than shelling out to git: that keeps
 * this deterministic and free of new failure modes (git absent, not on PATH,
 * output encoding).
 */
export async function resolveRepositoryRoot(
	startDir: string,
	explicitRoot?: string,
): Promise<string> {
	if (explicitRoot) return resolve(explicitRoot);

	let current = resolve(startDir);
	const { root: filesystemRoot } = parse(current);
	while (true) {
		try {
			await lstat(join(current, ".git"));
			return current;
		} catch (err) {
			if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
		}
		if (current === filesystemRoot) return resolve(startDir);
		const parent = dirname(current);
		if (parent === current) return resolve(startDir);
		current = parent;
	}
}

export interface ScannedFile {
	/** Safe repository-relative path with `/` separators. */
	path: string;
	/** File size in bytes at scan time. */
	size: number;
}

export interface ExcludedEntry {
	/** Safe repository-relative path with `/` separators. */
	path: string;
	/** Exclusion category (never contains file contents or secrets). */
	reason: string;
}

export interface RepositoryScan {
	/** Absolute repository root used for content loading (never uploaded). */
	root: string;
	/** Included files, sorted by path. */
	files: ScannedFile[];
	/** Excluded paths with reasons, sorted by path. */
	excluded: ExcludedEntry[];
}

/**
 * Guard duplicated from the web app (`src/lib/codebase-sync.ts`) so the
 * standalone CLI package never imports from `src/`. Normalizes backslashes
 * first, then rejects absolute/drive/UNC paths, empty segments, and `..`.
 */
export function isSafeRelativePath(path: string): boolean {
	if (!path || path.length === 0) return false;
	if (path.includes("\0")) return false;
	const normalized = path.replace(/\\/g, "/");
	if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
		return false;
	}
	const segments = normalized.split("/");
	for (const segment of segments) {
		if (segment === "" || segment === "." || segment === "..") return false;
	}
	return true;
}

function toNormalizedRelative(
	root: string,
	absolutePath: string,
): string | null {
	const rel = relative(root, absolutePath);
	if (rel === "" || isAbsolute(rel)) return null;
	const normalized = rel.split(sep).join("/");
	if (!isSafeRelativePath(normalized)) return null;
	return normalized;
}

function isWithinRoot(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export async function scanRepository(
	root: string,
	rules: IgnoreRules,
): Promise<RepositoryScan> {
	const resolvedRoot = await realpath(resolve(root)).catch(() => resolve(root));
	const rootStat = await stat(resolvedRoot).catch((err) => {
		throw new Error(
			`Cannot scan repository root: ${err instanceof Error ? err.message : String(err)}`,
		);
	});
	if (!rootStat.isDirectory()) {
		throw new Error("Repository root is not a directory");
	}

	const files: ScannedFile[] = [];
	const excluded: ExcludedEntry[] = [];

	async function visit(absolutePath: string): Promise<void> {
		let entryStat: Awaited<ReturnType<typeof lstat>>;
		try {
			entryStat = await lstat(absolutePath);
		} catch {
			const normalized = toNormalizedRelative(resolvedRoot, absolutePath);
			if (normalized) {
				excluded.push({ path: normalized, reason: "unreadable:stat" });
			}
			return;
		}

		// Never follow symlinks blindly: resolve and require containment.
		if (entryStat.isSymbolicLink()) {
			let target: string;
			try {
				target = await realpath(absolutePath);
			} catch {
				const normalized = toNormalizedRelative(resolvedRoot, absolutePath);
				if (normalized) {
					excluded.push({ path: normalized, reason: "unreadable:symlink" });
				}
				return;
			}
			if (!isWithinRoot(resolvedRoot, target)) {
				const normalized = toNormalizedRelative(resolvedRoot, absolutePath);
				if (normalized) {
					excluded.push({
						path: normalized,
						reason: "unsafe:symlink-escape",
					});
				}
				return;
			}
			try {
				entryStat = await stat(target);
			} catch {
				const normalized = toNormalizedRelative(resolvedRoot, absolutePath);
				if (normalized) {
					excluded.push({ path: normalized, reason: "unreadable:stat" });
				}
				return;
			}
			if (entryStat.isDirectory()) {
				// Avoid symlink cycles: do not descend into linked directories.
				const normalized = toNormalizedRelative(resolvedRoot, absolutePath);
				if (normalized) {
					excluded.push({ path: normalized, reason: "unsafe:symlink-dir" });
				}
				return;
			}
		}

		if (entryStat.isDirectory()) {
			let children: string[];
			try {
				children = await readdir(absolutePath);
			} catch {
				const normalized = toNormalizedRelative(resolvedRoot, absolutePath);
				if (normalized) {
					excluded.push({ path: normalized, reason: "unreadable:directory" });
				}
				return;
			}
			for (const child of children) {
				await visit(join(absolutePath, child));
			}
			return;
		}

		if (!entryStat.isFile()) return;

		const normalized = toNormalizedRelative(resolvedRoot, absolutePath);
		if (!normalized) {
			return;
		}

		// Readability probe (no bytes loaded): unreadable files are excluded
		// here so the scan never fails later; content loading stays in
		// `manifest.ts`.
		let handle: Awaited<ReturnType<typeof open>> | undefined;
		try {
			handle = await open(absolutePath, "r");
		} catch {
			excluded.push({ path: normalized, reason: "unreadable:file" });
			return;
		} finally {
			if (handle) {
				try {
					await handle.close();
				} catch {}
			}
		}

		const builtIn = isBuiltInExcluded(normalized, false);
		if (builtIn.excluded) {
			excluded.push({
				path: normalized,
				reason: builtIn.reason ?? "built-in:excluded",
			});
			return;
		}
		if (matchesCustomIgnore(normalized, false, rules.patterns)) {
			excluded.push({ path: normalized, reason: "custom:prdfyignore" });
			return;
		}
		files.push({ path: normalized, size: entryStat.size });
	}

	await visit(resolvedRoot);

	files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	excluded.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	return { root: resolvedRoot, files, excluded };
}
