import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { canShowNavbarTopUp } from "./navbar-topup-helper";

describe("Navbar TopUp Integration Contract", () => {
	it("correctly identifies when to mount Top Up button in navbar", () => {
		expect(
			canShowNavbarTopUp({
				user: { id: "u1" },
				plan: "pro",
				topUpEligible: true,
			}),
		).toBe(true);
		expect(
			canShowNavbarTopUp({
				user: { id: "u1" },
				plan: "free",
				topUpEligible: false,
			}),
		).toBe(false);
	});

	it("integrates TopUpModal and top-up trigger button in navbar source", async () => {
		const source = await readFile(
			`${process.cwd()}/src/components/layout/navbar.tsx`,
			"utf8",
		);
		expect(source).toContain("TopUpModal");
		expect(source).toContain("canShowNavbarTopUp");
		expect(source).toContain("isTopUpOpen");
	});
});
