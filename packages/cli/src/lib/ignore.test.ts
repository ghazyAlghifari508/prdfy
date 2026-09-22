import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ensurePrdfyIgnore,
	PRDFY_IGNORE_TEMPLATE,
	readPrdfyIgnore,
} from "./ignore.js";

async function makeTempRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "prdfy-ignore-test-"));
	return root;
}

describe("readPrdfyIgnore", () => {
	it("returns empty patterns when .prdfyignore is missing without creating it", async () => {
		const root = await makeTempRoot();
		const rules = await readPrdfyIgnore(root);
		expect(rules.root).toBe(root);
		expect(rules.patterns).toEqual([]);
		// Must not mutate the repository: no file created.
		await expect(stat(join(root, ".prdfyignore"))).rejects.toThrow();
	});

	it("parses custom patterns and ignores comments and blank lines", async () => {
		const root = await makeTempRoot();
		await writeFile(
			join(root, ".prdfyignore"),
			[
				"# custom exclusions",
				"",
				"custom-dir/",
				"*.log",
				"  secret-fixture.txt  ",
				"# trailing comment",
				"",
			].join("\n"),
			"utf-8",
		);
		const rules = await readPrdfyIgnore(root);
		expect(rules.patterns).toEqual([
			"custom-dir/",
			"*.log",
			"secret-fixture.txt",
		]);
	});

	it("reads existing rules without mutating the repository", async () => {
		const root = await makeTempRoot();
		const content = "custom-dir/\n*.log\n";
		const filePath = join(root, ".prdfyignore");
		await writeFile(filePath, content, "utf-8");
		const before = await stat(filePath);
		const rules = await readPrdfyIgnore(root);
		expect(rules.raw).toBe(content);
		const after = await readFile(filePath, "utf-8");
		expect(after).toBe(content);
		expect((await stat(filePath)).mtimeMs).toBe(before.mtimeMs);
	});

	it("treats negation rules as inert so user rules cannot lift built-in protection", async () => {
		const root = await makeTempRoot();
		await mkdir(join(root, "sub"), { recursive: true });
		await writeFile(
			join(root, ".prdfyignore"),
			"!.env\n!node_modules/\n",
			"utf-8",
		);
		const rules = await readPrdfyIgnore(root);
		// Negations are recorded but must never override secret/unsafe protection;
		// the scanner enforces built-ins independently of these patterns.
		expect(rules.patterns).toEqual([]);
		// They are reported instead of failing silently.
		expect(rules.droppedNegations).toEqual(["!.env", "!node_modules/"]);
	});
});

describe("ensurePrdfyIgnore", () => {
	it("creates .prdfyignore from the default template when missing", async () => {
		const root = await makeTempRoot();
		const result = await ensurePrdfyIgnore(root);
		expect(result.created).toBe(true);
		const content = await readFile(join(root, ".prdfyignore"), "utf-8");
		expect(content).toBe(PRDFY_IGNORE_TEMPLATE);
	});

	it("is idempotent and never overwrites existing user rules", async () => {
		const root = await makeTempRoot();
		const userRules = "internal/\n*.log\n";
		await writeFile(join(root, ".prdfyignore"), userRules, "utf-8");
		const before = await stat(join(root, ".prdfyignore"));

		const result = await ensurePrdfyIgnore(root);

		expect(result.created).toBe(false);
		expect(await readFile(join(root, ".prdfyignore"), "utf-8")).toBe(userRules);
		expect((await stat(join(root, ".prdfyignore"))).mtimeMs).toBe(
			before.mtimeMs,
		);
	});

	it("creates a template containing no active patterns", async () => {
		// Built-ins already cover secrets/build/binaries; an active pattern in
		// the seed file would silently change what gets uploaded.
		const root = await makeTempRoot();
		await ensurePrdfyIgnore(root);
		const rules = await readPrdfyIgnore(root);
		expect(rules.patterns).toEqual([]);
		expect(rules.droppedNegations).toEqual([]);
	});

	it("writes a template that is readable as custom rules when uncommented", async () => {
		const root = await makeTempRoot();
		await ensurePrdfyIgnore(root);
		const content = await readFile(join(root, ".prdfyignore"), "utf-8");
		// Documents the built-in coverage and shows example syntax.
		expect(content).toContain("node_modules/");
		expect(content).toContain(".env");
		expect(content).toContain("!...");
	});
});
