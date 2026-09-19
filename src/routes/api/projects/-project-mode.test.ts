import { describe, expect, it } from "vitest";
import { PROJECT_SYNC_CHILD_TABLES } from "./$id";
import { parseProjectModeInput } from "./index";

describe("parseProjectModeInput", () => {
	it("defaults missing mode to greenfield", () => {
		expect(parseProjectModeInput(undefined)).toBe("greenfield");
		expect(parseProjectModeInput(null)).toBe("greenfield");
	});

	it("accepts greenfield", () => {
		expect(parseProjectModeInput("greenfield")).toBe("greenfield");
	});

	it("accepts existing_codebase", () => {
		expect(parseProjectModeInput("existing_codebase")).toBe(
			"existing_codebase",
		);
	});

	it("rejects unknown modes", () => {
		expect(() => parseProjectModeInput("bogus")).toThrow(
			"INVALID_PROJECT_MODE",
		);
	});

	it("rejects empty and non-string modes", () => {
		expect(() => parseProjectModeInput("")).toThrow("INVALID_PROJECT_MODE");
		expect(() => parseProjectModeInput(123)).toThrow("INVALID_PROJECT_MODE");
	});
});

describe("PROJECT_SYNC_CHILD_TABLES", () => {
	it("enumerates every project-owned sync table exactly once", () => {
		expect([...PROJECT_SYNC_CHILD_TABLES].sort()).toEqual(
			[
				"codebase_analyses",
				"codebase_ask_handoffs",
				"codebase_generation_contexts",
				"codebase_snapshot_files",
				"codebase_snapshots",
				"codebase_sync_idempotency_keys",
				"codebase_sync_sessions",
			].sort(),
		);
	});

	it("orders deletes FK-safe: handoffs first, contexts before analyses/snapshots, files before snapshots, sessions last", () => {
		const order: string[] = [...PROJECT_SYNC_CHILD_TABLES];
		const indexOf = (name: string) => order.indexOf(name);
		// Ask handoffs carry no FK deps and go first.
		expect(indexOf("codebase_ask_handoffs")).toBeLessThan(
			indexOf("codebase_generation_contexts"),
		);
		// Generation contexts reference snapshots + analyses.
		expect(indexOf("codebase_generation_contexts")).toBeLessThan(
			indexOf("codebase_analyses"),
		);
		expect(indexOf("codebase_generation_contexts")).toBeLessThan(
			indexOf("codebase_snapshots"),
		);
		// Analyses and idempotency keys reference snapshots/sessions.
		expect(indexOf("codebase_analyses")).toBeLessThan(
			indexOf("codebase_snapshots"),
		);
		expect(indexOf("codebase_sync_idempotency_keys")).toBeLessThan(
			indexOf("codebase_snapshots"),
		);
		expect(indexOf("codebase_sync_idempotency_keys")).toBeLessThan(
			indexOf("codebase_sync_sessions"),
		);
		// Snapshot files reference snapshots; snapshots reference sessions.
		expect(indexOf("codebase_snapshot_files")).toBeLessThan(
			indexOf("codebase_snapshots"),
		);
		expect(indexOf("codebase_snapshots")).toBeLessThan(
			indexOf("codebase_sync_sessions"),
		);
	});
});
