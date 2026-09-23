import { describe, expect, it } from "vitest";
import { canShowNavbarTopUp } from "./navbar-topup-helper";

describe("canShowNavbarTopUp", () => {
	it("returns false when user is not authenticated", () => {
		expect(
			canShowNavbarTopUp({
				user: null,
				plan: "pro",
				topUpEligible: true,
			}),
		).toBe(false);
	});

	it("returns false for free plan users", () => {
		expect(
			canShowNavbarTopUp({
				user: { id: "user-1" },
				plan: "free",
				topUpEligible: false,
			}),
		).toBe(false);
		expect(
			canShowNavbarTopUp({
				user: { id: "user-1" },
				plan: "free",
				topUpEligible: true,
			}),
		).toBe(false);
	});

	it("returns false when topUpEligible is false or undefined", () => {
		expect(
			canShowNavbarTopUp({
				user: { id: "user-1" },
				plan: "pro",
				topUpEligible: false,
			}),
		).toBe(false);
		expect(
			canShowNavbarTopUp({
				user: { id: "user-1" },
				plan: "pro",
				topUpEligible: undefined,
			}),
		).toBe(false);
	});

	it("returns true for paid active subscribers who are topUpEligible", () => {
		expect(
			canShowNavbarTopUp({
				user: { id: "user-1" },
				plan: "pro",
				topUpEligible: true,
			}),
		).toBe(true);
		expect(
			canShowNavbarTopUp({
				user: { id: "user-2" },
				plan: "hengker",
				topUpEligible: true,
			}),
		).toBe(true);
	});
});
