import { describe, expect, it } from "vitest";
import { getPendingSyncPayloadKey } from "@/lib/codebase-sync";
import {
	decideHomePostCreationTarget,
	HOME_PROJECT_MODE_OPTIONS,
	shouldBlockProjectCreationOnCredits,
} from "./chat-input";

describe("HOME_PROJECT_MODE_OPTIONS", () => {
	it("offers Produk baru (greenfield) and Codebase existing (existing_codebase)", () => {
		expect(HOME_PROJECT_MODE_OPTIONS.map((option) => option.id)).toEqual([
			"greenfield",
			"existing_codebase",
		]);
	});

	it("labels the modes in Indonesian", () => {
		const labels = Object.fromEntries(
			HOME_PROJECT_MODE_OPTIONS.map((option) => [option.id, option.label]),
		);
		expect(labels.greenfield).toMatch(/produk baru/i);
		expect(labels.existing_codebase).toMatch(/codebase existing/i);
	});
});

describe("decideHomePostCreationTarget", () => {
	it("routes greenfield creation to /ask/$id", () => {
		expect(
			decideHomePostCreationTarget({ id: "proj-1", projectMode: "greenfield" }),
		).toEqual({ to: "/ask/$id", params: { id: "proj-1" } });
	});

	it("routes existing-codebase creation to /codebase/$id", () => {
		expect(
			decideHomePostCreationTarget({
				id: "proj-1",
				projectMode: "existing_codebase",
			}),
		).toEqual({ to: "/codebase/$id", params: { id: "proj-1" } });
	});

	it("keeps legacy responses without mode on the greenfield route", () => {
		expect(decideHomePostCreationTarget({ id: "proj-1" })).toEqual({
			to: "/ask/$id",
			params: { id: "proj-1" },
		});
		expect(
			decideHomePostCreationTarget({ id: "proj-1", projectMode: null }),
		).toEqual({ to: "/ask/$id", params: { id: "proj-1" } });
		expect(
			decideHomePostCreationTarget({ id: "proj-1", projectMode: "unknown" }),
		).toEqual({ to: "/ask/$id", params: { id: "proj-1" } });
	});
});

describe("shouldBlockProjectCreationOnCredits", () => {
	it("blocks when credits are exhausted", () => {
		expect(shouldBlockProjectCreationOnCredits(0)).toBe(true);
	});

	it("allows creation with remaining or unknown credits (server enforces)", () => {
		expect(shouldBlockProjectCreationOnCredits(5)).toBe(false);
		expect(shouldBlockProjectCreationOnCredits("unlimited")).toBe(false);
		expect(shouldBlockProjectCreationOnCredits(undefined)).toBe(false);
		expect(shouldBlockProjectCreationOnCredits(null)).toBe(false);
	});
});

describe("getPendingSyncPayloadKey", () => {
	it("scopes the pending payload key per project", () => {
		expect(getPendingSyncPayloadKey("proj-1")).toBe(
			"prdfy:sync-payload:proj-1",
		);
		expect(getPendingSyncPayloadKey("proj-2")).not.toBe(
			getPendingSyncPayloadKey("proj-1"),
		);
	});
});
