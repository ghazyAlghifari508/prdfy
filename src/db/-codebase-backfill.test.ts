import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const drizzleDir = join(process.cwd(), "drizzle");

function backfillMigrationSql(): string {
	const file = readdirSync(drizzleDir).find((name) =>
		name.endsWith("_backfill_codebases.sql"),
	);
	if (!file) throw new Error("backfill migration not found");
	return readFileSync(join(drizzleDir, file), "utf8");
}

describe("codebase backfill migration", () => {
	it("creates one codebase per existing-codebase project", () => {
		const sql = backfillMigrationSql();
		expect(sql).toMatch(/INSERT INTO\s+"?codebases"?/i);
		expect(sql).toMatch(/project_mode\s*=\s*'existing_codebase'/i);
	});

	it("stamps codebase_id on projects, sessions, and snapshots", () => {
		const sql = backfillMigrationSql();
		expect(sql).toMatch(/UPDATE\s+"?projects"?/i);
		expect(sql).toMatch(/UPDATE\s+"?codebase_sync_sessions"?/i);
		expect(sql).toMatch(/UPDATE\s+"?codebase_snapshots"?/i);
	});

	it("is idempotent: it only fills rows where codebase_id is null", () => {
		const sql = backfillMigrationSql();
		const nullGuards = sql.match(/codebase_id IS NULL/gi) ?? [];
		expect(nullGuards.length).toBeGreaterThanOrEqual(3);
	});

	it("does not drop the legacy project_id columns", () => {
		const sql = backfillMigrationSql();
		expect(sql).not.toMatch(/DROP COLUMN/i);
	});
});
