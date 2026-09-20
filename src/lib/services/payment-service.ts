/**
 * Midtrans payment application - server-only DB logic.
 *
 * ponytail: split out of app/actions/payment.ts because that module is imported
 * by the client pricing-card (for the syncPaymentStatus server fn). Plain server
 * helpers here import `db` (→ pg → Buffer) which crashes the browser bundle.
 * Keep all db/Buffer-touching code out of any module a client component imports.
 *
 * Credit model: monthly subscription. A plan purchase SETS the plan's credit
 * allocation and (re)writes the billing period via computePurchaseGrant
 * (lib/billing.ts). A top-up order (payments.plan === TOPUP_SKU.id) instead
 * ADDS credits to the same pool and never touches plan/period columns.
 * Rows whose current_period_end stays NULL are legacy one-time purchases
 * honored until their credits run out.
 */
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { computePurchaseGrant, resolveSubscriptionState } from "@/lib/billing";
import { ADAPTIVE_CREDIT_PRICING, TOPUP_SKU } from "@/lib/constants";
import { prdFyPlans } from "@/lib/pricing-data";
import type { Plan } from "@/types/database";

export interface PaymentRow {
	orderId: string;
	userId: string;
	amount: number | null;
	plan: string | null;
	status: string | null;
	midtransResponse?: unknown;
	createdAt?: Date;
	updatedAt?: Date;
}

export interface PaymentSubscriptionRow {
	id: string;
	userId: string;
	plan: string | null;
	status: string | null;
	credits: number | null;
	creditsUsed: number | null;
	creditsReserved: number | null;
	currentPeriodStart: Date | null;
	currentPeriodEnd: Date | null;
	cancelledAt?: Date | null;
	reminderCount: number;
	midtransOrderId?: string | null;
	createdAt?: Date;
	updatedAt?: Date;
}

export interface PaymentLedgerEntry {
	id: string;
	userId: string;
	operationId: string | null;
	amount: number;
	entryType: "grant";
	sourceCategory: "system_grant";
	pricingVersion: string;
	metadata: { reason: string };
	createdAt: Date;
}

export interface PaymentServiceStore {
	payments: Map<string, PaymentRow>;
	subscriptions: PaymentSubscriptionRow[];
	ledger: PaymentLedgerEntry[];
}

