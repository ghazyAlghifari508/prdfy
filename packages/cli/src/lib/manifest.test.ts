import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPrdfyIgnore } from "./ignore.js";
import {
	buildManifest,
	CODEBASE_MAX_CHUNK_BYTES,
	CODEBASE_MAX_FILE_BYTES,
	CODEBASE_MAX_SNAPSHOT_BYTES,
} from "./manifest.js";
import { scanRepository } from "./repository.js";

async function makeTempRoot(): Promise<string> {
	return mkdtemp(join(tmpdir(), "prdfy-manifest-test-"));
}

async function writeRepoFile(
	root: string,
	rel: string,
	content: string | Buffer,
): Promise<void> {
	const full = join(root, rel);
	await mkdir(join(full, ".."), { recursive: true });
	await writeFile(full, content);
}

describe("manifest constants", () => {
	it("uses the locked MVP transport bounds", () => {
		expect(CODEBASE_MAX_SNAPSHOT_BYTES).toBe(50 * 1024 * 1024);
		expect(CODEBASE_MAX_FILE_BYTES).toBe(1024 * 1024);
		expect(CODEBASE_MAX_CHUNK_BYTES).toBe(256 * 1024);
	});
});

describe("buildManifest", () => {
	it("returns deterministic entries sorted by path with sha256 hashes", async () => {
		const root = await makeTempRoot();
		await writeRepoFile(root, "b.ts", "export const b = 2;\n");
		await writeRepoFile(root, "a.ts", "export const a = 1;\n");
		const rules = await readPrdfyIgnore(root);
		const scan = await scanRepository(root, rules);
		const first = await buildManifest(scan);
		const second = await buildManifest(scan);
		expect(first.entries.map((e) => e.path)).toEqual(["a.ts", "b.ts"]);
		expect(first).toEqual(second);
		for (const entry of first.entries) {
			expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
			expect(entry.size).toBeGreaterThan(0);
		}
		const expected = createHash("sha256")
			.update("export const a = 1;\n")
			.digest("hex");
		expect(first.entries[0].hash).toBe(expected);
	});

	it("classifies language and marks text files eligible", async () => {
		const root = await makeTempRoot();
		await writeRepoFile(root, "src/app.ts", "export const x = 1;\n");
		const rules = await readPrdfyIgnore(root);
		const scan = await scanRepository(root, rules);
		const manifest = await buildManifest(scan);
		expect(manifest.entries).toHaveLength(1);
		expect(manifest.entries[0].language).toBe("typescript");
		expect(manifest.entries[0].contentEligible).toBe(true);
	});

	it("marks binary files ineligible without uploading contents", async () => {
		const root = await makeTempRoot();
		await writeRepoFile(
			root,
			"assets/logo.png",
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x00, 0x10]),
		);
		const rules = await readPrdfyIgnore(root);
		const scan = await scanRepository(root, rules);
		const manifest = await buildManifest(scan);
		expect(manifest.entries).toHaveLength(1);
		expect(manifest.entries[0].contentEligible).toBe(false);
		expect(manifest.entries[0].exclusionReason).toMatch(/binary/i);
	});

	it("marks oversized files ineligible when exceeding the file limit", async () => {
		const root = await makeTempRoot();
		await writeRepoFile(root, "big.txt", "x".repeat(64));
		const rules = await readPrdfyIgnore(root);
		const scan = await scanRepository(root, rules);
		const manifest = await buildManifest(scan, { maxFileBytes: 16 });
		expect(manifest.entries).toHaveLength(1);
		expect(manifest.entries[0].contentEligible).toBe(false);
		expect(manifest.entries[0].exclusionReason).toMatch(/too-large|size/i);
	});

	it("rejects snapshots exceeding the snapshot limit", async () => {
		const root = await makeTempRoot();
		await writeRepoFile(root, "a.txt", "a".repeat(32));
		await writeRepoFile(root, "b.txt", "b".repeat(32));
		const rules = await readPrdfyIgnore(root);
		const scan = await scanRepository(root, rules);
		await expect(buildManifest(scan, { maxSnapshotBytes: 16 })).rejects.toThrow(
			/snapshot/i,
		);
	});

	it("flags likely secret content by category without exposing values", async () => {
		const root = await makeTempRoot();
		const marker = "placeholder-test-credential";
		await writeRepoFile(
			root,
			"src/config.ts",
			`export const apiKey = "${marker}";\n`,
		);
		const rules = await readPrdfyIgnore(root);
		const scan = await scanRepository(root, rules);
		const manifest = await buildManifest(scan);
		expect(manifest.entries).toHaveLength(1);
		expect(manifest.entries[0].contentEligible).toBe(false);
		expect(manifest.entries[0].exclusionReason).toMatch(/secret/i);
		const serialized = JSON.stringify(manifest);
		expect(serialized).not.toContain(marker);
	});

	it("builds purely from the scan object without directory traversal", async () => {
		const scan = {
			root: "/synthetic/root",
			files: [
				{ path: "b.txt", size: 1 },
				{ path: "a.txt", size: 1 },
			],
			excluded: [],
		};
		// Paths do not exist on disk: manifest loads content itself (no walk),
		// so both resolve to unreadable exclusions instead of walked content.
		const manifest = await buildManifest(scan);
		expect(manifest.entries).toEqual([]);
		expect(manifest.excluded).toEqual([
			{ path: "a.txt", reason: "unreadable:file" },
			{ path: "b.txt", reason: "unreadable:file" },
		]);
	});

	it("keeps absolute local paths out of the uploadable manifest output", async () => {
		const root = await makeTempRoot();
		await writeRepoFile(root, "src/app.ts", "export const x = 1;\n");
		const rules = await readPrdfyIgnore(root);
		const scan = await scanRepository(root, rules);
		const manifest = await buildManifest(scan);
		const payload = JSON.stringify({
			entries: manifest.entries,
			excluded: manifest.excluded,
		});
		expect(payload).not.toContain(root);
	});
});
