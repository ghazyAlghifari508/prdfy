/**
 * Deterministic manifest generation for codebase sync.
 *
 * Loads source content ONLY for files listed in a `RepositoryScan` (no
 * directory traversal here), hashes bytes with SHA-256, sorts entries by
 * normalized path, enforces file/snapshot limits, classifies text/binary,
 * and flags likely secret content by category. Exclusion reasons never
 * contain file contents or secret values.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExcludedEntry, RepositoryScan } from "./repository.js";
import { isSafeRelativePath } from "./repository.js";

// Locked MVP transport bounds (mirrors `src/lib/constants.ts`; duplicated
// so the standalone CLI package never imports from the web app).
export const CODEBASE_MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;
export const CODEBASE_MAX_FILE_BYTES = 1024 * 1024;
export const CODEBASE_MAX_CHUNK_BYTES = 256 * 1024;

export interface ManifestEntry {
	/** Safe repository-relative path with `/` separators. */
	path: string;
	/** File size in bytes. */
	size: number;
	/** SHA-256 hex digest of the file bytes. */
	hash: string;
	/** Detected language, when known. */
	language?: string;
	/** False when the file must not be uploaded as source content. */
	contentEligible: boolean;
	/** Category reason when `contentEligible` is false (no contents/secrets). */
	exclusionReason?: string;
}

export interface RepositoryManifest {
	/** Deterministic entries sorted by path. No absolute local paths. */
	entries: ManifestEntry[];
	/** Scan exclusions plus manifest-stage exclusions, sorted by path. */
	excluded: ExcludedEntry[];
	/** Sum of eligible entry sizes in bytes. */
	totalBytes: number;
	/** Number of eligible entries. */
	fileCount: number;
	/** Number of excluded entries. */
	excludedCount: number;
}

export interface ManifestOptions {
	maxFileBytes?: number;
	maxSnapshotBytes?: number;
}

export class ManifestTooLargeError extends Error {
	readonly code = "SNAPSHOT_TOO_LARGE" as const;
	readonly totalBytes: number;
	readonly maxSnapshotBytes: number;

	constructor(totalBytes: number, maxSnapshotBytes: number) {
		super(
			`Snapshot size ${totalBytes} bytes exceeds limit of ${maxSnapshotBytes} bytes`,
		);
		this.name = "ManifestTooLargeError";
		this.totalBytes = totalBytes;
		this.maxSnapshotBytes = maxSnapshotBytes;
	}
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
	".ts": "typescript",
	".tsx": "tsx",
	".js": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".jsx": "jsx",
	".json": "json",
	".md": "markdown",
	".markdown": "markdown",
	".py": "python",
	".go": "go",
	".rs": "rust",
	".java": "java",
	".rb": "ruby",
	".php": "php",
	".css": "css",
	".scss": "scss",
	".less": "less",
	".html": "html",
	".xml": "xml",
	".vue": "vue",
	".svelte": "svelte",
	".yml": "yaml",
	".yaml": "yaml",
	".toml": "toml",
	".sh": "shell",
	".graphql": "graphql",
	".gql": "graphql",
};

const BINARY_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".ico",
	".bmp",
	".tiff",
	".psd",
	".mp3",
	".mp4",
	".avi",
	".mov",
	".mkv",
	".wav",
	".flac",
	".ogg",
	".zip",
	".tar",
	".gz",
	".bz2",
	".7z",
	".rar",
	".exe",
	".dll",
	".so",
	".dylib",
	".class",
	".pyc",
	".pdf",
	".woff",
	".woff2",
	".ttf",
	".otf",
	".eot",
]);

