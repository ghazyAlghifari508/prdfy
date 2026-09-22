import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import {
	canPurchaseTopUp,
	computeFreeRolloverPeriod,
	isFreeRolloverDue,
	resolveSubscriptionState,
	shouldTopUpInsteadOfResubscribe,
	type SubscriptionRowLike,
	type SubscriptionStateKind,
} from "@/lib/billing";
import { ADAPTIVE_CREDIT_PRICING } from "@/lib/constants";
import { FEATURES, PLAN_CREDITS, type Plan } from "@/types/database";

/** Hot-path payload consumed by /api/user/plan, chat.ts, ac/task generate. */
export interface CreditBalance {
	plan: Plan;
	credits: number;
	creditsUsed: number;
	remaining: number;
	subscriptionState: SubscriptionStateKind;
	currentPeriodEnd: Date | null;
	/**
	 * Whether this account may buy a mid-period credit top-up. Derived from the
	 * billing rules so the UI never re-derives eligibility from raw state.
	 */
	topUpEligible: boolean;
	/**
	 * Paid plan whose allowance is fully spent. The UI must offer a top-up
	 * instead of another subscription, which would reset the running period.
	 */
	creditsExhausted: boolean;
}

/** AC / Task / Kanban access. Free tier is PRD-only. */
export function hasFullWorkflow(plan: Plan): boolean {
	return FEATURES[plan].fullWorkflow;
}

/**
 * Free-tier monthly refresh (spec §5.3): write-on-read, idempotent via the
 * predicate — two concurrent callers can only roll over once. Missed months
 * do not stack: one rollover jumps straight to a fresh period.
 */
export async function rollOverFreeIfNeeded(
	row: SubscriptionRowLike & { id: string; userId?: string },
	now: Date,
): Promise<SubscriptionRowLike & { id: string; userId?: string }> {
	if (!isFreeRolloverDue(row, now)) return row;
	const period = computeFreeRolloverPeriod(now);
	return db.transaction(async (tx) => {
		const [updated] = await tx
			.update(subscriptions)
			.set({
				currentPeriodStart: period.start,
				currentPeriodEnd: period.end,
				credits: PLAN_CREDITS.free,
				creditsUsed: 0,
				creditsReserved: 0,
				updatedAt: now,
			})
			.where(
				and(
					eq(subscriptions.id, row.id),
					or(
						isNull(subscriptions.currentPeriodEnd),
						lt(subscriptions.currentPeriodEnd, now),
					),
				),
			)
			.returning({
				id: subscriptions.id,
				userId: subscriptions.userId,
				plan: subscriptions.plan,
				status: subscriptions.status,
				credits: subscriptions.credits,
				creditsUsed: subscriptions.creditsUsed,
				creditsReserved: subscriptions.creditsReserved,
				currentPeriodStart: subscriptions.currentPeriodStart,
				currentPeriodEnd: subscriptions.currentPeriodEnd,
				cancelledAt: subscriptions.cancelledAt,
			});

		if (updated) {
			const targetUserId = row.userId ?? updated.userId;
			if (targetUserId) {
				const { creditLedgerEntries } = await import("@/db/schema");
				await tx.insert(creditLedgerEntries).values({
					id: crypto.randomUUID(),
					userId: targetUserId,
					operationId: null,
					amount: PLAN_CREDITS.free,
					entryType: "grant",
					sourceCategory: "system_grant",
					pricingVersion: ADAPTIVE_CREDIT_PRICING.version,
					metadata: {
						reason: `free_rollover:${period.start.toISOString()}`,
					},
				});
			}
			return updated;
		}
		// Lost the conditional-update race: another request already rolled
		// over. Re-read instead of returning the stale pre-race row, or the
		// caller decides from an outdated period/balance.
		const [fresh] = await db
			.select({
				id: subscriptions.id,
				userId: subscriptions.userId,
				plan: subscriptions.plan,
				status: subscriptions.status,
				credits: subscriptions.credits,
				creditsUsed: subscriptions.creditsUsed,
				creditsReserved: subscriptions.creditsReserved,
				currentPeriodStart: subscriptions.currentPeriodStart,
				currentPeriodEnd: subscriptions.currentPeriodEnd,
				cancelledAt: subscriptions.cancelledAt,
			})
			.from(subscriptions)
			.where(eq(subscriptions.id, row.id))
			.limit(1);
		return { ...row, ...(fresh ?? {}) };
	});
}

export async function getCreditBalance(userId: string): Promise<CreditBalance> {
	const [sub] = await db
		.select({
			id: subscriptions.id,
			userId: subscriptions.userId,
			plan: subscriptions.plan,
			status: subscriptions.status,
			credits: subscriptions.credits,
			creditsUsed: subscriptions.creditsUsed,
			creditsReserved: subscriptions.creditsReserved,
			currentPeriodStart: subscriptions.currentPeriodStart,
			currentPeriodEnd: subscriptions.currentPeriodEnd,
			cancelledAt: subscriptions.cancelledAt,
		})
		.from(subscriptions)
		.where(eq(subscriptions.userId, userId))
		.orderBy(desc(subscriptions.createdAt))
		.limit(1);

	// ponytail: fail closed - a missing row after the signup-seed hook means
	// something is wrong, not "give unlimited access".
	if (!sub) {
		return {
			plan: "free",
			credits: 0,
			creditsUsed: 0,
			remaining: 0,
			subscriptionState: "free_active",
			currentPeriodEnd: null,
			topUpEligible: false,
			creditsExhausted: false,
		};
	}

	const now = new Date();
	const row = await rollOverFreeIfNeeded(sub, now);
	const eff = resolveSubscriptionState(row, now);

	return {
		plan: eff.effectivePlan,
		credits: row.credits ?? 0,
		creditsUsed: row.creditsUsed ?? 0,
		remaining: eff.remaining,
		subscriptionState: eff.state,
		currentPeriodEnd: eff.currentPeriodEnd,
		topUpEligible: canPurchaseTopUp(eff),
		creditsExhausted: shouldTopUpInsteadOfResubscribe(eff),
	};
}

// NOTE: the legacy `checkCredits` / `consumeCredit` burn path was removed.
// It had no callers (all generation flows settle through credit-service
// operations) and its burn never refreshed an expired free allowance first,
// so a free user past period-end was wrongly rejected instead of rolled
// over. Deleting the dead path removes the flawed behavior entirely;
// `getCreditBalance` above remains the single read path and always rolls
// over before reporting.