export function createPaymentService(store: PaymentServiceStore) {
	return {
		applyPaymentSuccess(orderId: string): { plan: Plan } | null {
			const payment = store.payments.get(orderId);
			if (!payment) return null;
			if (payment.status === "success") return { plan: payment.plan as Plan };

			const plan = planFromAmount(payment.amount ?? 0);
			const now = new Date();

			const userSubs = store.subscriptions
				.filter((s) => s.userId === payment.userId)
				.sort(
					(a, b) =>
						(b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
				);
			const existingSub = userSubs[0];

			const grant = computePurchaseGrant({
				plan,
				now,
				activePeriodEnd: existingSub?.currentPeriodEnd ?? null,
			});

			if (existingSub) {
				existingSub.plan = plan;
				existingSub.status = "active";
				existingSub.midtransOrderId = orderId;
				existingSub.credits = grant.credits;
				existingSub.creditsUsed = 0;
				existingSub.creditsReserved = 0;
				existingSub.currentPeriodStart = grant.periodStart;
				existingSub.currentPeriodEnd = grant.periodEnd;
				existingSub.cancelledAt = null;
				existingSub.reminderCount = 0;
				existingSub.updatedAt = now;
			} else {
				store.subscriptions.push({
					id: crypto.randomUUID(),
					userId: payment.userId,
					plan,
					status: "active",
					midtransOrderId: orderId,
					credits: grant.credits,
					creditsUsed: 0,
					creditsReserved: 0,
					currentPeriodStart: grant.periodStart,
					currentPeriodEnd: grant.periodEnd,
					reminderCount: 0,
					createdAt: now,
					updatedAt: now,
				});
			}

			store.ledger.push({
				id: crypto.randomUUID(),
				userId: payment.userId,
				operationId: null,
				amount: grant.credits,
				entryType: "grant",
				sourceCategory: "system_grant",
				pricingVersion: ADAPTIVE_CREDIT_PRICING.version,
				metadata: { reason: `payment_order:${orderId}` },
				createdAt: now,
			});

			payment.status = "success";
			payment.updatedAt = now;
			return { plan };
		},

		applyTopUpSuccess(orderId: string): { plan: Plan } | null {
			const payment = store.payments.get(orderId);
			if (!payment) return null;

			const userSubs = store.subscriptions
				.filter((s) => s.userId === payment.userId)
				.sort(
					(a, b) =>
						(b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
				);
			const sub = userSubs[0];

			if (payment.status === "success") {
				return { plan: (sub?.plan ?? "pro") as Plan };
			}

			if (
				payment.plan !== TOPUP_SKU.id ||
				payment.amount !== TOPUP_SKU.priceIdr
			)
				return null;

			const now = new Date();
			const eff = resolveSubscriptionState(sub, now);
			if (eff.state !== "active_paid" || !sub) {
				payment.status = "failed";
				payment.midtransResponse = {
					...(typeof payment.midtransResponse === "object" &&
					payment.midtransResponse !== null
						? payment.midtransResponse
						: {}),
					topupRejected: "not_active_paid",
				};
				payment.updatedAt = now;
				return null;
			}

			sub.credits = (sub.credits ?? 0) + TOPUP_SKU.credits;
			sub.updatedAt = now;

			store.ledger.push({
				id: crypto.randomUUID(),
				userId: payment.userId,
				operationId: null,
				amount: TOPUP_SKU.credits,
				entryType: "grant",
				sourceCategory: "system_grant",
				pricingVersion: ADAPTIVE_CREDIT_PRICING.version,
				metadata: { reason: `topup_order:${orderId}` },
				createdAt: now,
			});

			payment.status = "success";
			payment.updatedAt = now;
			return { plan: (sub.plan ?? "pro") as Plan };
		},

		applyOrderSuccess(orderId: string): { plan: Plan } | null {
			const payment = store.payments.get(orderId);
			if (!payment) return this.applyPaymentSuccess(orderId);
			return isTopUpOrder(payment.plan)
				? this.applyTopUpSuccess(orderId)
				: this.applyPaymentSuccess(orderId);
		},
	};
}

export function planFromAmount(amount: number): Plan {
	const tier = prdFyPlans.find((p) => p.id !== "free" && p.price === amount);
	// ponytail: fail loudly on unknown amount rather than misclassify the plan.
	if (!tier)
		throw new Error(`Payment amount ${amount} does not match any plan price`);
	return tier.id;
}

export function creditsForPlan(plan: Plan): number {
	return prdFyPlans.find((p) => p.id === plan)?.credits ?? 0;
}

/** Routing discriminator (spec §3): key off the stored SKU, not order prefixes. */
export function isTopUpOrder(planValue: string | null | undefined): boolean {
	return planValue === TOPUP_SKU.id;
}

/**
 * Total successful top-up credits bought within the CURRENT billing period
 * (spec §4 anti-undercut cap). Returns 0 when there is no bounded period
 * (missing sub row or NULL bounds — e.g. legacy grandfathered).
 */
export async function getTopUpCreditsUsedThisPeriod(
	userId: string,
): Promise<number> {
	const { db } = await import("@/db");
	const { payments, subscriptions } = await import("@/db/schema");

	const [sub] = await db
		.select({
			start: subscriptions.currentPeriodStart,
			end: subscriptions.currentPeriodEnd,
		})
		.from(subscriptions)
		.where(eq(subscriptions.userId, userId))
		.orderBy(desc(subscriptions.createdAt))
		.limit(1);
	if (!sub?.start || !sub?.end) return 0;

	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(payments)
		.where(
			and(
				eq(payments.userId, userId),
				eq(payments.status, "success"),
				eq(payments.plan, TOPUP_SKU.id),
				gte(payments.createdAt, sub.start),
				lte(payments.createdAt, sub.end),
			),
		);
	return (row?.n ?? 0) * TOPUP_SKU.credits;
}

/**
 * Grants credits after Midtrans confirms. Idempotent: bails if already success.
 * Called by syncPaymentStatus + payments/webhook.
 */
export async function applyPaymentSuccess(orderId: string) {
	const { db } = await import("@/db");
	const { creditLedgerEntries, payments, subscriptions } = await import(
		"@/db/schema"
	);

	return db.transaction(async (tx) => {
		// Row lock: a second concurrent call for the same orderId BLOCKS here
		// until the first transaction commits, then re-reads status === success
		// and returns early instead of granting a second time.
		const [payment] = await tx
			.select()
			.from(payments)
			.where(eq(payments.orderId, orderId))
			.for("update")
			.limit(1);
		if (!payment) return null;
		if (payment.status === "success") return { plan: payment.plan as Plan };

		const plan = planFromAmount(payment.amount ?? 0);
		const now = new Date();

		// Re-read the CURRENT period end so an early renewal extends from the
		// still-active period instead of overlapping it (spec §6.1).
		const [existingSub] = await tx
			.select({
				id: subscriptions.id,
				currentPeriodEnd: subscriptions.currentPeriodEnd,
			})
			.from(subscriptions)
			.where(eq(subscriptions.userId, payment.userId))
			.orderBy(desc(subscriptions.createdAt))
			.limit(1);

		const grant = computePurchaseGrant({
			plan,
			now,
			activePeriodEnd: existingSub?.currentPeriodEnd ?? null,
		});

		if (existingSub) {
			await tx
				.update(subscriptions)
				.set({
					plan,
					status: "active",
					midtransOrderId: orderId,
					credits: grant.credits,
					creditsUsed: 0,
					creditsReserved: 0,
					currentPeriodStart: grant.periodStart,
					currentPeriodEnd: grant.periodEnd,
					cancelledAt: null,
					reminderCount: 0,
					updatedAt: now,
				})
				.where(eq(subscriptions.id, existingSub.id));
		} else {
			await tx.insert(subscriptions).values({
				id: crypto.randomUUID(),
				userId: payment.userId,
				plan,
				status: "active",
				midtransOrderId: orderId,
				credits: grant.credits,
				creditsUsed: 0,
				creditsReserved: 0,
				currentPeriodStart: grant.periodStart,
				currentPeriodEnd: grant.periodEnd,
				reminderCount: 0,
			});
		}

		await tx.insert(creditLedgerEntries).values({
			id: crypto.randomUUID(),
			userId: payment.userId,
			operationId: null,
			amount: grant.credits,
			entryType: "grant",
			sourceCategory: "system_grant",
			pricingVersion: ADAPTIVE_CREDIT_PRICING.version,
			metadata: { reason: `payment_order:${orderId}` },
		});

		// Mark success LAST so a retry re-runs the grant if it died mid-way.
		await tx
			.update(payments)
			.set({ status: "success", updatedAt: now })
			.where(eq(payments.orderId, orderId));
		return { plan };
	});
}

/**
 * Grants a top-up AFTER Midtrans confirms (spec §5.3). ADDITIVE: bumps
 * `credits` by TOPUP_SKU.credits and touches NOTHING else on the
 * subscription row (plan/status/period/cancelled_at/reminder_count stay).
 *
 * - Idempotent: FOR UPDATE + bail when already success (retry-safe).
 * - Strict eligibility AT GRANT TIME: if the effective state drifted away
 *   from active_paid while checkout was open (e.g. period expired seconds
 *   before the webhook), the grant is REJECTED, the payment is marked failed
 *   with a midtransResponse note, and money is refunded manually via the
 *   Midtrans dashboard (spec §9). Granting into a paused account would burn
 *   the buyer's money silently.
 * - Cap is enforced strictly at checkout creation, tolerantly here (spec
 *   §5.3 point 4): a paid order is always honored; worst-case race overshoot
 *   is one SKU.
 */
export async function applyTopUpSuccess(orderId: string) {
	const { db } = await import("@/db");
	const { creditLedgerEntries, payments, subscriptions } = await import(
		"@/db/schema"
	);

	return db.transaction(async (tx) => {
		const [payment] = await tx
			.select()
			.from(payments)
			.where(eq(payments.orderId, orderId))
			.for("update")
			.limit(1);
		if (!payment) return null;
		if (payment.status === "success") {
			// Idempotent replay: report the current effective plan so the
			// caller contract ({ plan }) matches applyPaymentSuccess.
			const [sub] = await tx
				.select({ plan: subscriptions.plan })
				.from(subscriptions)
				.where(eq(subscriptions.userId, payment.userId))
				.orderBy(desc(subscriptions.createdAt))
				.limit(1);
			return { plan: (sub?.plan ?? "pro") as Plan };
		}

		// Defensive: only genuine top-up orders may take this path.
		if (payment.plan !== TOPUP_SKU.id || payment.amount !== TOPUP_SKU.priceIdr)
			return null;

		const now = new Date();
		const [sub] = await tx
			.select({
				id: subscriptions.id,
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
			.where(eq(subscriptions.userId, payment.userId))
			.orderBy(desc(subscriptions.createdAt))
			.limit(1);

		const eff = resolveSubscriptionState(sub, now);
		if (eff.state !== "active_paid" || !sub) {
			await tx
				.update(payments)
				.set({
					status: "failed",
					midtransResponse: {
						...(typeof payment.midtransResponse === "object" &&
						payment.midtransResponse !== null
							? payment.midtransResponse
							: {}),
						topupRejected: "not_active_paid",
					},
					updatedAt: now,
				})
				.where(eq(payments.orderId, orderId));
			console.error(
				`[topup] grant rejected for ${orderId}: subscription state ${eff.state}`,
			);
			return null;
		}

		await tx
			.update(subscriptions)
			.set({
				credits: sql`${subscriptions.credits} + ${TOPUP_SKU.credits}`,
				updatedAt: now,
			})
			.where(eq(subscriptions.id, sub.id));

		await tx.insert(creditLedgerEntries).values({
			id: crypto.randomUUID(),
			userId: payment.userId,
			operationId: null,
			amount: TOPUP_SKU.credits,
			entryType: "grant",
			sourceCategory: "system_grant",
			pricingVersion: ADAPTIVE_CREDIT_PRICING.version,
			metadata: { reason: `topup_order:${orderId}` },
		});

		// Mark success LAST so a retry re-runs the grant if it died mid-way.
		await tx
			.update(payments)
			.set({ status: "success", updatedAt: now })
			.where(eq(payments.orderId, orderId));

		const [after] = await tx
			.select({ plan: subscriptions.plan })
			.from(subscriptions)
			.where(eq(subscriptions.userId, payment.userId))
			.orderBy(desc(subscriptions.createdAt))
			.limit(1);
		return { plan: (after?.plan ?? "pro") as Plan };
	});
}

/**
 * Single entry point for "money arrived, apply it" (spec §5.4). Routes by the
 * stored SKU so BOTH completion paths (payments webhook + syncPaymentStatus)
 * share one decision. Unknown orders fall through to the plan path, whose
 * planFromAmount throws loudly — same semantics as before this feature.
 */
export async function applyOrderSuccess(orderId: string) {
	const { db } = await import("@/db");
	const { payments } = await import("@/db/schema");
	const [row] = await db
		.select({ plan: payments.plan })
		.from(payments)
		.where(eq(payments.orderId, orderId))
		.limit(1);
	if (!row) return applyPaymentSuccess(orderId);
	return isTopUpOrder(row.plan)
		? applyTopUpSuccess(orderId)
		: applyPaymentSuccess(orderId);
}
