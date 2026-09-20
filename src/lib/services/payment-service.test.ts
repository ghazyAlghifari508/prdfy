import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ADAPTIVE_CREDIT_PRICING, TOPUP_SKU } from "@/lib/constants";
import {
	createPaymentService,
	creditsForPlan,
	isTopUpOrder,
	type PaymentServiceStore,
	planFromAmount,
} from "./payment-service";

describe("planFromAmount", () => {
	it("maps the Pro price to the pro plan", () => {
		expect(planFromAmount(49000)).toBe("pro");
	});

	it("maps the Hengker price to the hengker plan", () => {
		expect(planFromAmount(149000)).toBe("hengker");
	});

	it("throws on an amount matching no plan", () => {
		expect(() => planFromAmount(12345)).toThrow(
			/does not match any plan price/,
		);
	});
});

describe("creditsForPlan", () => {
	it("returns the tier credit grant", () => {
		expect(creditsForPlan("pro")).toBe(30);
		expect(creditsForPlan("hengker")).toBe(105);
	});
});

describe("monthly model price mapping (regression)", () => {
	it("still maps sandbox amounts to plans after the monthly rewrite", () => {
		expect(planFromAmount(49000)).toBe("pro");
		expect(planFromAmount(149000)).toBe("hengker");
		expect(creditsForPlan("pro")).toBe(30);
		expect(creditsForPlan("hengker")).toBe(105);
		expect(creditsForPlan("free")).toBe(2);
	});
});

describe("top-up order routing", () => {
	it("recognizes the top-up SKU id", () => {
		expect(isTopUpOrder(TOPUP_SKU.id)).toBe(true);
	});

	it("routes plan purchases and unknown values to the legacy path", () => {
		expect(isTopUpOrder("pro")).toBe(false);
		expect(isTopUpOrder("hengker")).toBe(false);
		expect(isTopUpOrder(null)).toBe(false);
		expect(isTopUpOrder(undefined)).toBe(false);
	});
});

describe("monthly mapper ignores top-up amounts (regression)", () => {
	it("throws for the top-up price so stray orders fail loudly upstream", () => {
		expect(() => planFromAmount(TOPUP_SKU.priceIdr)).toThrow(
			/does not match any plan price/,
		);
	});
});

function makePaymentStore(): PaymentServiceStore {
	return {
		payments: new Map([
			[
				"order-plan-1",
				{
					orderId: "order-plan-1",
					userId: "user-1",
					amount: 49000,
					plan: "pro",
					status: "pending",
					createdAt: new Date("2026-08-25T00:00:00.000Z"),
					updatedAt: new Date("2026-08-25T00:00:00.000Z"),
				},
			],
			[
				"order-topup-1",
				{
					orderId: "order-topup-1",
					userId: "user-1",
					amount: 20000,
					plan: TOPUP_SKU.id,
					status: "pending",
					createdAt: new Date("2026-08-25T00:00:00.000Z"),
					updatedAt: new Date("2026-08-25T00:00:00.000Z"),
				},
			],
			[
				"order-topup-paused",
				{
					orderId: "order-topup-paused",
					userId: "user-paused",
					amount: 20000,
					plan: TOPUP_SKU.id,
					status: "pending",
					createdAt: new Date("2026-08-25T00:00:00.000Z"),
					updatedAt: new Date("2026-08-25T00:00:00.000Z"),
				},
			],
		]),
		subscriptions: [
			{
				id: "sub-1",
				userId: "user-1",
				plan: "pro",
				status: "active",
				credits: 10,
				creditsUsed: 5,
				creditsReserved: 3,
				currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
				currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
				cancelledAt: null,
				reminderCount: 0,
				midtransOrderId: "prev-order",
				createdAt: new Date("2026-08-01T00:00:00.000Z"),
				updatedAt: new Date("2026-08-01T00:00:00.000Z"),
			},
			{
				id: "sub-paused",
				userId: "user-paused",
				plan: "pro",
				status: "active",
				credits: 30,
				creditsUsed: 10,
				creditsReserved: 0,
				currentPeriodStart: new Date("2020-01-01T00:00:00.000Z"),
				currentPeriodEnd: new Date("2020-02-01T00:00:00.000Z"),
				cancelledAt: null,
				reminderCount: 0,
				midtransOrderId: "old-order",
				createdAt: new Date("2026-07-01T00:00:00.000Z"),
				updatedAt: new Date("2026-07-01T00:00:00.000Z"),
			},
		],
		ledger: [],
	};
}

