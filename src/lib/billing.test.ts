import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ADAPTIVE_CREDIT_PRICING } from "@/lib/constants";
import { PLAN_CREDITS } from "@/types/database";
import {
	addDays,
	applyFreeRollover,
	canPurchaseTopUp,
	computeFreeRolloverPeriod,
	computePurchaseGrant,
	isFreeRolloverDue,
	remainingTopUpQuota,
	resolveSubscriptionState,
	type SubscriptionRowLike,
} from "./billing";

const NOW = new Date("2026-08-25T00:00:00Z");

function row(
	overrides: Partial<SubscriptionRowLike> = {},
): SubscriptionRowLike {
	return {
		plan: "pro",
		status: "active",
		credits: 30,
		creditsUsed: 5,
		currentPeriodStart: addDays(NOW, -10),
		currentPeriodEnd: addDays(NOW, 20),
		cancelledAt: null,
		...overrides,
	};
}

describe("resolveSubscriptionState", () => {
	it("undefined row -> free_active with zero credits", () => {
		const eff = resolveSubscriptionState(undefined, NOW);
		expect(eff.state).toBe("free_active");
		expect(eff.effectivePlan).toBe("free");
		expect(eff.remaining).toBe(0);
	});

	it("free row -> free_active with prorated remaining", () => {
		const eff = resolveSubscriptionState(
			row({ plan: "free", credits: 2, creditsUsed: 1 }),
			NOW,
		);
		expect(eff.state).toBe("free_active");
		expect(eff.effectivePlan).toBe("free");
		expect(eff.remaining).toBe(1);
	});

	it("cancelled row -> treated as free_active", () => {
		const eff = resolveSubscriptionState(row({ cancelledAt: NOW }), NOW);
		expect(eff.state).toBe("free_active");
		expect(eff.effectivePlan).toBe("free");
	});

	it("paid row with NULL period -> legacy_grandfathered (never expires)", () => {
		const eff = resolveSubscriptionState(row({ currentPeriodEnd: null }), NOW);
		expect(eff.state).toBe("legacy_grandfathered");
		expect(eff.effectivePlan).toBe("pro");
		expect(eff.remaining).toBe(25);
	});

	it("paid row within period -> active_paid", () => {
		const eff = resolveSubscriptionState(row(), NOW);
		expect(eff.state).toBe("active_paid");
		expect(eff.effectivePlan).toBe("pro");
		expect(eff.remaining).toBe(25);
	});

	it("boundary: now === period_end is still active (inclusive)", () => {
		const eff = resolveSubscriptionState(
			row({ currentPeriodEnd: new Date(NOW) }),
			NOW,
		);
		expect(eff.state).toBe("active_paid");
	});

	it("expired paid row -> paused: effectivePlan free, remaining forced 0", () => {
		const eff = resolveSubscriptionState(
			row({ currentPeriodEnd: addDays(NOW, -3) }),
			NOW,
		);
		expect(eff.state).toBe("paused");
		expect(eff.effectivePlan).toBe("free");
		expect(eff.remaining).toBe(0);
	});

	it("unknown plan string normalizes to free", () => {
		const eff = resolveSubscriptionState(row({ plan: "vip" }), NOW);
		expect(eff.state).toBe("free_active");
	});
});

describe("isFreeRolloverDue", () => {
	it("true for free row without period (legacy)", () => {
		expect(
			isFreeRolloverDue(row({ plan: "free", currentPeriodEnd: null }), NOW),
		).toBe(true);
	});

	it("true for free row with expired period", () => {
		expect(
			isFreeRolloverDue(
				row({ plan: "free", currentPeriodEnd: addDays(NOW, -1) }),
				NOW,
			),
		).toBe(true);
	});

	it("false for free row with active period", () => {
		expect(
			isFreeRolloverDue(
				row({ plan: "free", currentPeriodEnd: addDays(NOW, 5) }),
				NOW,
			),
		).toBe(false);
	});

	it("false for paid rows even when expired", () => {
		expect(
			isFreeRolloverDue(row({ currentPeriodEnd: addDays(NOW, -5) }), NOW),
		).toBe(false);
	});
});

