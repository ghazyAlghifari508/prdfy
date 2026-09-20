import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import {
	computeFreeRolloverPeriod,
	isFreeRolloverDue,
	resolveSubscriptionState,
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
	const [updated] = await db
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
			await db.insert(creditLedgerEntries).values({
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
	return row;
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
	};
}

export async function checkCredits(userId: string): Promise<{
	allowed: boolean;
	remaining: number;
	plan: Plan;
	subscriptionState: SubscriptionStateKind;
}> {
	const { plan, remaining, subscriptionState } = await getCreditBalance(userId);
	return { allowed: remaining > 0, remaining, plan, subscriptionState };
}

/**
 * Atomically burns one credit. Two predicates live in the WHERE clause so two
 * concurrent project creations cannot overdraw, AND an expired (paused)
 * subscription can never burn its forfeited leftovers mid-expiry:
 * `current_period_end IS NULL` keeps legacy one-time rows burning forever.
 *
 * Returns false when there was nothing left to burn.
 */
export async function consumeCredit(userId: string): Promise<boolean> {
	const [latest] = await db
		.select({ id: subscriptions.id })
		.from(subscriptions)
		.where(eq(subscriptions.userId, userId))
		.orderBy(desc(subscriptions.createdAt))
		.limit(1);
	if (!latest) return false;

	const rows = await db
		.update(subscriptions)
		.set({
			creditsUsed: sql`${subscriptions.creditsUsed} + 1`,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(subscriptions.id, latest.id),
				sql`${subscriptions.creditsUsed} < ${subscriptions.credits}`,
				sql`(${subscriptions.currentPeriodEnd} IS NULL OR ${subscriptions.currentPeriodEnd} >= now())`,
			),
		)
		.returning({ id: subscriptions.id });

	return rows.length > 0;
}