describe("payment service grant lifecycle (in-memory)", () => {
	it("plan grant creates exactly one ledger entry, sets credits, and resets creditsReserved to 0", () => {
		const store = makePaymentStore();
		const service = createPaymentService(store);

		const result = service.applyPaymentSuccess("order-plan-1");
		expect(result).toEqual({ plan: "pro" });

		const sub = store.subscriptions.find((s) => s.userId === "user-1");
		expect(sub?.credits).toBe(30);
		expect(sub?.creditsUsed).toBe(0);
		expect(sub?.creditsReserved).toBe(0);
		expect(sub?.status).toBe("active");

		expect(store.ledger).toHaveLength(1);
		const entry = store.ledger[0];
		expect(entry).toMatchObject({
			userId: "user-1",
			amount: 30,
			entryType: "grant",
			sourceCategory: "system_grant",
			pricingVersion: ADAPTIVE_CREDIT_PRICING.version,
			metadata: { reason: "payment_order:order-plan-1" },
		});
	});

	it("plan grant is completely idempotent on retry", () => {
		const store = makePaymentStore();
		const service = createPaymentService(store);

		service.applyPaymentSuccess("order-plan-1");
		expect(store.ledger).toHaveLength(1);

		const retryResult = service.applyPaymentSuccess("order-plan-1");
		expect(retryResult).toEqual({ plan: "pro" });
		expect(store.ledger).toHaveLength(1);
	});

	it("top-up grant increments credits by TOPUP_SKU.credits and appends exactly one ledger entry", () => {
		const store = makePaymentStore();
		const service = createPaymentService(store);

		const initialCredits = store.subscriptions[0].credits ?? 0;
		const initialReserved = store.subscriptions[0].creditsReserved;

		const result = service.applyTopUpSuccess("order-topup-1");
		expect(result).toEqual({ plan: "pro" });

		const sub = store.subscriptions.find((s) => s.userId === "user-1");
		expect(sub?.credits).toBe(initialCredits + TOPUP_SKU.credits);
		expect(sub?.creditsReserved).toBe(initialReserved);

		expect(store.ledger).toHaveLength(1);
		const entry = store.ledger[0];
		expect(entry).toMatchObject({
			userId: "user-1",
			amount: TOPUP_SKU.credits,
			entryType: "grant",
			sourceCategory: "system_grant",
			pricingVersion: ADAPTIVE_CREDIT_PRICING.version,
			metadata: { reason: "topup_order:order-topup-1" },
		});
	});

	it("top-up grant is completely idempotent on retry", () => {
		const store = makePaymentStore();
		const service = createPaymentService(store);

		service.applyTopUpSuccess("order-topup-1");
		const creditsAfterFirst = store.subscriptions[0].credits;
		expect(store.ledger).toHaveLength(1);

		const retryResult = service.applyTopUpSuccess("order-topup-1");
		expect(retryResult).toEqual({ plan: "pro" });
		expect(store.subscriptions[0].credits).toBe(creditsAfterFirst);
		expect(store.ledger).toHaveLength(1);
	});

	it("top-up grant rejects when subscription state is not active_paid", () => {
		const store = makePaymentStore();
		const service = createPaymentService(store);

		const result = service.applyTopUpSuccess("order-topup-paused");
		expect(result).toBeNull();

		const payment = store.payments.get("order-topup-paused");
		expect(payment?.status).toBe("failed");
		expect(payment?.midtransResponse).toEqual({
			topupRejected: "not_active_paid",
		});
		expect(store.ledger).toHaveLength(0);
	});
});

describe("payment service database contracts", () => {
	it("ensures applyPaymentSuccess resets creditsReserved and inserts ledger grant", async () => {
		const serviceSource = await readFile(
			new URL("./payment-service.ts", import.meta.url),
			"utf8",
		);
		expect(serviceSource).toContain("creditsReserved: 0");
		expect(serviceSource).toMatch(
			/creditLedgerEntries[\s\S]*?entryType:\s*"grant"[\s\S]*?sourceCategory:\s*"system_grant"[\s\S]*?payment_order:/,
		);
		expect(serviceSource).toMatch(
			/creditLedgerEntries[\s\S]*?entryType:\s*"grant"[\s\S]*?sourceCategory:\s*"system_grant"[\s\S]*?topup_order:/,
		);
	});

	it("validates opening balance backfill migration 0018 and journal", async () => {
		const migrationPath = new URL(
			"../../../drizzle/0018_opening_balance_backfill.sql",
			import.meta.url,
		);
		const journalPath = new URL(
			"../../../drizzle/meta/_journal.json",
			import.meta.url,
		);

		const migration = await readFile(migrationPath, "utf8");
		const journal = await readFile(journalPath, "utf8");

		expect(journal).toContain('"tag": "0018_opening_balance_backfill"');
		expect(migration).toContain('DISTINCT ON ("user_id")');
		expect(migration).toContain(
			'GREATEST(0, "credits" - "credits_used" - "credits_reserved")',
		);
		expect(migration).toContain("md5('opening_balance:' ||");
		expect(migration).toContain("'system_grant'");
		expect(migration).toContain("'2026-09-20'");
		expect(migration).toContain('\'{"reason":"opening_balance"}\'::jsonb');
		expect(migration).toContain("NOT EXISTS");
	});
});