describe("computeFreeRolloverPeriod", () => {
	it("spans exactly BILLING_PERIOD_DAYS from now", () => {
		const p = computeFreeRolloverPeriod(NOW);
		expect(p.end.getTime() - p.start.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
		expect(p.start.getTime()).toBe(NOW.getTime());
	});
});

describe("computePurchaseGrant", () => {
	it("fresh purchase starts now", () => {
		const g = computePurchaseGrant({
			plan: "pro",
			now: NOW,
			activePeriodEnd: null,
		});
		expect(g.credits).toBe(30);
		expect(g.periodStart.getTime()).toBe(NOW.getTime());
		expect(g.periodEnd.getTime()).toBe(addDays(NOW, 30).getTime());
	});

	it("early renewal extends from current period end (additive)", () => {
		const futureEnd = addDays(NOW, 20);
		const g = computePurchaseGrant({
			plan: "hengker",
			now: NOW,
			activePeriodEnd: futureEnd,
		});
		expect(g.credits).toBe(105);
		expect(g.periodEnd.getTime()).toBe(addDays(futureEnd, 30).getTime());
	});

	it("renewal while paused/expired starts now", () => {
		const pastEnd = addDays(NOW, -4);
		const g = computePurchaseGrant({
			plan: "pro",
			now: NOW,
			activePeriodEnd: pastEnd,
		});
		expect(g.periodEnd.getTime()).toBe(addDays(NOW, 30).getTime());
	});
});

describe("addDays", () => {
	it("adds calendar-equivalent days in UTC ms", () => {
		expect(addDays(new Date("2026-01-01T00:00:00Z"), 2).toISOString()).toBe(
			"2026-01-03T00:00:00.000Z",
		);
	});
});

describe("canPurchaseTopUp", () => {
	it("true only for active_paid", () => {
		expect(canPurchaseTopUp(resolveSubscriptionState(row(), NOW))).toBe(true);
	});

	it("false for paused (expired period)", () => {
		const eff = resolveSubscriptionState(
			row({ currentPeriodEnd: addDays(NOW, -3) }),
			NOW,
		);
		expect(canPurchaseTopUp(eff)).toBe(false);
	});

	it("false for legacy_grandfathered (no running period)", () => {
		const eff = resolveSubscriptionState(row({ currentPeriodEnd: null }), NOW);
		expect(canPurchaseTopUp(eff)).toBe(false);
	});

	it("false for free_active, including cancelled paid rows", () => {
		expect(
			canPurchaseTopUp(resolveSubscriptionState(row({ plan: "free" }), NOW)),
		).toBe(false);
		expect(
			canPurchaseTopUp(
				resolveSubscriptionState(row({ cancelledAt: NOW }), NOW),
			),
		).toBe(false);
	});
});

describe("remainingTopUpQuota", () => {
	it("returns full allocation when nothing used this period", () => {
		expect(remainingTopUpQuota({ plan: "pro", usedThisPeriod: 0 })).toBe(30);
	});

	it("subtracts partial usage (hengker)", () => {
		expect(remainingTopUpQuota({ plan: "hengker", usedThisPeriod: 45 })).toBe(
			60,
		);
	});

	it("returns 0 when cap reached exactly", () => {
		expect(remainingTopUpQuota({ plan: "pro", usedThisPeriod: 30 })).toBe(0);
	});

	it("clamps over-cap history to 0, never negative", () => {
		expect(remainingTopUpQuota({ plan: "pro", usedThisPeriod: 45 })).toBe(0);
	});
});

describe("resolveSubscriptionState with creditsReserved", () => {
	it("deducts active reservations from remaining credits", () => {
		const eff = resolveSubscriptionState(
			row({ credits: 30, creditsUsed: 5, creditsReserved: 4 }),
			NOW,
		);
		expect(eff.state).toBe("active_paid");
		expect(eff.remaining).toBe(21);
	});

	it("clamps remaining credits to 0 when reservation and usage equal or exceed credits", () => {
		const eff = resolveSubscriptionState(
			row({ credits: 30, creditsUsed: 20, creditsReserved: 15 }),
			NOW,
		);
		expect(eff.remaining).toBe(0);
	});

	it("paused subscription remains 0 remaining regardless of creditsReserved", () => {
		const eff = resolveSubscriptionState(
			row({
				currentPeriodEnd: addDays(NOW, -3),
				credits: 30,
				creditsUsed: 5,
				creditsReserved: 2,
			}),
			NOW,
		);
		expect(eff.state).toBe("paused");
		expect(eff.remaining).toBe(0);
	});
});

describe("applyFreeRollover", () => {
	it("resets creditsReserved to 0 and records grant when rollover is due", () => {
		const freeRow = {
			id: "sub-free-1",
			userId: "user-free-1",
			plan: "free",
			status: "active",
			credits: 2,
			creditsUsed: 2,
			creditsReserved: 1,
			currentPeriodStart: addDays(NOW, -35),
			currentPeriodEnd: addDays(NOW, -5),
		};

		const result = applyFreeRollover({ row: freeRow, now: NOW });
		expect(result).not.toBeNull();
		if (!result) throw new Error("Expected rollover to be due");

		expect(result.updatedRow.credits).toBe(PLAN_CREDITS.free);
		expect(result.updatedRow.creditsUsed).toBe(0);
		expect(result.updatedRow.creditsReserved).toBe(0);
		expect(result.updatedRow.currentPeriodStart?.getTime()).toBe(NOW.getTime());

		expect(result.ledgerEntry).toEqual({
			amount: PLAN_CREDITS.free,
			entryType: "grant",
			sourceCategory: "system_grant",
			pricingVersion: ADAPTIVE_CREDIT_PRICING.version,
			metadata: {
				reason: `free_rollover:${NOW.toISOString()}`,
			},
		});
	});

	it("returns null when rollover is not due", () => {
		const activeFreeRow = {
			id: "sub-free-active",
			userId: "user-free-active",
			plan: "free",
			status: "active",
			credits: 2,
			creditsUsed: 1,
			creditsReserved: 0,
			currentPeriodStart: addDays(NOW, -5),
			currentPeriodEnd: addDays(NOW, 25),
		};

		const result = applyFreeRollover({ row: activeFreeRow, now: NOW });
		expect(result).toBeNull();
	});
});

describe("credits.ts database contract", () => {
	it("ensures rollOverFreeIfNeeded resets creditsReserved and inserts ledger grant", async () => {
		const creditsSource = await readFile(
			new URL("./credits.ts", import.meta.url),
			"utf8",
		);

		expect(creditsSource).toContain("creditsReserved: 0");
		expect(creditsSource).toMatch(
			/creditLedgerEntries[\s\S]*?entryType:\s*"grant"[\s\S]*?sourceCategory:\s*"system_grant"[\s\S]*?free_rollover:/,
		);
	});
});
