import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRepositoryRoot } from "./repository.js";

async function makeTempRoot(): Promise<string> {
	// realpath because macOS/Windows temp dirs are symlinked; the walk-up
	// compares resolved paths.
	return await realpath(await mkdtemp(join(tmpdir(), "prdfy-root-test-")));
}

describe("resolveRepositoryRoot", () => {
	it("walks up to the nearest ancestor containing .git", async () => {
		const root = await makeTempRoot();
		await mkdir(join(root, ".git"), { recursive: true });
		const nested = join(root, "packages", "cli", "src");
		await mkdir(nested, { recursive: true });

		expect(await resolveRepositoryRoot(nested)).toBe(root);
		expect(await resolveRepositoryRoot(root)).toBe(root);
	});

	it("treats a .git file as a repository marker (worktrees, submodules)", async () => {
		const root = await makeTempRoot();
		await writeFile(join(root, ".git"), "gitdir: /elsewhere/.git\n", "utf-8");
		const nested = join(root, "app");
		await mkdir(nested, { recursive: true });

		expect(await resolveRepositoryRoot(nested)).toBe(root);
	});

	it("stops at the nearest marker, not the outermost one", async () => {
		const outer = await makeTempRoot();
		await mkdir(join(outer, ".git"), { recursive: true });
		const innerRepo = join(outer, "nested-repo");
		const innerNested = join(innerRepo, "src");
		await mkdir(join(innerRepo, ".git"), { recursive: true });
		await mkdir(innerNested, { recursive: true });

		expect(await resolveRepositoryRoot(innerNested)).toBe(innerRepo);
	});

	it("falls back to the start directory when no marker exists", async () => {
		const root = await makeTempRoot();
		const nested = join(root, "no-git", "here");
		await mkdir(nested, { recursive: true });

		expect(await resolveRepositoryRoot(nested)).toBe(nested);
	});

	it("lets an explicit --root win over detection", async () => {
		const root = await makeTempRoot();
		await mkdir(join(root, ".git"), { recursive: true });
		const elsewhere = await makeTempRoot();
		const nested = join(root, "src");
		await mkdir(nested, { recursive: true });

		expect(await resolveRepositoryRoot(nested, elsewhere)).toBe(elsewhere);
	});

	it("resolves a relative explicit root against the process cwd", async () => {
		const root = await makeTempRoot();
		const resolved = await resolveRepositoryRoot(root, ".");
		expect(resolved).toBe(process.cwd());
	});

	it("does not treat a directory merely named .git-adjacent as a marker", async () => {
		const root = await makeTempRoot();
		// `.gitignore` must not count; only the exact `.git` entry does.
		await writeFile(join(root, ".gitignore"), "node_modules\n", "utf-8");
		const nested = join(root, "src");
		await mkdir(nested, { recursive: true });

		expect(await resolveRepositoryRoot(nested)).toBe(nested);
	});

	it("keeps resolving when a parent entry is a symlink", async () => {
		const root = await makeTempRoot();
		await mkdir(join(root, ".git"), { recursive: true });
		const realSub = join(root, "real-sub");
		await mkdir(realSub, { recursive: true });
		const link = join(root, "link-sub");
		try {
			await symlink(realSub, link, "dir");
		} catch {
			return; // Symlink creation may require privileges (Windows).
		}

		expect(await resolveRepositoryRoot(link)).toBe(root);
	});
});
