import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPrdfyIgnore } from "./ignore.js";
import { scanRepository } from "./repository.js";

async function makeTempRoot(): Promise<string> {
	return mkdtemp(join(tmpdir(), "prdfy-repo-test-"));
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

function excludedPaths(scan: { excluded: Array<{ path: string }> }): string[] {
	return scan.excluded.map((e) => e.path).sort();
}

describe("scanRepository", () => {
	it("excludes dotenv files with reasons and without file contents", async () => {
		const root = await makeTempRoot();
		await writeRepoFile(root, ".env", "PLACEHOLDER=1\n");
		await writeRepoFile(root, ".env.local", "PLACEHOLDER=1\n");
		await writeRepoFile(root, "src/app.ts", "export const x = 1;\n");
		const rules = await readPrdfyIgnore(root);
		const scan = await scanRepository(root, rules);
		expect(scan.files.map((f) => f.path)).toEqual(["src/app.ts"]);
		const paths = excludedPaths(scan);
		expect(paths).toContain(".env");
		expect(paths).toContain(".env.local");
		for (const entry of scan.excluded) {
			expect(entry).toHaveProperty("path");
			expect(entry).toHaveProperty("reason");
			expect(entry).not.toHaveProperty("content");
			expect(JSON.stringify(entry)).not.toContain("PLACEHOLDER");
		}
	});

	it("excludes key and certificate material", async () => {
		const root = await makeTempRoot();
		await writeRepoFile(root, "certs/server.pem", "placeholder-pem\n");
		await writeRepoFile(root, "certs/server.key", "placeholder-key\n");
		await writeRepoFile(root, "certs/bundle.p12", "placeholder-p12\n");
		await writeRepoFile(root, "src/app.ts", "export const x = 1;\n");
		const rules = await readPrdfyIgnore(root);
		const scan = await scanRepository(root, rules);
		expect(scan.files.map((f) => f.path)).toEqual(["src/app.ts"]);
		const paths = excludedPaths(scan);
		expect(paths).toContain("certs/server.pem");
		expect(paths).toContain("certs/server.key");
		expect(paths).toContain("certs/bundle.p12");
	});

	it("excludes version-control and dependency/build directories", async () => {
		const root = await makeTempRoot();
		await writeRepoFile(root, ".git/HEAD", "ref: refs/heads/main\n");
		await writeRepoFile(root, "node_modules/pkg/index.js", "x\n");
		await writeRepoFile(root, "dist/bundle.js", "x\n");
		await writeRepoFile(root, "build/out.js", "x\n");
		await writeRepoFile(root, "coverage/lcov.info", "x\n");
		await writeRepoFile(root, "src/app.ts", "export const x = 1;\n");
		const rules = await readPrdfyIgnore(root);
		const scan = await scanRepository(root, rules);
		expect(scan.files.map((f) => f.path)).toEqual(["src/app.ts"]);
		const paths = excludedPaths(scan);
		expect(paths).toContain(".git/HEAD");
		expect(paths).toContain("node_modules/pkg/index.js");
		expect(paths).toContain("dist/bundle.js");
		expect(paths).toContain("build/out.js");
		expect(paths).toContain("coverage/lcov.info");
	});

	it("applies .prdfyignore custom exclusions", async () => {
		const root = await makeTempRoot();
		await writeRepoFile(root, "internal/notes.md", "notes\n");
		await writeRepoFile(root, "debug.log", "log\n");
		await writeRepoFile(root, "src/app.ts", "export const x = 1;\n");
		await writeFile(join(root, ".prdfyignore"), "internal/\n*.log\n", "utf-8");
		const rules = await readPrdfyIgnore(root);
		const scan = await scanRepository(root, rules);
		expect(scan.files.map((f) => f.path)).toEqual(["src/app.ts"]);
		expect(excludedPaths(scan)).toContain("internal/notes.md");
		expect(excludedPaths(scan)).toContain("debug.log");
	});

	it("returns repository-relative forward-slash paths and rejects escapes", async () => {
		const root = await makeTempRoot();
		await writeRepoFile(root, "src/nested/app.ts", "export const x = 1;\n");
		const rules = await readPrdfyIgnore(root);
		const scan = await scanRepository(root, rules);
		for (const file of scan.files) {
			expect(file.path).not.toContain("\\");
			expect(file.path).not.toContain("..");
			expect(file.path.startsWith("/")).toBe(false);
		}
		expect(scan.files.map((f) => f.path)).toContain("src/nested/app.ts");
	});

	it("excludes symlinks that resolve outside the repository root", async () => {
		const root = await makeTempRoot();
		const outside = await makeTempRoot();
		await writeFile(join(outside, "secret.txt"), "outside\n", "utf-8");
		await writeRepoFile(root, "src/app.ts", "export const x = 1;\n");
		try {
			await symlink(join(outside, "secret.txt"), join(root, "link-out.txt"));
		} catch {
			// Windows without developer mode cannot create symlinks; skip.
			return;
		}
		const rules = await readPrdfyIgnore(root);
		const scan = await scanRepository(root, rules);
		expect(scan.files.map((f) => f.path)).toEqual(["src/app.ts"]);
		expect(excludedPaths(scan)).toContain("link-out.txt");
	});

	it("exposes only repository-relative paths in scan output", async () => {
		const root = await makeTempRoot();
		await writeRepoFile(root, "src/app.ts", "export const x = 1;\n");
		const rules = await readPrdfyIgnore(root);
		const scan = await scanRepository(root, rules);
		for (const file of scan.files) {
			expect(file.path.startsWith("/")).toBe(false);
			expect(file.path).not.toContain(root);
			expect(file.path).not.toContain(":");
		}
		for (const entry of scan.excluded) {
			expect(entry.path.startsWith("/")).toBe(false);
			expect(entry.path).not.toContain(":");
			expect(entry).not.toHaveProperty("content");
		}
	});

	it("marks unreadable files as excluded instead of failing the scan", async () => {
		const root = await makeTempRoot();
		await writeRepoFile(root, "src/app.ts", "export const x = 1;\n");
		await writeRepoFile(root, "src/locked.ts", "export const y = 2;\n");
		const { chmod, readFile } = await import("node:fs/promises");
		await chmod(join(root, "src/locked.ts"), 0o000);
		try {
			// Privileged/Windows environments may still read the file; skip then.
			await readFile(join(root, "src/locked.ts"));
			return;
		} catch {
			// Expected on POSIX: file is genuinely unreadable.
		}
		const rules = await readPrdfyIgnore(root);
		const scan = await scanRepository(root, rules);
		expect(scan.files.map((f) => f.path)).toEqual(["src/app.ts"]);
		expect(excludedPaths(scan)).toContain("src/locked.ts");
	});
});
