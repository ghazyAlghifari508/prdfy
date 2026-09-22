/**
 * Pure billing-period logic for the monthly subscription model.
 *
 * ponytail: zero `@/db` imports here — this module runs in vitest without a
 * database and may be imported by any server module that needs to classify a
 * subscription row. DB access stays in credits.ts / payment-service.ts /
 * billing-emails.ts.
 *
 * Core rule (spec §5): access is a pure function of `now` vs
 * `current_period_end`. A NULL period on a paid row means legacy
 * grandfathering (one-time purchase, credits never expire). A NULL period on
 * a free row is rolled forward lazily by getCreditBalance.
 */
import { ADAPTIVE_CREDIT_PRICING, BILLING_PERIOD_DAYS } from "@/lib/constants";
import { PLAN_CREDITS, type Plan } from "@/types/database";

/** Minimal shape any caller's Drizzle select must provide. */
export interface SubscriptionRowLike {
	userId?: string | null;
	plan: string | null;
	status: string | null;
	credits: number | null;
	creditsUsed: number | null;
	creditsReserved?: number | null;
	currentPeriodStart: Date | null;
	currentPeriodEnd: Date | null;
	cancelledAt?: Date | null;
}

export type SubscriptionStateKind =
	| "free_active"
	| "legacy_grandfathered"
	| "active_paid"
	| "paused";

export interface EffectiveSubscription {
	state: SubscriptionStateKind;
	/** What FEATURES / rate-limit tiers should consult. */
	effectivePlan: Plan;
	/** Burnable credits right now. Forced 0 while paused (leftovers are forfeited). */
	remaining: number;
	currentPeriodEnd: Date | null;
}

export function normalizePlan(raw: string | null | undefined): Plan {
	return raw === "pro" || raw === "hengker" ? raw : "free";
}

/** Plain UTC-ms day math — periods are server-side UTC boundaries (spec §9). */
export function addDays(date: Date, days: number): Date {
	return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function resolveSubscriptionState(
	sub: SubscriptionRowLike | undefined,
	now: Date,
): EffectiveSubscription {
	const plan = normalizePlan(sub?.plan);
	const credits = sub?.credits ?? 0;
	const creditsUsed = sub?.creditsUsed ?? 0;
	const creditsReserved = sub?.creditsReserved ?? 0;
	const periodEnd = sub?.currentPeriodEnd ?? null;
	const leftover = Math.max(0, credits - creditsUsed - creditsReserved);

	if (
		!sub ||
		plan === "free" ||
		sub.cancelledAt != null ||
		(sub.status && sub.status !== "active")
	) {
		return {
			state: "free_active",
			effectivePlan: "free",
			remaining: leftover,
			currentPeriodEnd: periodEnd,
		};
	}

	// Legacy one-time purchase: no period columns ever written.
	if (periodEnd == null) {
		return {
			state: "legacy_grandfathered",
			effectivePlan: plan,
			remaining: leftover,
			currentPeriodEnd: null,
		};
	}

	if (now.getTime() <= periodEnd.getTime()) {
		return {
			state: "active_paid",
			effectivePlan: plan,
			remaining: leftover,
			currentPeriodEnd: periodEnd,
		};
	}

	// Expired without renewal: leftovers forfeited, generation blocked.
	return {
		state: "paused",
		effectivePlan: "free",
		remaining: 0,
		currentPeriodEnd: periodEnd,
	};
}

/** True when a free row needs its monthly allocation refreshed (write-on-read). */
export function isFreeRolloverDue(
	sub: SubscriptionRowLike | undefined,
	now: Date,
): boolean {
	if (!sub || normalizePlan(sub.plan) !== "free") return false;
	const end = sub.currentPeriodEnd;
	return end == null || end.getTime() < now.getTime();
}

export function computeFreeRolloverPeriod(now: Date): {
	start: Date;
	end: Date;
} {
	return { start: now, end: addDays(now, BILLING_PERIOD_DAYS) };
}

export function applyFreeRollover(params: {
	row: SubscriptionRowLike & { id: string; userId?: string };
	now: Date;
}): {
	updatedRow: SubscriptionRowLike & { id: string; userId?: string };
	ledgerEntry: {
		amount: number;
		entryType: "grant";
		sourceCategory: "system_grant";
		pricingVersion: typeof ADAPTIVE_CREDIT_PRICING.version;
		metadata: { reason: string };
	};
} | null {
	if (!isFreeRolloverDue(params.row, params.now)) return null;
	const period = computeFreeRolloverPeriod(params.now);
	return {
		updatedRow: {
			...params.row,
			credits: PLAN_CREDITS.free,
			creditsUsed: 0,
			creditsReserved: 0,
			currentPeriodStart: period.start,
			currentPeriodEnd: period.end,
		},
		ledgerEntry: {
			amount: PLAN_CREDITS.free,
			entryType: "grant",
			sourceCategory: "system_grant",
			pricingVersion: ADAPTIVE_CREDIT_PRICING.version,
			metadata: {
				reason: `free_rollover:${period.start.toISOString()}`,
			},
		},
	};
}

/**
 * Grant produced by a purchase/renewal (spec §6.1):
 * - fresh/paused purchase -> period starts now;
 * - early renewal         -> extends from the still-active period end;
 * - credits are SET, never additive (monthly model).
 */
export function computePurchaseGrant(params: {
	plan: Plan;
	now: Date;
	activePeriodEnd: Date | null;
}): { periodStart: Date; periodEnd: Date; credits: number } {
	const anchor =
		params.activePeriodEnd &&
		params.activePeriodEnd.getTime() > params.now.getTime()
			? params.activePeriodEnd
			: params.now;
	return {
		periodStart: params.now,
		periodEnd: addDays(anchor, BILLING_PERIOD_DAYS),
		credits: PLAN_CREDITS[params.plan],
	};
}

/**
 * Top-up purchase is exclusive to a paid plan that still holds a live credit
 * balance. Two paid shapes qualify:
 *
 * - `active_paid`: a running period — the classic mid-period case.
 * - `legacy_grandfathered`: a one-time purchase with no period columns. Its
 *   credits never expire, so running out of them is exactly when the user
 *   needs more; refusing here would force a pointless new subscription.
 *
 * `paused` is excluded: its leftover credits are forfeited, so selling more
 * would take money for credits the user cannot use. `free` has nothing to
 * top up into.
 */
export function canPurchaseTopUp(eff: EffectiveSubscription): boolean {
	return eff.state === "active_paid" || eff.state === "legacy_grandfathered";
}

/**
 * Whether the account should be offered a top-up instead of a new
 * subscription: a paid plan that has spent its whole allowance.
 *
 * This is the "Hengker credits exhausted" rule. The plan is still live, so
 * buying the same tier again would silently reset the period and forfeit the
 * remaining time — the user needs more credits, not a new subscription.
 */
export function shouldTopUpInsteadOfResubscribe(
	eff: EffectiveSubscription,
): boolean {
	if (!canPurchaseTopUp(eff)) return false;
	return eff.remaining <= 0;
}

/**
 * Remaining top-up allowance for the CURRENT period (anti-undercut cap):
 * plan allocation minus successful top-up credits this period. Clamps to 0
 * so over-cap histories can never enable another buy (spec §4).
 */
export function remainingTopUpQuota(params: {
	plan: Plan;
	usedThisPeriod: number;
}): number {
	return Math.max(0, PLAN_CREDITS[params.plan] - params.usedThisPeriod);
}
