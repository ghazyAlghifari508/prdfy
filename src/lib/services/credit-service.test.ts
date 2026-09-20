import { describe, expect, it } from "vitest";
import {
	type CreditServiceStore,
	createCreditService,
} from "@/lib/services/credit-service";

function makeStore(): CreditServiceStore {
	return {
		subscriptions: new Map([
			[
				"sub-1",
				{
					id: "sub-1",
					userId: "user-1",
					credits: 10,
					creditsUsed: 0,
					creditsReserved: 0,
					currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
				},
			],
		]),
		projects: new Map([["project-1", { id: "project-1", userId: "user-1" }]]),
		operations: new Map(),
		ledger: [],
	};
}

const quote = {
	operation: "prd_generation" as const,
	pricingVersion: "adaptive-v1" as const,
	estimatedCredits: 2,
	maximumCredits: 4,
	metrics: { promptChars: 100 },
};

describe("credit service lifecycle", () => {
	it("rejects a reservation when the maximum exceeds available balance", async () => {
		const store = makeStore();
		const subscription = store.subscriptions.get("sub-1");
		if (!subscription) throw new Error("Test subscription fixture is missing");
		subscription.credits = 3;
		const service = createCreditService(store);

		expect(() =>
			service.reserveCreditOperation({
				userId: "user-1",
				projectId: "project-1",
				stage: "prd",
				idempotencyKey: "request-1",
				quote,
			}),
		).toThrow("Insufficient available credit");
		expect(store.ledger).toHaveLength(0);
	});

	it("reserves the maximum exactly once for a duplicate idempotency key", async () => {
		const store = makeStore();
		const service = createCreditService(store);
		const input = {
			userId: "user-1",
			projectId: "project-1",
			stage: "prd" as const,
			idempotencyKey: "request-1",
			quote,
		};

		const first = await service.reserveCreditOperation(input);
		const second = await service.reserveCreditOperation(input);

		expect(second.id).toBe(first.id);
		expect(store.subscriptions.get("sub-1")?.creditsReserved).toBe(4);
		expect(
			store.ledger.filter((entry) => entry.entryType === "reservation"),
		).toHaveLength(1);
	});

	it("allows only one competing reservation to consume the available balance", async () => {
		const store = makeStore();
		const subscription = store.subscriptions.get("sub-1");
		if (!subscription) throw new Error("Test subscription fixture is missing");
		subscription.credits = 4;
		const service = createCreditService(store);
		const reserve = (idempotencyKey: string) =>
			Promise.resolve().then(() =>
				service.reserveCreditOperation({
					userId: "user-1",
					projectId: "project-1",
					stage: "prd",
					idempotencyKey,
					quote,
				}),
			);

		const results = await Promise.allSettled([
			reserve("request-1"),
			reserve("request-2"),
		]);

		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(store.subscriptions.get("sub-1")?.creditsReserved).toBe(4);
	});

	it("settles final charge and releases the unused reservation", async () => {
		const store = makeStore();
		const service = createCreditService(store);
		const operation = await service.reserveCreditOperation({
			userId: "user-1",
			projectId: "project-1",
			stage: "prd",
			idempotencyKey: "request-1",
			quote,
		});
		await service.markCreditOperationRunning({
			userId: "user-1",
			operationId: operation.id,
		});

		const settled = await service.settleCreditOperation({
			userId: "user-1",
			operationId: operation.id,
			finalCharge: 2,
			artifactReference: "prd-version-1",
			measuredUnits: 1.1,
		});

		expect(settled.state).toBe("settled");
		expect(store.subscriptions.get("sub-1")).toMatchObject({
			creditsUsed: 2,
			creditsReserved: 0,
		});
		expect(store.ledger.map((entry) => entry.entryType)).toEqual([
			"reservation",
			"release",
			"debit",
		]);
		expect(store.ledger.reduce((total, entry) => total + entry.amount, 0)).toBe(
			-4,
		);
		expect(() =>
			service.settleCreditOperation({
				userId: "user-1",
				operationId: operation.id,
				finalCharge: 2,
				artifactReference: "prd-version-1",
				measuredUnits: 1.1,
			}),
		).toThrow("active");
	});

	it("does not settle or release an unreserved quoted operation", () => {
		const store = makeStore();
		const service = createCreditService(store);
		const operation = {
			id: "quoted-1",
			userId: "user-1",
			projectId: "project-1",
			subscriptionId: "sub-1",
			kind: "prd_generation" as const,
			stage: "prd" as const,
			idempotencyKey: "quoted-key",
			state: "quoted" as const,
			estimatedCredits: 1,
			reservedCredits: 0,
			maximumCredits: 1,
			finalCharge: null,
			pricingVersion: "adaptive-v1" as const,
			metrics: {},
			capApplied: false,
			artifactReference: null,
			failureReason: null,
			expiresAt: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		store.operations.set(operation.id, operation);

		expect(() =>
			service.settleCreditOperation({
				userId: "user-1",
				operationId: operation.id,
				finalCharge: 1,
				artifactReference: "artifact-1",
				measuredUnits: 1,
			}),
		).toThrow("active");
		expect(() =>
			service.releaseCreditOperation({
				userId: "user-1",
				operationId: operation.id,
				reason: "invalid",
			}),
		).toThrow("active");
	});

	it("releases a failed operation without a final debit", async () => {
		const store = makeStore();
		const service = createCreditService(store);
		const operation = await service.reserveCreditOperation({
			userId: "user-1",
			projectId: "project-1",
			stage: "prd",
			idempotencyKey: "request-1",
			quote,
		});

		const released = await service.releaseCreditOperation({
			userId: "user-1",
			operationId: operation.id,
			reason: "provider_failure",
		});

		expect(released.state).toBe("released");
		expect(store.subscriptions.get("sub-1")).toMatchObject({
			creditsUsed: 0,
			creditsReserved: 0,
		});
		expect(store.ledger.map((entry) => entry.entryType)).toEqual([
			"reservation",
			"release",
		]);
	});

	it("rejects an operation owned by another user", async () => {
		const service = createCreditService(makeStore());

		expect(() =>
			service.reserveCreditOperation({
				userId: "user-2",
				projectId: "project-1",
				stage: "prd",
				idempotencyKey: "request-1",
				quote,
			}),
		).toThrow("Credit operation ownership mismatch");
	});

	it("refunds a settled operation with a compensating ledger entry", async () => {
		const store = makeStore();
		const service = createCreditService(store);
		const operation = await service.reserveCreditOperation({
			userId: "user-1",
			projectId: "project-1",
			stage: "prd",
			idempotencyKey: "request-1",
			quote,
		});
		await service.settleCreditOperation({
			userId: "user-1",
			operationId: operation.id,
			finalCharge: 2,
			artifactReference: "prd-version-1",
			measuredUnits: 2,
		});

		const refunded = await service.refundCreditOperation({
			userId: "user-1",
			operationId: operation.id,
			reason: "verified_failure",
		});

		expect(refunded.state).toBe("refunded");
		expect(store.subscriptions.get("sub-1")?.creditsUsed).toBe(0);
		expect(store.ledger.at(-1)?.entryType).toBe("refund");
	});

	it("persists the reservation expiry and actual usage on the operation", async () => {
		const store = makeStore();
		const service = createCreditService(store);
		const expiresAt = new Date("2000-01-01T00:00:00.000Z");
		const operation = await service.reserveCreditOperation({
			userId: "user-1",
			projectId: "project-1",
			stage: "prd",
			idempotencyKey: "expiry-key",
			quote,
			expiresAt,
		});
		const stored = store.operations.get(operation.id);
		expect(stored?.expiresAt).toEqual(expiresAt);
		await service.markCreditOperationRunning({
			userId: "user-1",
			operationId: operation.id,
		});
		await service.settleCreditOperation({
			userId: "user-1",
			operationId: operation.id,
			finalCharge: 2,
			artifactReference: "artifact-1",
			measuredUnits: 2.5,
		});
		expect(store.operations.get(operation.id)?.usage).toEqual({
			measuredUnits: 2.5,
		});
	});

	it("rejects non-finite or fractional quote amounts before reservation", () => {
		const service = createCreditService(makeStore());
		for (const invalid of [
			{ estimatedCredits: Number.NaN, maximumCredits: 4 },
			{ estimatedCredits: 1.5, maximumCredits: 4 },
			{ estimatedCredits: 2, maximumCredits: Number.POSITIVE_INFINITY },
			{ estimatedCredits: 5, maximumCredits: 4 },
		]) {
			expect(() =>
				service.reserveCreditOperation({
					userId: "user-1",
					projectId: "project-1",
					stage: "prd",
					idempotencyKey: `invalid-${String(invalid.estimatedCredits)}`,
					quote: { ...quote, ...invalid },
				}),
			).toThrow("quote");
		}
	});

	it("reconciles expired reservations and leaves unrelated users untouched", async () => {
		const store = makeStore();
		const service = createCreditService(store);
		await service.reserveCreditOperation({
			userId: "user-1",
			projectId: "project-1",
			stage: "prd",
			idempotencyKey: "request-1",
			quote: { ...quote, maximumCredits: 2 },
			expiresAt: new Date("2000-01-01T00:00:00.000Z"),
		});

		const result = await service.reconcileExpiredCreditOperations({
			userId: "user-1",
			now: new Date("2001-01-01T00:00:00.000Z"),
		});

		expect(result).toEqual({ releasedOperationIds: [expect.any(String)] });
		expect(store.subscriptions.get("sub-1")?.creditsReserved).toBe(0);
	});
});
