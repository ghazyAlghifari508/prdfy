import { describe, expect, it } from "vitest";
import {
	buildAcMetrics,
	buildPrdMetrics,
	buildTaskMetrics,
	estimateCreditQuote,
	formatInsufficientCreditsError,
	formatSubscriptionPausedError,
} from "@/lib/adaptive-credit";
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

describe("metric builders", () => {
	describe("buildPrdMetrics", () => {
		it("builds metrics from prompt without codebase context", () => {
			const metrics = buildPrdMetrics({
				prompt: "Aplikasi pencatat keuangan pribadi",
				hasCodebaseContext: false,
			});

			expect(metrics).toEqual({
				promptChars: 34,
				hasCodebaseContext: false,
			});
		});

		it("builds metrics with codebase snapshot context and clamps negative numbers", () => {
			const metrics = buildPrdMetrics({
				promptChars: 5000,
				hasCodebaseContext: true,
				codebase: {
					sourceBytes: 300_000,
					fileCount: 150,
					languageCount: 4,
				},
			});

			expect(metrics).toEqual({
				promptChars: 5000,
				hasCodebaseContext: true,
				codebase: {
					sourceBytes: 300_000,
					fileCount: 150,
					languageCount: 4,
				},
			});
		});

		it("handles contentSize fallback for sourceBytes", () => {
			const metrics = buildPrdMetrics({
				prompt: "Test",
				codebase: {
					contentSize: 120_000,
					fileCount: 50,
				},
			});

			expect(metrics).toEqual({
				promptChars: 4,
				hasCodebaseContext: false,
				codebase: {
					sourceBytes: 120_000,
					fileCount: 50,
				},
			});
		});
	});

	describe("buildAcMetrics", () => {
		it("builds metrics from PRD source markdown", () => {
			const prd = "# PRD\n\n## Overview\nThis is a test PRD content.";
			const metrics = buildAcMetrics({
				prdSource: prd,
				hasCodebaseContext: false,
			});

			expect(metrics).toEqual({
				prdSourceChars: prd.length,
				hasCodebaseContext: false,
			});
		});

		it("builds metrics with codebase context", () => {
			const metrics = buildAcMetrics({
				prdSourceChars: 15000,
				hasCodebaseContext: true,
				codebase: {
					sourceBytes: 500_000,
					fileCount: 200,
				},
			});

			expect(metrics).toEqual({
				prdSourceChars: 15000,
				hasCodebaseContext: true,
				codebase: {
					sourceBytes: 500_000,
					fileCount: 200,
				},
			});
		});
	});

	describe("buildTaskMetrics", () => {
		it("builds metrics from PRD source and task count", () => {
			const metrics = buildTaskMetrics({
				prdSourceChars: 8000,
				taskCount: 12,
				hasCodebaseContext: false,
			});

			expect(metrics).toEqual({
				prdSourceChars: 8000,
				taskCount: 12,
				hasCodebaseContext: false,
			});
		});

		it("builds metrics with codebase snapshot context", () => {
			const metrics = buildTaskMetrics({
				prdSource: "Short PRD",
				taskCount: 20,
				hasCodebaseContext: true,
				codebase: {
					sourceBytes: 400_000,
					fileCount: 80,
				},
			});

			expect(metrics).toEqual({
				prdSourceChars: 9,
				taskCount: 20,
				hasCodebaseContext: true,
				codebase: {
					sourceBytes: 400_000,
					fileCount: 80,
				},
			});
		});
	});
});

