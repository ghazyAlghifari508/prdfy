import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decideCodebaseDeletion } from "./$codebaseId";
import { CODEBASE_SESSION_ROUTE_PATH } from "./$codebaseId/session";
import { validateCodebaseNameInput } from "./index";

describe("codebase routes", () => {
	it("exposes the codebase-scoped session path", () => {
		expect(CODEBASE_SESSION_ROUTE_PATH).toBe(
			"/api/codebases/$codebaseId/session",
		);
	});
});

describe("validateCodebaseNameInput", () => {
	it("rejects direct name shorter than 3 characters", () => {
		expect(validateCodebaseNameInput({ name: "ab" })).toEqual({
			ok: false,
			error: "Nama codebase harus diisi minimal 3 karakter",
		});
		expect(validateCodebaseNameInput({ name: "  a  " })).toEqual({
			ok: false,
			error: "Nama codebase harus diisi minimal 3 karakter",
		});
	});

	it("accepts valid direct name of 3 or more characters", () => {
		expect(validateCodebaseNameInput({ name: "my-repo" })).toEqual({
			ok: true,
			name: "my-repo",
		});
	});

	it("derives name from message if name is omitted", () => {
		expect(
			validateCodebaseNameInput({ message: "Buat fitur billing checkout" }),
		).toMatchObject({
			ok: true,
		});
	});

	it("rejects when both name and message are missing or too short", () => {
		expect(validateCodebaseNameInput(null)).toEqual({
			ok: false,
			error: "Nama codebase harus diisi minimal 3 karakter",
		});
		expect(validateCodebaseNameInput({ message: "hi" })).toEqual({
			ok: false,
			error: "Nama codebase harus diisi minimal 3 karakter",
		});
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