/** Content patterns reported by category only; matched text never surfaces. */
const SECRET_CONTENT_PATTERNS: RegExp[] = [
	/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
	/AKIA[0-9A-Z]{16}/,
	/api[_-]?key\s*[:=]\s*['"`][^'"\r\n\s]{8,}['"`]/i,
	/api[_-]?secret\s*[:=]\s*['"`][^'"\r\n\s]{8,}['"`]/i,
	/secret[_-]?key\s*[:=]\s*['"`][^'"\r\n\s]{8,}['"`]/i,
	/aws[_-]?secret\s*[:=]\s*['"`][^'"\r\n\s]{8,}['"`]/i,
	/github[_-]?token\s*[:=]\s*['"`][^'"\r\n\s]{8,}['"`]/i,
	/\bghp_[A-Za-z0-9]{8,}/,
];

export function detectLanguage(normalizedPath: string): string | undefined {
	const dot = normalizedPath.lastIndexOf(".");
	if (dot < 0) return undefined;
	return LANGUAGE_BY_EXTENSION[normalizedPath.slice(dot).toLowerCase()];
}

function hasBinaryExtension(normalizedPath: string): boolean {
	const dot = normalizedPath.lastIndexOf(".");
	if (dot < 0) return false;
	return BINARY_EXTENSIONS.has(normalizedPath.slice(dot).toLowerCase());
}

function containsNullByte(bytes: Buffer): boolean {
	const limit = Math.min(bytes.length, 8192);
	for (let i = 0; i < limit; i++) {
		if (bytes[i] === 0) return true;
	}
	return false;
}

function matchesSecretContent(text: string): boolean {
	for (const pattern of SECRET_CONTENT_PATTERNS) {
		// Reset state for global patterns before each test.
		pattern.lastIndex = 0;
		if (pattern.test(text)) return true;
	}
	return false;
}

function hashBytes(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function hashFileStream(absolutePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		const stream = createReadStream(absolutePath);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("end", () => resolve(hash.digest("hex")));
		stream.on("error", reject);
	});
}

export async function buildManifest(
	scan: RepositoryScan,
	options: ManifestOptions = {},
): Promise<RepositoryManifest> {
	const maxFileBytes = options.maxFileBytes ?? CODEBASE_MAX_FILE_BYTES;
	const maxSnapshotBytes =
		options.maxSnapshotBytes ?? CODEBASE_MAX_SNAPSHOT_BYTES;
	if (
		(options.maxFileBytes !== undefined &&
			(!Number.isFinite(options.maxFileBytes) || options.maxFileBytes <= 0)) ||
		(options.maxSnapshotBytes !== undefined &&
			(!Number.isFinite(options.maxSnapshotBytes) ||
				options.maxSnapshotBytes <= 0))
	) {
		throw new Error(
			"Invalid manifest options: bounds must be positive numbers",
		);
	}

	const entries: ManifestEntry[] = [];
	const excluded: ExcludedEntry[] = [...scan.excluded];

	for (const file of scan.files) {
		if (!isSafeRelativePath(file.path)) {
			excluded.push({ path: file.path, reason: "unsafe:path" });
			continue;
		}
		const absolutePath = join(scan.root, ...file.path.split("/"));

		// Oversized files are hashed via stream (constant memory) and marked
		// ineligible without loading contents.
		if (file.size > maxFileBytes) {
			let hash: string;
			try {
				hash = await hashFileStream(absolutePath);
			} catch {
				excluded.push({ path: file.path, reason: "unreadable:file" });
				continue;
			}
			entries.push({
				path: file.path,
				size: file.size,
				hash,
				language: detectLanguage(file.path),
				contentEligible: false,
				exclusionReason: "too-large:file",
			});
			excluded.push({ path: file.path, reason: "too-large:file" });
			continue;
		}

		let bytes: Buffer;
		try {
			bytes = await readFile(absolutePath);
		} catch {
			excluded.push({ path: file.path, reason: "unreadable:file" });
			continue;
		}

		const size = bytes.length;
		// Recheck size in case file grew concurrently between scan and read
		if (size > maxFileBytes) {
			entries.push({
				path: file.path,
				size,
				hash: hashBytes(bytes),
				language: detectLanguage(file.path),
				contentEligible: false,
				exclusionReason: "too-large:file",
			});
			excluded.push({ path: file.path, reason: "too-large:file" });
			continue;
		}

		// Zero-byte files carry no content to analyze and can never satisfy the
		// strict non-empty chunk upload contract, so they are a local exclusion
		// (counted in excludedCount) and never reach the server manifest.
		if (size === 0) {
			entries.push({
				path: file.path,
				size,
				hash: hashBytes(bytes),
				language: detectLanguage(file.path),
				contentEligible: false,
				exclusionReason: "empty:file",
			});
			excluded.push({ path: file.path, reason: "empty:file" });
			continue;
		}
		if (hasBinaryExtension(file.path) || containsNullByte(bytes)) {
			entries.push({
				path: file.path,
				size,
				hash: hashBytes(bytes),
				language: detectLanguage(file.path),
				contentEligible: false,
				exclusionReason: "binary:content",
			});
			excluded.push({ path: file.path, reason: "binary:content" });
			continue;
		}

		const text = bytes.toString("utf-8");
		if (matchesSecretContent(text)) {
			entries.push({
				path: file.path,
				size,
				hash: hashBytes(bytes),
				language: detectLanguage(file.path),
				contentEligible: false,
				exclusionReason: "secret:content-match",
			});
			excluded.push({ path: file.path, reason: "secret:content-match" });
			continue;
		}

		entries.push({
			path: file.path,
			size,
			hash: hashBytes(bytes),
			language: detectLanguage(file.path),
			contentEligible: true,
		});
	}

	entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	excluded.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

	let totalBytes = 0;
	let fileCount = 0;
	for (const entry of entries) {
		if (entry.contentEligible) {
			totalBytes += entry.size;
			fileCount += 1;
		}
	}
	if (totalBytes > maxSnapshotBytes) {
		throw new ManifestTooLargeError(totalBytes, maxSnapshotBytes);
	}

	return {
		entries,
		excluded,
		totalBytes,
		fileCount,
		excludedCount: excluded.length,
	};
}
