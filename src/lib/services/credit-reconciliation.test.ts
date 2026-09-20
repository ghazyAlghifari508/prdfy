import { describe, expect, it } from "vitest";
import {
	type CreditOperationItem,
	getActivityLabel,
	getStatusLabel,
} from "@/components/settings/credit-usage";
import {
	buildCodebaseMetrics,
	buildPrdMetrics,
	buildTaskMetrics,
	estimateCreditQuote,
} from "@/lib/adaptive-credit";
import { decideAnalysisRequest } from "@/lib/codebase-analysis";
import { ADAPTIVE_CREDIT_PRICING, TOPUP_SKU } from "@/lib/constants";
import {
	type CreditLedgerEntry,
	type CreditOperation,
	type CreditServiceStore,
	type CreditSubscription,
	createCreditService,
} from "@/lib/services/credit-service";
import {
	createPaymentService,
	type PaymentLedgerEntry,
	type PaymentRow,
	type PaymentServiceStore,
	type PaymentSubscriptionRow,
} from "@/lib/services/payment-service";

interface TestSubscriptionState
	extends CreditSubscription,
		PaymentSubscriptionRow {
	id: string;
	userId: string;
	plan: string;
	status: string;
	credits: number;
	creditsUsed: number;
	creditsReserved: number;
	currentPeriodStart: Date | null;
	currentPeriodEnd: Date | null;
	reminderCount: number;
	createdAt: Date;
	updatedAt: Date;
}

function createTestHarness(initialCredits = 20) {
	const now = new Date("2026-09-20T10:00:00.000Z");
	const futurePeriodEnd = new Date("2099-01-01T00:00:00.000Z");

	const subscription: TestSubscriptionState = {
		id: "sub-user-1",
		userId: "user-1",
		plan: "pro",
		status: "active",
		credits: initialCredits,
		creditsUsed: 0,
		creditsReserved: 0,
		currentPeriodStart: now,
		currentPeriodEnd: futurePeriodEnd,
		reminderCount: 0,
		createdAt: now,
		updatedAt: now,
	};

	const creditLedger: CreditLedgerEntry[] = [];
	const paymentLedger: PaymentLedgerEntry[] = [];
	const payments = new Map<string, PaymentRow>();

	const creditStore: CreditServiceStore = {
		subscriptions: new Map([["sub-user-1", subscription]]),
		projects: new Map([
			["project-1", { id: "project-1", userId: "user-1" }],
			["project-2", { id: "project-2", userId: "user-2" }],
		]),
		operations: new Map(),
		ledger: creditLedger,
	};

	const paymentStore: PaymentServiceStore = {
		payments,
		subscriptions: [subscription],
		ledger: paymentLedger,
	};

	const creditService = createCreditService(creditStore);
	const paymentService = createPaymentService(paymentStore);

	return {
		userId: "user-1",
		projectId: "project-1",
		subscription,
		creditStore,
		paymentStore,
		creditLedger,
		paymentLedger,
		payments,
		creditService,
		paymentService,
	};
}

function toCreditOperationItem(
	operation: CreditOperation,
	projectName?: string | null,
): CreditOperationItem {
	return {
		id: operation.id,
		projectId: operation.projectId,
		projectName: projectName ?? null,
		kind: operation.kind,
		stage: operation.stage,
		state: operation.state,
		estimatedCredits: operation.estimatedCredits,
		reservedCredits: operation.reservedCredits,
		maximumCredits: operation.maximumCredits,
		finalCharge: operation.finalCharge,
		pricingVersion: operation.pricingVersion,
		metrics: operation.metrics,
		capApplied: operation.capApplied,
		createdAt: operation.createdAt.toISOString(),
		settledAt:
			operation.state === "settled" ? operation.updatedAt.toISOString() : null,
	};
}

