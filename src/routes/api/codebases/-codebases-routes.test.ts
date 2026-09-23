import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decideCodebaseDeletion } from "./$codebaseId";
import { CODEBASE_SESSION_ROUTE_PATH } from "./$codebaseId/session";

describe("codebase routes", () => {
	it("exposes the codebase-scoped session path", () => {
		expect(CODEBASE_SESSION_ROUTE_PATH).toBe(
			"/api/codebases/$codebaseId/session",
		);
	});
});

describe("decideCodebaseDeletion", () => {
	it("allows deletion when codebase has no active features", () => {
		expect(decideCodebaseDeletion({ featureCount: 0 })).toEqual({
			allow: true,
		});
	});

	it("blocks deletion with 409 when features exist and confirm is not true", () => {
		expect(decideCodebaseDeletion({ featureCount: 2 })).toEqual({
			allow: false,
			code: "CODEBASE_HAS_FEATURES",
		});
		expect(decideCodebaseDeletion({ featureCount: 1, confirm: false })).toEqual(
			{
				allow: false,
				code: "CODEBASE_HAS_FEATURES",
			},
		);
	});

	it("allows deletion when features exist and confirm is true", () => {
		expect(decideCodebaseDeletion({ featureCount: 3, confirm: true })).toEqual({
			allow: true,
		});
	});
});

describe("codebase deletion route contract", () => {
	const source = readFileSync(
		"src/routes/api/codebases/$codebaseId.ts",
		"utf8",
	);

	it("enforces user ownership and reuses purgeProjectArtifacts", () => {
		expect(source).toContain("requireUser");
		expect(source).toContain("purgeProjectArtifacts");
		expect(source).toContain("CODEBASE_HAS_FEATURES");
		expect(source).toContain("delete(codebases)");
		expect(source).toContain("deleted: true");
	});
});