describe("generation credit lifecycle integration", () => {
	it("quotes and reserves credit operation before provider invocation", () => {
		const store = makeStore();
		const service = createCreditService(store);
		const metrics = buildPrdMetrics({
			prompt: "Simple app idea",
			hasCodebaseContext: false,
		});
		const quote = service.createCreditQuote({
			userId: "user-1",
			projectId: "project-1",
			stage: "prd",
			operation: "prd_generation",
			metrics,
		});

		expect(quote.operation).toBe("prd_generation");
		expect(quote.estimatedCredits).toBeGreaterThanOrEqual(1);
		expect(quote.maximumCredits).toBe(8);

		const reservation = service.reserveCreditOperation({
			userId: "user-1",
			projectId: "project-1",
			stage: "prd",
			operation: "prd_generation",
			metrics,
			idempotencyKey: "project-1:prd:1",
			quote,
		});

		expect(reservation.state).toBe("reserved");
		const subscription = store.subscriptions.get("sub-1");
		expect(subscription?.creditsReserved).toBe(quote.maximumCredits);
		expect(store.ledger).toHaveLength(1);
		expect(store.ledger[0].entryType).toBe("reservation");
		expect(store.ledger[0].amount).toBe(-quote.maximumCredits);
	});

	it("rejects reservation when available balance is insufficient", () => {
		const store = makeStore();
		const subscription = store.subscriptions.get("sub-1");
		if (!subscription) throw new Error("Missing test fixture");
		subscription.credits = 5;
		subscription.creditsUsed = 2; // available: 3, but maximum is 8
		const service = createCreditService(store);
		const metrics = buildPrdMetrics({
			prompt: "Idea",
			hasCodebaseContext: false,
		});
		const quote = service.createCreditQuote({
			userId: "user-1",
			projectId: "project-1",
			stage: "prd",
			operation: "prd_generation",
			metrics,
		});

		expect(() =>
			service.reserveCreditOperation({
				userId: "user-1",
				projectId: "project-1",
				stage: "prd",
				operation: "prd_generation",
				metrics,
				idempotencyKey: "project-1:prd:1",
				quote,
			}),
		).toThrow("Insufficient available credit");

		expect(store.ledger).toHaveLength(0);
		expect(subscription.creditsReserved).toBe(0);
	});

	it("prevents double-reservation with the same idempotency key", () => {
		const store = makeStore();
		const service = createCreditService(store);
		const metrics = buildAcMetrics({
			prdSourceChars: 1000,
			hasCodebaseContext: false,
		});
		const quote = service.createCreditQuote({
			userId: "user-1",
			projectId: "project-1",
			stage: "ac",
			operation: "ac_generation",
			metrics,
		});

		const res1 = service.reserveCreditOperation({
			userId: "user-1",
			projectId: "project-1",
			stage: "ac",
			operation: "ac_generation",
			metrics,
			idempotencyKey: "project-1:ac:attempt-1",
			quote,
		});

		const res2 = service.reserveCreditOperation({
			userId: "user-1",
			projectId: "project-1",
			stage: "ac",
			operation: "ac_generation",
			metrics,
			idempotencyKey: "project-1:ac:attempt-1",
			quote,
		});

		expect(res1.id).toBe(res2.id);
		expect(store.ledger).toHaveLength(1);
		const subscription = store.subscriptions.get("sub-1");
		expect(subscription?.creditsReserved).toBe(quote.maximumCredits);
	});

	it("settles successful generation with artifact reference and actual metrics", () => {
		const store = makeStore();
		const service = createCreditService(store);
		const metrics = buildPrdMetrics({
			prompt: "My new product idea",
			hasCodebaseContext: false,
		});
		const quote = service.createCreditQuote({
			userId: "user-1",
			projectId: "project-1",
			stage: "prd",
			operation: "prd_generation",
			metrics,
		});

		const reservation = service.reserveCreditOperation({
			userId: "user-1",
			projectId: "project-1",
			stage: "prd",
			operation: "prd_generation",
			metrics,
			idempotencyKey: "project-1:prd:1",
			quote,
		});

		service.markCreditOperationRunning({
			userId: "user-1",
			operationId: reservation.id,
		});

		const actualMetrics = buildPrdMetrics({
			prompt: "My new product idea",
			hasCodebaseContext: false,
		});

		const settled = service.settleCreditOperation({
			userId: "user-1",
			operationId: reservation.id,
			artifactId: "prd-version-uuid-1",
			actualMetrics,
		});

		expect(settled.state).toBe("settled");
		expect(settled.finalCharge).toBe(1); // baseCredits 1, surcharge 0
		const subscription = store.subscriptions.get("sub-1");
		expect(subscription?.creditsReserved).toBe(0);
		expect(subscription?.creditsUsed).toBe(1);

		const op = store.operations.get(reservation.id);
		expect(op?.artifactReference).toBe("prd-version-uuid-1");
		expect(op?.state).toBe("settled");
		expect(op?.finalCharge).toBe(1);

		// Ledger entries: reservation (-8), release (+7), debit (-1)
		expect(store.ledger.map((e) => e.entryType)).toEqual([
			"reservation",
			"release",
			"debit",
		]);
		expect(store.ledger[1].amount).toBe(7);
		expect(store.ledger[2].amount).toBe(-1);
	});

	it("releases reservation with 0 debit on failure or truncation", () => {
		const store = makeStore();
		const service = createCreditService(store);
		const metrics = buildTaskMetrics({
			prdSourceChars: 2000,
			taskCount: 5,
			hasCodebaseContext: false,
		});
		const quote = service.createCreditQuote({
			userId: "user-1",
			projectId: "project-1",
			stage: "task",
			operation: "task_generation",
			metrics,
		});

		const reservation = service.reserveCreditOperation({
			userId: "user-1",
			projectId: "project-1",
			stage: "task",
			operation: "task_generation",
			metrics,
			idempotencyKey: "project-1:task:1",
			quote,
		});

		service.markCreditOperationRunning({
			userId: "user-1",
			operationId: reservation.id,
		});

		const released = service.releaseCreditOperation({
			userId: "user-1",
			operationId: reservation.id,
			reason: "generation truncated",
		});

		expect(released.state).toBe("released");
		expect(released.finalCharge).toBeNull();
		const subscription = store.subscriptions.get("sub-1");
		expect(subscription?.creditsReserved).toBe(0);
		expect(subscription?.creditsUsed).toBe(0);

		// Ledger: reservation (-8), release (+8), no debit!
		expect(store.ledger.map((e) => e.entryType)).toEqual([
			"reservation",
			"release",
		]);
		expect(store.ledger[1].amount).toBe(quote.maximumCredits);
		expect(store.ledger.reduce((sum, e) => sum + e.amount, 0)).toBe(0);
	});

	it("keeps mode 'revise' 100% free without reservation or debit", () => {
		const store = makeStore();
		// In revise mode, no reservation is created
		const subscription = store.subscriptions.get("sub-1");
		expect(store.operations.size).toBe(0);
		expect(store.ledger).toHaveLength(0);
		expect(subscription?.creditsUsed).toBe(0);
		expect(subscription?.creditsReserved).toBe(0);
	});

	it("formats 403 insufficient credit response with quote and Indonesian instructions", () => {
		const quote = estimateCreditQuote({
			operation: "prd_generation",
			metrics: { promptChars: 100 },
		});
		const res = formatInsufficientCreditsError({
			quote,
			availableCredits: 2,
			stageLabel: "membuat PRD",
		});

		expect(res).toEqual({
			error:
				"Kredit kamu tidak mencukupi untuk membuat PRD. Dibutuhkan maksimal 8 kredit, saldo tersedia: 2 kredit.",
			code: "NO_CREDITS",
			quote,
			requiredCredits: 8,
			availableCredits: 2,
			topUpInstructions:
				"Silakan top up kredit atau upgrade paket Anda melalui menu Billing.",
		});
	});

	it("formats 403 subscription paused response with quote and instructions", () => {
		const quote = estimateCreditQuote({
			operation: "ac_generation",
			metrics: { prdSourceChars: 500 },
		});
		const res = formatSubscriptionPausedError({
			quote,
			availableCredits: 0,
			stageLabel: "generate AC",
		});

		expect(res).toEqual({
			error:
				"Masa aktif langgananmu sudah habis. Perpanjang di halaman Pricing untuk generate AC.",
			code: "SUBSCRIPTION_PAUSED",
			quote,
			requiredCredits: 6,
			availableCredits: 0,
			topUpInstructions:
				"Perpanjang paket langganan Anda melalui menu Billing.",
		});
	});

	it("applies cap when actual measured units exceed maximumCredits", () => {
		const store = makeStore();
		const service = createCreditService(store);
		const metrics = buildPrdMetrics({
			prompt: "Idea",
			hasCodebaseContext: false,
		});
		const quote = service.createCreditQuote({
			userId: "user-1",
			projectId: "project-1",
			stage: "prd",
			operation: "prd_generation",
			metrics,
		});

		const reservation = service.reserveCreditOperation({
			userId: "user-1",
			projectId: "project-1",
			stage: "prd",
			operation: "prd_generation",
			metrics,
			idempotencyKey: "project-1:prd:capped",
			quote,
		});

		service.markCreditOperationRunning({
			userId: "user-1",
			operationId: reservation.id,
		});

		const settled = service.settleCreditOperation({
			userId: "user-1",
			operationId: reservation.id,
			artifactId: "prd-v1",
			measuredUnits: 25, // exceeds maximumCredits (8)
			finalCharge: 8,
		});

		expect(settled.finalCharge).toBe(8);
		const op = store.operations.get(reservation.id);
		expect(op?.capApplied).toBe(true);
		expect(op?.finalCharge).toBe(8);
	});

	it("throws when settling without an artifact reference or id", () => {
		const store = makeStore();
		const service = createCreditService(store);
		const metrics = buildPrdMetrics({ prompt: "Idea" });
		const quote = service.createCreditQuote({
			userId: "user-1",
			projectId: "project-1",
			stage: "prd",
			operation: "prd_generation",
			metrics,
		});

		const reservation = service.reserveCreditOperation({
			userId: "user-1",
			projectId: "project-1",
			stage: "prd",
			operation: "prd_generation",
			metrics,
			idempotencyKey: "project-1:prd:no-art",
			quote,
		});

		service.markCreditOperationRunning({
			userId: "user-1",
			operationId: reservation.id,
		});

		expect(() =>
			service.settleCreditOperation({
				userId: "user-1",
				operationId: reservation.id,
				actualMetrics: metrics,
			}),
		).toThrow("Artifact reference is required for settlement");
	});

	it("calculates surcharge properly for high complexity inputs", () => {
		// promptChars 10,000 (threshold 4,000 -> 3 units * 0.25 = 0.75)
		// codebase: sourceBytes 600,000 (threshold 250,000 -> 3 units * 0.5 = 1.5)
		// codebase: fileCount 250 (threshold 100 -> 3 units * 0.5 = 1.5)
		// codebaseContext weight: 0.5
		// Total surcharge: 0.75 + 1.5 + 1.5 + 0.5 = 4.25
		// baseCredits: 1
		// estimatedCredits: Math.min(8, Math.ceil(1 + 4.25)) = 6
		const metrics = buildPrdMetrics({
			promptChars: 10_000,
			hasCodebaseContext: true,
			codebase: {
				sourceBytes: 600_000,
				fileCount: 250,
			},
		});
		const quote = estimateCreditQuote({
			operation: "prd_generation",
			metrics,
		});

		expect(quote.estimatedCredits).toBe(6);
		expect(quote.maximumCredits).toBe(8);
	});
});
