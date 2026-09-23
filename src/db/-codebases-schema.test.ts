import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
	codebaseSnapshots,
	codebaseSyncSessions,
	codebases,
	projects,
} from "./schema";

describe("codebases schema", () => {
	it("declares the expected columns", () => {
		const config = getTableConfig(codebases);
		expect(config.name).toBe("codebases");
		const columns = config.columns.map((column) => column.name).sort();
		expect(columns).toEqual(
			["created_at", "id", "name", "updated_at", "user_id"].sort(),
		);
	});

	it("indexes user_id", () => {
		const config = getTableConfig(codebases);
		expect(config.indexes.map((index) => index.config.name)).toContain(
			"codebases_user_id_idx",
		);
	});

	it("adds a nullable codebase_id to projects", () => {
		const config = getTableConfig(projects);
		const column = config.columns.find((c) => c.name === "codebase_id");
		expect(column).toBeDefined();
		expect(column?.notNull).toBe(false);
	});

	it("adds codebase_id to sync sessions and snapshots", () => {
		for (const table of [codebaseSyncSessions, codebaseSnapshots]) {
			const config = getTableConfig(table);
			expect(config.columns.some((c) => c.name === "codebase_id")).toBe(true);
		}
	});
});
