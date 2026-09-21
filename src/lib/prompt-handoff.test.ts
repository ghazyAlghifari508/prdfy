import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	consumePendingPrdPrompt,
	consumeResumeIntent,
	getAskState,
	getOnboardingState,
	getPrdDraft,
	getSetupPrompt,
	savePrdDraft,
} from "./prompt-handoff";

function installMemoryStorage() {
	const store = new Map<string, string>();
	vi.stubGlobal("window", {
		sessionStorage: {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => {
				store.set(k, v);
			},
			removeItem: (k: string) => {
				store.delete(k);
			},
		},
	});
	return store;
}

describe("prompt-handoff storage trust boundary", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
		installMemoryStorage();
	});

	it("rejects tampered pending-prompt modes", () => {
		window.sessionStorage.setItem(
			"prdfy:prd-prompt",
			JSON.stringify({ prompt: "x", mode: "admin", createdAt: Date.now() }),
		);
		expect(consumePendingPrdPrompt()).toBeNull();
	});

	it("rejects future and non-finite timestamps", () => {
		window.sessionStorage.setItem(
			"prdfy:setup-prompt",
			JSON.stringify({ prompt: "x", createdAt: Date.now() + 3600_000 }),
		);
		expect(getSetupPrompt()).toBe("");
	});

	it("never writes __proto__ draft keys", () => {
		savePrdDraft("__proto__", "evil");
		expect(getPrdDraft("__proto__")).toBe("");
		expect(({} as Record<string, unknown>).draft).toBeUndefined();
	});

	it("rejects malformed ask state", () => {
		window.sessionStorage.setItem(
			"prdfy:ask-state",
			JSON.stringify({ projectId: "p1", session: 99 }),
		);
		expect(getAskState("p1")).toBeNull();
	});

	it("rejects out-of-range onboarding steps and wrong field types", () => {
		window.sessionStorage.setItem(
			"prdfy:onboarding-state",
			JSON.stringify({ step: 9, fullName: "A", role: "dev", goals: [] }),
		);
		expect(getOnboardingState()).toBeNull();
		window.sessionStorage.setItem(
			"prdfy:onboarding-state",
			JSON.stringify({ step: 1, fullName: 42, role: "dev", goals: [] }),
		);
		expect(getOnboardingState()).toBeNull();
	});

	it("rejects unknown resume stages", () => {
		window.sessionStorage.setItem(
			"prdfy:resume-intent",
			JSON.stringify({
				projectId: "p1",
				stage: "billing",
				createdAt: Date.now(),
			}),
		);
		expect(consumeResumeIntent("p1")).toBeNull();
	});
});