describe("Credit Reconciliation & Full-System Integration", () => {
	describe("1. Full Generation Lifecycle (Happy Path)", () => {
		it("executes Quote -> Reservation -> Running -> Output Validation -> Artifact Linkage -> Settle -> Ledger verification -> Settings Usage query", () => {
			const harness = createTestHarness(20);
			const { creditService, creditStore, subscription, userId, projectId } =
				harness;

			// Step 1: Quote generation
			const metrics = buildPrdMetrics({
				prompt: "Aplikasi Marketplace Pengadaan B2B",
				hasCodebaseContext: false,
			});
			const quote = creditService.createCreditQuote({
				userId,
				projectId,
				stage: "prd",
				operation: "prd_generation",
				metrics,
			});

			expect(quote.operation).toBe("prd_generation");
			expect(quote.pricingVersion).toBe(ADAPTIVE_CREDIT_PRICING.version);
			expect(quote.estimatedCredits).toBeGreaterThanOrEqual(1);
			expect(quote.maximumCredits).toBe(8);

			// Step 2: Atomic Reservation
			const idempotencyKey = "proj-1:prd:attempt-1";
			const reservedOp = creditService.reserveCreditOperation({
				userId,
				projectId,
				stage: "prd",
				operation: "prd_generation",
				metrics,
				idempotencyKey,
				quote,
			});

			expect(reservedOp.state).toBe("reserved");
			expect(subscription.creditsReserved).toBe(quote.maximumCredits);
			expect(subscription.creditsUsed).toBe(0);

			// Check available balance
			const availableAfterReservation =
				subscription.credits -
				subscription.creditsUsed -
				subscription.creditsReserved;
			expect(availableAfterReservation).toBe(20 - quote.maximumCredits);

			// Ledger holds reservation entry
			expect(creditStore.ledger).toHaveLength(1);
			expect(creditStore.ledger[0]).toMatchObject({
				userId,
				operationId: reservedOp.id,
				amount: -quote.maximumCredits,
				entryType: "reservation",
				pricingVersion: quote.pricingVersion,
				reason: "credit reservation",
			});

			// Step 3: Transition to Running before AI provider invocation
			const runningOp = creditService.markCreditOperationRunning({
				userId,
				operationId: reservedOp.id,
			});
			expect(runningOp.state).toBe("running");

			// Step 4: Valid Output & Settle with Artifact Linkage
			const artifactVersionId = "prd-version-artifact-uuid-001";
			const actualMetrics = buildPrdMetrics({
				prompt: "Aplikasi Marketplace Pengadaan B2B",
				hasCodebaseContext: false,
			});

			const settledOp = creditService.settleCreditOperation({
				userId,
				operationId: reservedOp.id,
				artifactId: artifactVersionId,
				actualMetrics,
				measuredUnits: 2,
				finalCharge: 2,
			});

			expect(settledOp.state).toBe("settled");
			expect(settledOp.finalCharge).toBe(2);

			// Subscription balances updated atomically
			expect(subscription.creditsReserved).toBe(0);
			expect(subscription.creditsUsed).toBe(2);
			const availableAfterSettlement =
				subscription.credits -
				subscription.creditsUsed -
				subscription.creditsReserved;
			expect(availableAfterSettlement).toBe(18);

			// Stored operation state and artifact reference
			const persistedOp = creditStore.operations.get(reservedOp.id);
			expect(persistedOp).toBeDefined();
			expect(persistedOp?.state).toBe("settled");
			expect(persistedOp?.artifactReference).toBe(artifactVersionId);
			expect(persistedOp?.finalCharge).toBe(2);
			expect(persistedOp?.reservedCredits).toBe(0);

			// Step 5: Ledger verification: reservation, release, debit
			expect(creditStore.ledger.map((e) => e.entryType)).toEqual([
				"reservation",
				"release",
				"debit",
			]);
			expect(creditStore.ledger[1]).toMatchObject({
				userId,
				operationId: reservedOp.id,
				amount: quote.maximumCredits - 2, // 8 - 2 = 6
				entryType: "release",
				reason: "unused credit reservation released",
			});
			expect(creditStore.ledger[2]).toMatchObject({
				userId,
				operationId: reservedOp.id,
				amount: -2,
				entryType: "debit",
				reason: "credit operation settled",
			});

			// Net balance delta in ledger matches finalCharge exactly
			const netLedgerDebit = creditStore.ledger
				.filter((e) => e.entryType === "debit")
				.reduce((sum, e) => sum + e.amount, 0);
			expect(netLedgerDebit).toBe(-2);

			// Step 6: Settings Usage Query verification
			const usageItem = toCreditOperationItem(
				persistedOp as CreditOperation,
				"Marketplace B2B",
			);
			expect(getStatusLabel(usageItem.state)).toBe("Berhasil");
			expect(getActivityLabel(usageItem.kind)).toBe("Generate PRD");
			expect(usageItem.finalCharge).toBe(2);
			expect(usageItem.reservedCredits).toBe(0);
			expect(usageItem.projectName).toBe("Marketplace B2B");
		});
	});

	describe("2. Failure / Truncation Lifecycle (Safe Release with 0 Net Debit)", () => {
		it("releases reservation with 0 net debit on failure/truncation and renders 'Dilepas' in Settings", () => {
			const harness = createTestHarness(20);
			const { creditService, creditStore, subscription, userId, projectId } =
				harness;

			// Step 1: Quote & Reserve Task generation
			const metrics = buildTaskMetrics({
				prdSourceChars: 4000,
				taskCount: 15,
				hasCodebaseContext: false,
			});
			const quote = creditService.createCreditQuote({
				userId,
				projectId,
				stage: "task",
				operation: "task_generation",
				metrics,
			});

			const reservedOp = creditService.reserveCreditOperation({
				userId,
				projectId,
				stage: "task",
				operation: "task_generation",
				metrics,
				idempotencyKey: "proj-1:task:attempt-1",
				quote,
			});

			expect(subscription.creditsReserved).toBe(quote.maximumCredits);
			expect(subscription.creditsUsed).toBe(0);

			// Step 2: Mark Running
			creditService.markCreditOperationRunning({
				userId,
				operationId: reservedOp.id,
			});

			// Step 3: Provider stream aborts / truncates unexpectedly
			// Step 4: Safe release invoked
			const releasedOp = creditService.releaseCreditOperation({
				userId,
				operationId: reservedOp.id,
				reason: "model_stream_truncated",
			});

			expect(releasedOp.state).toBe("released");
			expect(releasedOp.finalCharge).toBeNull();

			// Step 5: Check subscription balances: 0 credits used, 0 credits reserved!
			expect(subscription.creditsUsed).toBe(0);
			expect(subscription.creditsReserved).toBe(0);
			const availableBalance =
				subscription.credits -
				subscription.creditsUsed -
				subscription.creditsReserved;
			expect(availableBalance).toBe(20); // Fully preserved!

			// Ledger holds reservation (-max) and release (+max), net sum = 0
			expect(creditStore.ledger.map((e) => e.entryType)).toEqual([
				"reservation",
				"release",
			]);
			expect(creditStore.ledger[1]).toMatchObject({
				userId,
				operationId: reservedOp.id,
				amount: quote.maximumCredits,
				entryType: "release",
				reason: "model_stream_truncated",
			});
			const netDebit = creditStore.ledger.reduce((sum, e) => sum + e.amount, 0);
			expect(netDebit).toBe(0); // 0 net debit!

			// Step 6: Settings Usage query reflects "Dilepas"
			const persistedOp = creditStore.operations.get(reservedOp.id);
			expect(persistedOp).toBeDefined();
			const usageItem = toCreditOperationItem(persistedOp as CreditOperation);
			expect(getStatusLabel(usageItem.state)).toBe("Dilepas");
			expect(getActivityLabel(usageItem.kind)).toBe("Generate Task");
			expect(usageItem.finalCharge).toBeNull();
		});
	});

	describe("3. Codebase Analysis: Free Ready-Analysis Reuse vs Billable New Analysis", () => {
		it("reuses ready analysis without reserving or debiting credits", () => {
			const harness = createTestHarness(20);
			const { creditStore, subscription } = harness;

			// Given snapshot with an existing ready analysis
			const decision = decideAnalysisRequest(
				{ id: "snapshot-001", status: "uploaded" },
				[{ id: "analysis-ready-001", status: "ready" }],
			);

			expect(decision).toEqual({
				action: "reuse",
				analysisId: "analysis-ready-001",
			});

			// No billable operations created, no ledger entries, balance pristine
			expect(creditStore.operations.size).toBe(0);
			expect(creditStore.ledger).toHaveLength(0);
			expect(subscription.creditsReserved).toBe(0);
			expect(subscription.creditsUsed).toBe(0);
			expect(
				subscription.credits -
					subscription.creditsUsed -
					subscription.creditsReserved,
			).toBe(20);
		});

		it("processes billable new analysis with adaptive reservation, execution, and settlement", () => {
			const harness = createTestHarness(20);
			const { creditService, creditStore, subscription, userId, projectId } =
				harness;

			// Given snapshot with no ready analysis
			const decision = decideAnalysisRequest(
				{ id: "snapshot-002", status: "uploaded" },
				[],
			);
			expect(decision).toEqual({ action: "create" });

			const metrics = buildCodebaseMetrics({
				fileCount: 150,
				sourceBytes: 300_000,
			});
			const quote = creditService.createCreditQuote({
				userId,
				projectId,
				stage: "codebase",
				operation: "codebase_analysis",
				metrics,
			});

			expect(quote.operation).toBe("codebase_analysis");
			expect(quote.maximumCredits).toBe(12);

			const reservedOp = creditService.reserveCreditOperation({
				userId,
				projectId,
				stage: "codebase",
				operation: "codebase_analysis",
				metrics,
				idempotencyKey: "proj-1:codebase_analysis:snapshot-002",
				quote,
			});

			expect(reservedOp.state).toBe("reserved");
			expect(subscription.creditsReserved).toBe(12);

			creditService.markCreditOperationRunning({
				userId,
				operationId: reservedOp.id,
			});

			const settledOp = creditService.settleCreditOperation({
				userId,
				operationId: reservedOp.id,
				artifactId: "analysis-record-uuid-002",
				actualMetrics: metrics,
				measuredUnits: 4,
				finalCharge: 4,
			});

			expect(settledOp.state).toBe("settled");
			expect(settledOp.finalCharge).toBe(4);
			expect(subscription.creditsReserved).toBe(0);
			expect(subscription.creditsUsed).toBe(4);
			expect(
				subscription.credits -
					subscription.creditsUsed -
					subscription.creditsReserved,
			).toBe(16);

			const persistedOp = creditStore.operations.get(reservedOp.id);
			expect(persistedOp?.artifactReference).toBe("analysis-record-uuid-002");
			const usageItem = toCreditOperationItem(persistedOp as CreditOperation);
			expect(getStatusLabel(usageItem.state)).toBe("Berhasil");
			expect(getActivityLabel(usageItem.kind)).toBe("Codebase analysis");
			expect(usageItem.finalCharge).toBe(4);
		});
	});

	describe("4. Payment Plan & Top-Up Grants Traceability", () => {
		it("accurately updates balances and appends traceable ledger entries without double-counting on retries", () => {
			const harness = createTestHarness(2); // Starting on free tier with 2 credits
			const { paymentService, paymentStore, subscription, payments, userId } =
				harness;

			subscription.plan = "free";

			// Scenario A: User upgrades to Pro (49,000 IDR)
			payments.set("order-plan-pro", {
				orderId: "order-plan-pro",
				userId,
				amount: 49000,
				plan: "pro",
				status: "pending",
				createdAt: new Date("2026-09-20T11:00:00.000Z"),
				updatedAt: new Date("2026-09-20T11:00:00.000Z"),
			});

			const planResult = paymentService.applyPaymentSuccess("order-plan-pro");
			expect(planResult).toEqual({ plan: "pro" });
			expect(subscription.plan).toBe("pro");
			expect(subscription.credits).toBe(30);
			expect(subscription.creditsUsed).toBe(0);
			expect(subscription.creditsReserved).toBe(0);

			// Exactly one grant entry appended
			expect(paymentStore.ledger).toHaveLength(1);
			expect(paymentStore.ledger[0]).toMatchObject({
				userId,
				amount: 30,
				entryType: "grant",
				sourceCategory: "system_grant",
				pricingVersion: ADAPTIVE_CREDIT_PRICING.version,
				metadata: { reason: "payment_order:order-plan-pro" },
			});

			// Replay of payment webhook must be completely idempotent
			const replayPlan = paymentService.applyPaymentSuccess("order-plan-pro");
			expect(replayPlan).toEqual({ plan: "pro" });
			expect(subscription.credits).toBe(30);
			expect(paymentStore.ledger).toHaveLength(1); // No double grant!

			// Scenario B: User purchases Top-Up (+15 credits)
			payments.set("order-topup-1", {
				orderId: "order-topup-1",
				userId,
				amount: 20000,
				plan: TOPUP_SKU.id,
				status: "pending",
				createdAt: new Date("2026-09-20T12:00:00.000Z"),
				updatedAt: new Date("2026-09-20T12:00:00.000Z"),
			});

			const topupResult = paymentService.applyTopUpSuccess("order-topup-1");
			expect(topupResult).toEqual({ plan: "pro" });
			expect(subscription.credits).toBe(30 + TOPUP_SKU.credits); // 45 credits

			expect(paymentStore.ledger).toHaveLength(2);
			expect(paymentStore.ledger[1]).toMatchObject({
				userId,
				amount: TOPUP_SKU.credits,
				entryType: "grant",
				sourceCategory: "system_grant",
				pricingVersion: ADAPTIVE_CREDIT_PRICING.version,
				metadata: { reason: "topup_order:order-topup-1" },
			});

			// Replay of top-up webhook is also completely idempotent
			const replayTopup = paymentService.applyTopUpSuccess("order-topup-1");
			expect(replayTopup).toEqual({ plan: "pro" });
			expect(subscription.credits).toBe(45);
			expect(paymentStore.ledger).toHaveLength(2); // No double grant!

			// Traceability check: Sum of grants equals subscription total credit pool
			const totalGrants = paymentStore.ledger.reduce(
				(sum, entry) => sum + entry.amount,
				0,
			);
			expect(totalGrants).toBe(subscription.credits);
		});
	});

	describe("5. Mathematical Balance Conservation Invariant", () => {
		it("strictly preserves 'Opening Credits + Total Grants = Available + CreditsUsed + CreditsReserved' across multi-operation lifecycle", () => {
			const harness = createTestHarness(10);
			const {
				creditService,
				paymentService,
				subscription,
				payments,
				userId,
				projectId,
			} = harness;

			const openingCredits = 10;
			let totalGrants = 0;

			function verifyConservation(stepName: string) {
				const available = Math.max(
					0,
					subscription.credits -
						subscription.creditsUsed -
						subscription.creditsReserved,
				);
				const accountedTotal =
					available + subscription.creditsUsed + subscription.creditsReserved;
				const expectedTotal = openingCredits + totalGrants;

				expect(accountedTotal, `Conservation failed at step: ${stepName}`).toBe(
					expectedTotal,
				);
				expect(
					subscription.credits,
					`Subscription pool mismatch at step: ${stepName}`,
				).toBe(expectedTotal);
			}

			// Initial state
			verifyConservation("Initial State");

			// Event 1: Top-up grant (+15 credits)
			payments.set("topup-seq-1", {
				orderId: "topup-seq-1",
				userId,
				amount: 20000,
				plan: TOPUP_SKU.id,
				status: "pending",
				createdAt: new Date(),
				updatedAt: new Date(),
			});
			paymentService.applyTopUpSuccess("topup-seq-1");
			totalGrants += TOPUP_SKU.credits; // +15 -> total 25
			verifyConservation("After Top-Up Grant");

			// Event 2: Reserve PRD Generation (max 8)
			const prdQuote = creditService.createCreditQuote({
				userId,
				projectId,
				stage: "prd",
				operation: "prd_generation",
				metrics: { promptChars: 200 },
			});
			const prdOp = creditService.reserveCreditOperation({
				userId,
				projectId,
				stage: "prd",
				operation: "prd_generation",
				metrics: { promptChars: 200 },
				idempotencyKey: "seq-prd-1",
				quote: prdQuote,
			});
			verifyConservation("After PRD Reservation (Hold 8)");

			// Event 3: Settle PRD Generation (final charge 2, release 6)
			creditService.markCreditOperationRunning({
				userId,
				operationId: prdOp.id,
			});
			creditService.settleCreditOperation({
				userId,
				operationId: prdOp.id,
				artifactId: "prd-seq-artifact-1",
				measuredUnits: 2,
				finalCharge: 2,
			});
			verifyConservation("After PRD Settlement (Debit 2, Release 6)");

			// Event 4: Reserve AC Generation (max 6)
			const acQuote = estimateCreditQuote({
				operation: "ac_generation",
				metrics: { prdSourceChars: 1500 },
			});
			const acOp = creditService.reserveCreditOperation({
				userId,
				projectId,
				stage: "ac",
				operation: "ac_generation",
				metrics: { prdSourceChars: 1500 },
				idempotencyKey: "seq-ac-1",
				quote: acQuote,
			});
			verifyConservation("After AC Reservation (Hold 6)");

			// Event 5: AC Failure & Safe Release (charge 0, release 6)
			creditService.markCreditOperationRunning({
				userId,
				operationId: acOp.id,
			});
			creditService.releaseCreditOperation({
				userId,
				operationId: acOp.id,
				reason: "provider_timeout",
			});
			verifyConservation("After AC Failure Safe Release (Release 6)");

			// Event 6: Reserve Codebase Analysis (max 12)
			const codeMetrics = buildCodebaseMetrics({
				fileCount: 80,
				contentSize: 150_000,
			});
			const codeQuote = creditService.createCreditQuote({
				userId,
				projectId,
				stage: "codebase",
				operation: "codebase_analysis",
				metrics: codeMetrics,
			});
			const codeOp = creditService.reserveCreditOperation({
				userId,
				projectId,
				stage: "codebase",
				operation: "codebase_analysis",
				metrics: codeMetrics,
				idempotencyKey: "seq-code-1",
				quote: codeQuote,
			});
			verifyConservation("After Codebase Analysis Reservation (Hold 12)");

			// Event 7: Settle Codebase Analysis (final charge 4, release 8)
			creditService.markCreditOperationRunning({
				userId,
				operationId: codeOp.id,
			});
			creditService.settleCreditOperation({
				userId,
				operationId: codeOp.id,
				artifactId: "code-seq-artifact-1",
				measuredUnits: 4,
				finalCharge: 4,
			});
			verifyConservation("After Codebase Analysis Settlement (Debit 4)");

			// Event 8: Refund PRD Generation (+2 credits refunded)
			creditService.refundCreditOperation({
				userId,
				operationId: prdOp.id,
				reason: "customer_complaint_verified",
			});
			verifyConservation("After PRD Refund (+2 Refund)");

			// Final audit of credits values
			expect(subscription.creditsUsed).toBe(4); // 2 PRD - 2 refund + 4 Codebase = 4
			expect(subscription.creditsReserved).toBe(0);
			const finalAvailable =
				subscription.credits -
				subscription.creditsUsed -
				subscription.creditsReserved;
			expect(finalAvailable).toBe(21);
			expect(finalAvailable + subscription.creditsUsed).toBe(25);
		});
	});

	describe("6. Expiry Sweep: Stale/Expired Operations Reconciliation", () => {
		it("reconciles expired reservations safely: releases normal reservations and quarantines unresolvable origins", async () => {
			const harness = createTestHarness(20);
			const { creditService, creditStore, subscription, userId, projectId } =
				harness;

			const pastDate = new Date("2026-09-01T00:00:00.000Z");
			const futureDate = new Date("2026-09-30T00:00:00.000Z");
			const sweepTime = new Date("2026-09-20T12:00:00.000Z");

			// Operation A: Normal expired reservation
			const quoteA = creditService.createCreditQuote({
				userId,
				projectId,
				stage: "prd",
				operation: "prd_generation",
				metrics: { promptChars: 100 },
			});
			const opA = creditService.reserveCreditOperation({
				userId,
				projectId,
				stage: "prd",
				operation: "prd_generation",
				metrics: { promptChars: 100 },
				idempotencyKey: "op-expired-normal",
				quote: quoteA,
				expiresAt: pastDate,
			});

			// Operation B: Unexpired active reservation
			const quoteB = creditService.createCreditQuote({
				userId,
				projectId,
				stage: "ac",
				operation: "ac_generation",
				metrics: { prdSourceChars: 1000 },
			});
			const opB = creditService.reserveCreditOperation({
				userId,
				projectId,
				stage: "ac",
				operation: "ac_generation",
				metrics: { prdSourceChars: 1000 },
				idempotencyKey: "op-active-future",
				quote: quoteB,
				expiresAt: futureDate,
			});

			// Operation C: Stale reservation for a second user whose subscription gets deleted (permanently unresolvable origin)
			const user2Sub: TestSubscriptionState = {
				id: "sub-user-2",
				userId: "user-2",
				plan: "pro",
				status: "active",
				credits: 20,
				creditsUsed: 0,
				creditsReserved: 0,
				currentPeriodStart: pastDate,
				currentPeriodEnd: futureDate,
				reminderCount: 0,
				createdAt: pastDate,
				updatedAt: pastDate,
			};
			creditStore.subscriptions.set("sub-user-2", user2Sub);

			const quoteC = creditService.createCreditQuote({
				userId: "user-2",
				projectId: "project-2",
				stage: "prd",
				operation: "prd_generation",
				metrics: { promptChars: 150 },
			});
			const opC = creditService.reserveCreditOperation({
				userId: "user-2",
				projectId: "project-2",
				stage: "prd",
				operation: "prd_generation",
				metrics: { promptChars: 150 },
				idempotencyKey: "op-expired-unresolvable",
				quote: quoteC,
				expiresAt: pastDate,
			});

			// Verify initial holds
			expect(subscription.creditsReserved).toBe(
				quoteA.maximumCredits + quoteB.maximumCredits,
			);
			expect(user2Sub.creditsReserved).toBe(quoteC.maximumCredits);

			// Delete User 2's subscription to simulate unresolvable origin error
			creditStore.subscriptions.delete("sub-user-2");

			// Sweep 1: Reconcile User 1
			const user1Result = await creditService.reconcileExpiredCreditOperations({
				userId: "user-1",
				now: sweepTime,
			});

			// Operation A is released; Operation B remains reserved
			expect(user1Result.releasedOperationIds).toEqual([opA.id]);

			const storedOpA = creditStore.operations.get(opA.id);
			expect(storedOpA?.state).toBe("released");
			expect(storedOpA?.failureReason).toBe("operation expired");

			const storedOpB = creditStore.operations.get(opB.id);
			expect(storedOpB?.state).toBe("reserved"); // Preserved!

			// Credits reserved for User 1 reduced by Op A's maximum, Op B's hold remains
			expect(subscription.creditsReserved).toBe(quoteB.maximumCredits);

			// Check Settings usage label for released Op A
			const usageItemA = toCreditOperationItem(storedOpA as CreditOperation);
			expect(getStatusLabel(usageItemA.state)).toBe("Dilepas");

			// Sweep 2: Reconcile User 2 (unresolvable subscription origin)
			const user2Result = await creditService.reconcileExpiredCreditOperations({
				userId: "user-2",
				now: sweepTime,
			});

			// Operation C could not be normally released so releasedOperationIds is empty, but operation is quarantined
			expect(user2Result.releasedOperationIds).toEqual([]);

			const storedOpC = creditStore.operations.get(opC.id);
			expect(storedOpC?.state).toBe("quarantined");
			expect(storedOpC?.reservedCredits).toBe(0);
			expect(storedOpC?.reconciliation).toMatchObject({
				status: "resolved",
				code: "subscription_origin_unresolvable",
				accounting: "manual_correction_required",
			});

			// Compensating correction ledger entry appended for Op C
			const correctionEntry = creditStore.ledger.find(
				(e) => e.operationId === opC.id && e.entryType === "correction",
			);
			expect(correctionEntry).toBeDefined();
			expect(correctionEntry).toMatchObject({
				userId: "user-2",
				operationId: opC.id,
				amount: quoteC.maximumCredits,
				entryType: "correction",
				metadata: {
					reconciliationCode: "subscription_origin_unresolvable",
					accounting: "manual_correction_required",
				},
			});

			// Settings usage label for quarantined Op C
			const usageItemC = toCreditOperationItem(storedOpC as CreditOperation);
			expect(getStatusLabel(usageItemC.state)).toBe("Dikarantina");
		});
	});
});
