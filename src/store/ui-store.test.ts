import { describe, expect, it } from "vitest";
import { useUIStore } from "./index";

describe("useUIStore paywall modal actions", () => {
	it("opens and closes paywall modal with stage", () => {
		useUIStore.getState().openPaywallModal("ac");
		expect(useUIStore.getState().isPaywallOpen).toBe(true);
		expect(useUIStore.getState().paywallStage).toBe("ac");

		useUIStore.getState().closePaywallModal();
		expect(useUIStore.getState().isPaywallOpen).toBe(false);
		expect(useUIStore.getState().paywallStage).toBe(null);
	});

	it("defaults stage to ac when called without arguments", () => {
		useUIStore.getState().openPaywallModal();
		expect(useUIStore.getState().isPaywallOpen).toBe(true);
		expect(useUIStore.getState().paywallStage).toBe("ac");

		useUIStore.getState().closePaywallModal();
		expect(useUIStore.getState().isPaywallOpen).toBe(false);
		expect(useUIStore.getState().paywallStage).toBe(null);
	});
});
