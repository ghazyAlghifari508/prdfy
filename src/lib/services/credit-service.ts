import { type AnyColumn, and, desc, eq, gt, sql } from "drizzle-orm";
import type { CreditOperationStage } from "@/db/schema";
import type {
	CreditLedgerEntryType,
	CreditOperationKind,
	CreditOperationState,
} from "@/lib/adaptive-credit";
import { type CreditQuote, estimateCreditQuote } from "@/lib/adaptive-credit";

export interface CreditSubscription {
	id: string;
	userId: string;
	credits: number;
	creditsUsed: number;
	creditsReserved: number;
	currentPeriodEnd: Date | null;
}

export interface CreditProject {
	id: string;
	userId: string;
}

export interface CreditOperation {
	id: string;
	userId: string;
	projectId: string;
	subscriptionId: string | null;
	kind: CreditOperationKind;
	stage: CreditOperationStage;
	idempotencyKey: string;
	state: CreditOperationState;
	estimatedCredits: number;
	reservedCredits: number;
	maximumCredits: number;
	finalCharge: number | null;
	pricingVersion: CreditQuote["pricingVersion"];
	metrics: CreditQuote["metrics"];
	usage?: { measuredUnits: number };
	capApplied: boolean;
	reconciliation?: {
		status: "not_required" | "pending" | "resolved";
		code?: string;
		accounting?: "none" | "manual_correction_required";
		resolvedAt?: string;
	};
	artifactReference: string | null;
	failureReason: string | null;
	expiresAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CreditLedgerEntry {
	id: string;
	userId: string;
	operationId: string | null;
	amount: number;
	entryType: CreditLedgerEntryType;
	reason: string;
	pricingVersion: CreditQuote["pricingVersion"];
	metadata?: {
		reconciliationCode?: string;
		accounting?: "manual_correction_required";
	};
	createdAt: Date;
}

export interface CreditServiceStore {
	subscriptions: Map<string, CreditSubscription>;
	projects: Map<string, CreditProject>;
	operations: Map<string, CreditOperation>;
	ledger: CreditLedgerEntry[];
}

export interface CreditQuoteInput {
	userId: string;
	projectId: string;
	operation: CreditOperationKind;
	stage: CreditOperationStage;
	metrics: CreditQuote["metrics"];
}

export interface ReserveCreditOperationInput {
	userId: string;
	projectId: string;
	stage: CreditOperationStage;
	operation: CreditOperationKind;
	metrics: CreditQuote["metrics"];
	idempotencyKey: string;
	quote: CreditQuote;
	expiresAt?: Date;
}

export interface CreditOperationResult {
	id: string;
	state: CreditOperationState;
	finalCharge: number | null;
}

export type CreditSubscriptionOriginErrorCode =
	| "unresolved"
	| "missing"
	| "ownership_mismatch"
	| "invalid_period";

export class CreditSubscriptionOriginError extends Error {
	readonly code: CreditSubscriptionOriginErrorCode;

	constructor(code: CreditSubscriptionOriginErrorCode) {
		super(`Credit operation subscription origin is ${code}`);
		this.name = "CreditSubscriptionOriginError";
		this.code = code;
	}
}

function now(): Date {
	return new Date();
}

function operationResult(operation: CreditOperation): CreditOperationResult {
	return {
		id: operation.id,
		state: operation.state,
		finalCharge: operation.finalCharge,
	};
}

function requireProject(
	store: CreditServiceStore,
	userId: string,
	projectId: string,
): CreditProject {
	const project = store.projects.get(projectId);
	if (!project || project.userId !== userId)
		throw new Error("Credit operation ownership mismatch");
	return project;
}

function requireSubscription(
	store: CreditServiceStore,
	userId: string,
): CreditSubscription {
	const subscription = [...store.subscriptions.values()].find(
		(row) => row.userId === userId,
	);
	if (!subscription) throw new CreditSubscriptionOriginError("missing");
	if (
		subscription.currentPeriodEnd &&
		subscription.currentPeriodEnd.getTime() < Date.now()
	) {
		throw new CreditSubscriptionOriginError("invalid_period");
	}
	return subscription;
}

function appendLedger(
	store: CreditServiceStore,
	input: Omit<CreditLedgerEntry, "id" | "createdAt">,
): void {
	store.ledger.push({ ...input, id: crypto.randomUUID(), createdAt: now() });
}

function requireOperation(
	store: CreditServiceStore,
	userId: string,
	operationId: string,
): CreditOperation {
	const operation = store.operations.get(operationId);
	if (!operation || operation.userId !== userId) {
		throw new Error("Credit operation ownership mismatch");
	}
	return operation;
}

function assertActiveReservation(state: CreditOperationState): void {
	if (state !== "reserved" && state !== "running" && state !== "settling") {
		throw new Error("Credit operation is not active");
	}
}

function isPermanentlyUnresolvableSubscription(
	operation: CreditOperation,
	store: CreditServiceStore,
): boolean {
	if (!operation.subscriptionId) return true;
	const subscription = store.subscriptions.get(operation.subscriptionId);
	return (
		!subscription ||
		subscription.userId !== operation.userId ||
		(subscription.currentPeriodEnd !== null &&
			subscription.currentPeriodEnd.getTime() < Date.now())
	);
}

function requireBoundSubscriptionId(subscriptionId: string | null): string {
	if (!subscriptionId) throw new CreditSubscriptionOriginError("unresolved");
	return subscriptionId;
}

function validateQuote(
	quote: CreditQuote,
	operation: CreditOperationKind,
	metrics: CreditQuote["metrics"],
): void {
	if (
		!Number.isInteger(quote.estimatedCredits) ||
		!Number.isInteger(quote.maximumCredits) ||
		!Number.isFinite(quote.estimatedCredits) ||
		!Number.isFinite(quote.maximumCredits) ||
		quote.estimatedCredits < 0 ||
		quote.maximumCredits < 0 ||
		quote.estimatedCredits > quote.maximumCredits
	) {
		throw new Error("Credit quote is invalid");
	}
	const serverQuote = estimateCreditQuote({
		operation,
		metrics,
	});
	if (
		quote.operation !== operation ||
		quote.pricingVersion !== serverQuote.pricingVersion ||
		quote.estimatedCredits !== serverQuote.estimatedCredits ||
		quote.maximumCredits !== serverQuote.maximumCredits ||
		JSON.stringify(quote.metrics) !== JSON.stringify(serverQuote.metrics) ||
		JSON.stringify(metrics) !== JSON.stringify(serverQuote.metrics)
	) {
		throw new Error("Credit quote does not match server pricing");
	}
}

export function createCreditService(store: CreditServiceStore) {
	return {
		createCreditQuote(input: CreditQuoteInput) {
			requireProject(store, input.userId, input.projectId);
			return estimateCreditQuote({
				operation: input.operation,
				metrics: input.metrics,
			});
		},

		reserveCreditOperation(
			input: ReserveCreditOperationInput,
		): CreditOperationResult {
			requireProject(store, input.userId, input.projectId);
			const existing = [...store.operations.values()].find(
				(operation) =>
					operation.userId === input.userId &&
					operation.idempotencyKey === input.idempotencyKey,
			);
			if (existing) return operationResult(existing);
			validateQuote(input.quote, input.operation, input.metrics);
			if (input.quote.estimatedCredits > input.quote.maximumCredits) {
				throw new Error("Credit quote exceeds its configured maximum");
			}
			const subscription = requireSubscription(store, input.userId);
			const available =
				subscription.credits -
				subscription.creditsUsed -
				subscription.creditsReserved;
			if (available < input.quote.maximumCredits)
				throw new Error("Insufficient available credit");
			const timestamp = now();
			const operation: CreditOperation = {
				id: crypto.randomUUID(),
				userId: input.userId,
				projectId: input.projectId,
				subscriptionId: subscription.id,
				kind: input.quote.operation,
				stage: input.stage,
				idempotencyKey: input.idempotencyKey,
				state: "reserved",
				estimatedCredits: input.quote.estimatedCredits,
				reservedCredits: input.quote.maximumCredits,
				maximumCredits: input.quote.maximumCredits,
				finalCharge: null,
				pricingVersion: input.quote.pricingVersion,
				metrics: input.quote.metrics,
				capApplied: false,
				artifactReference: null,
				failureReason: null,
				reconciliation: { status: "not_required" },
				expiresAt: input.expiresAt ?? null,
				createdAt: timestamp,
				updatedAt: timestamp,
			};
			store.operations.set(operation.id, operation);
			subscription.creditsReserved += operation.reservedCredits;
			appendLedger(store, {
				userId: input.userId,
				operationId: operation.id,
				amount: -operation.reservedCredits,
				entryType: "reservation",
				reason: "credit reservation",
				pricingVersion: input.quote.pricingVersion,
			});
			return operationResult(operation);
		},

		markCreditOperationRunning(input: {
			userId: string;
			operationId: string;
		}): CreditOperationResult {
			const operation = requireOperation(
				store,
				input.userId,
				input.operationId,
			);
			if (operation.state !== "reserved")
				throw new Error("Credit operation is not reserved");
			operation.state = "running";
			operation.updatedAt = now();
			return operationResult(operation);
		},

		settleCreditOperation(input: {
			userId: string;
			operationId: string;
			finalCharge: number;
			measuredUnits: number;
			artifactReference: string;
		}): CreditOperationResult {
			const operation = requireOperation(
				store,
				input.userId,
				input.operationId,
			);
			assertActiveReservation(operation.state);
			if (
				!Number.isInteger(input.finalCharge) ||
				input.finalCharge < 0 ||
				input.finalCharge > operation.maximumCredits
			) {
				throw new Error("Final credit charge is outside the operation maximum");
			}
			if (!Number.isFinite(input.measuredUnits) || input.measuredUnits < 0) {
				throw new Error("Measured credit usage is invalid");
			}
			const subscriptionId = requireBoundSubscriptionId(
				operation.subscriptionId,
			);
			const subscription = store.subscriptions.get(subscriptionId);
			if (
				!subscription ||
				subscription.userId !== input.userId ||
				(subscription.currentPeriodEnd &&
					subscription.currentPeriodEnd.getTime() < Date.now())
			) {
				throw new CreditSubscriptionOriginError("missing");
			}
			const release = operation.reservedCredits - input.finalCharge;
			subscription.creditsReserved -= operation.reservedCredits;
			subscription.creditsUsed += input.finalCharge;
			if (release > 0)
				appendLedger(store, {
					userId: input.userId,
					operationId: operation.id,
					amount: release,
					entryType: "release",
					reason: "unused credit reservation released",
					pricingVersion: operation.pricingVersion,
				});
			if (input.finalCharge > 0)
				appendLedger(store, {
					userId: input.userId,
					operationId: operation.id,
					amount: -input.finalCharge,
					entryType: "debit",
					reason: "credit operation settled",
					pricingVersion: operation.pricingVersion,
				});
			operation.state = "settled";
			operation.finalCharge = input.finalCharge;
			operation.reservedCredits = 0;
			operation.artifactReference = input.artifactReference;
			operation.usage = { measuredUnits: input.measuredUnits };
			operation.capApplied =
				input.finalCharge === operation.maximumCredits &&
				input.measuredUnits > input.finalCharge;
			operation.updatedAt = now();
			return operationResult(operation);
		},

		releaseCreditOperation(input: {
			userId: string;
			operationId: string;
			reason: string;
		}): CreditOperationResult {
			const operation = requireOperation(
				store,
				input.userId,
				input.operationId,
			);
			assertActiveReservation(operation.state);
			const subscriptionId = requireBoundSubscriptionId(
				operation.subscriptionId,
			);
			const subscription = store.subscriptions.get(subscriptionId);
			if (
				!subscription ||
				subscription.userId !== input.userId ||
				(subscription.currentPeriodEnd &&
					subscription.currentPeriodEnd.getTime() < Date.now())
			) {
				throw new CreditSubscriptionOriginError("missing");
			}
			const released = operation.reservedCredits;
			subscription.creditsReserved -= released;
			if (released > 0)
				appendLedger(store, {
					userId: input.userId,
					operationId: operation.id,
					amount: released,
					entryType: "release",
					reason: input.reason,
					pricingVersion: operation.pricingVersion,
				});
			operation.state = "released";
			operation.reservedCredits = 0;
			operation.failureReason = input.reason;
			operation.updatedAt = now();
			return operationResult(operation);
		},

		quarantineCreditOperation(input: {
			userId: string;
			operationId: string;
			reason: string;
		}): CreditOperationResult {
			const operation = requireOperation(
				store,
				input.userId,
				input.operationId,
			);
			assertActiveReservation(operation.state);
			const subscription = operation.subscriptionId
				? store.subscriptions.get(operation.subscriptionId)
				: undefined;
			if (subscription && subscription.userId === input.userId) {
				subscription.creditsReserved -= operation.reservedCredits;
			}
			if (operation.reservedCredits > 0)
				appendLedger(store, {
					userId: input.userId,
					operationId: operation.id,
					amount: operation.reservedCredits,
					entryType: "correction",
					reason: input.reason,
					metadata: {
						reconciliationCode: "subscription_origin_unresolvable",
						accounting: "manual_correction_required",
					},
					pricingVersion: operation.pricingVersion,
				});
			operation.state = "quarantined";
			operation.reservedCredits = 0;
			operation.failureReason = input.reason;
			operation.reconciliation = {
				status: "resolved",
				code: "subscription_origin_unresolvable",
				accounting: "manual_correction_required",
				resolvedAt: now().toISOString(),
			};
			operation.updatedAt = now();
			return operationResult(operation);
		},

		refundCreditOperation(input: {
			userId: string;
			operationId: string;
			reason: string;
		}): CreditOperationResult {
			const operation = requireOperation(
				store,
				input.userId,
				input.operationId,
			);
			if (operation.state !== "settled" || operation.finalCharge === null) {
				throw new Error("Only settled credit operations can be refunded");
			}
			const subscriptionId = requireBoundSubscriptionId(
				operation.subscriptionId,
			);
			const subscription = store.subscriptions.get(subscriptionId);
			if (
				!subscription ||
				subscription.userId !== input.userId ||
				(subscription.currentPeriodEnd &&
					subscription.currentPeriodEnd.getTime() < Date.now())
			) {
				throw new CreditSubscriptionOriginError("missing");
			}
			subscription.creditsUsed -= operation.finalCharge;
			appendLedger(store, {
				userId: input.userId,
				operationId: operation.id,
				amount: operation.finalCharge,
				entryType: "refund",
				reason: input.reason,
				pricingVersion: operation.pricingVersion,
			});
			operation.state = "refunded";
			operation.updatedAt = now();
			return operationResult(operation);
		},

		getCreditOperation(input: {
			userId: string;
			operationId: string;
		}): CreditOperationResult {
			return operationResult(
				requireOperation(store, input.userId, input.operationId),
			);
		},

		reconcileExpiredCreditOperations(input: { userId: string; now: Date }): {
			releasedOperationIds: string[];
		} {
			const releasedOperationIds: string[] = [];
			for (const operation of store.operations.values()) {
				if (
					operation.userId !== input.userId ||
					!operation.expiresAt ||
					operation.expiresAt > input.now
				)
					continue;
				if (!["reserved", "running", "settling"].includes(operation.state))
					continue;
				operation.state = "settling";
				try {
					this.releaseCreditOperation({
						userId: input.userId,
						operationId: operation.id,
						reason: "operation expired",
					});
					releasedOperationIds.push(operation.id);
				} catch {
					if (isPermanentlyUnresolvableSubscription(operation, store)) {
						this.quarantineCreditOperation({
							userId: input.userId,
							operationId: operation.id,
							reason: "subscription origin is permanently unresolvable",
						});
					}
				}
			}
			return { releasedOperationIds };
		},
	};
}

export type CreditService = ReturnType<typeof createCreditService>;

export function createCreditQuote(input: CreditQuoteInput): CreditQuote {
	return estimateCreditQuote({
		operation: input.operation,
		metrics: input.metrics,
	});
}

async function getDatabase() {
	const { db } = await import("@/db");
	const schema = await import("@/db/schema");
	return { db, schema };
}

export async function reserveCreditOperation(
	input: ReserveCreditOperationInput,
): Promise<CreditOperationResult> {
	const { db, schema } = await getDatabase();
	return db.transaction(async (tx) => {
		const [project] = await tx
			.select({ id: schema.projects.id })
			.from(schema.projects)
			.where(
				and(
					eq(schema.projects.id, input.projectId),
					eq(schema.projects.userId, input.userId),
				),
			)
			.limit(1);
		if (!project) throw new Error("Credit operation ownership mismatch");

		const [existing] = await tx
			.select({
				id: schema.creditOperations.id,
				state: schema.creditOperations.state,
				finalCharge: schema.creditOperations.finalCharge,
			})
			.from(schema.creditOperations)
			.where(
				and(
					eq(schema.creditOperations.userId, input.userId),
					eq(schema.creditOperations.idempotencyKey, input.idempotencyKey),
				),
			)
			.limit(1);
		if (existing)
			return {
				id: existing.id,
				state: existing.state,
				finalCharge: existing.finalCharge,
			};
		validateQuote(input.quote, input.operation, input.metrics);

		const [subscription] = await tx
			.select({ id: schema.subscriptions.id })
			.from(schema.subscriptions)
			.where(
				and(
					eq(schema.subscriptions.userId, input.userId),
					gt(schema.subscriptions.credits, schema.subscriptions.creditsUsed),
					orValidPeriod(schema.subscriptions.currentPeriodEnd),
				),
			)
			.orderBy(desc(schema.subscriptions.createdAt))
			.limit(1);
		if (!subscription) throw new CreditSubscriptionOriginError("missing");
		const [operation] = await tx
			.insert(schema.creditOperations)
			.values({
				id: crypto.randomUUID(),
				userId: input.userId,
				projectId: input.projectId,
				subscriptionId: subscription.id,
				kind: input.operation,
				stage: input.stage,
				idempotencyKey: input.idempotencyKey,
				state: "quoted",
				estimatedCredits: input.quote.estimatedCredits,
				reservedCredits: 0,
				maximumCredits: input.quote.maximumCredits,
				pricingVersion: input.quote.pricingVersion,
				metrics: input.quote.metrics,
				expiresAt: input.expiresAt,
			})
			.onConflictDoNothing({
				target: [
					schema.creditOperations.userId,
					schema.creditOperations.idempotencyKey,
				],
			})
			.returning();
		if (!operation) {
			const [retry] = await tx
				.select()
				.from(schema.creditOperations)
				.where(
					and(
						eq(schema.creditOperations.userId, input.userId),
						eq(schema.creditOperations.idempotencyKey, input.idempotencyKey),
					),
				)
				.limit(1);
			if (!retry) throw new Error("Credit operation idempotency conflict");
			return {
				id: retry.id,
				state: retry.state,
				finalCharge: retry.finalCharge,
			};
		}

		const updated = await tx
			.update(schema.subscriptions)
			.set({
				creditsReserved: sql`${schema.subscriptions.creditsReserved} + ${input.quote.maximumCredits}`,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(schema.subscriptions.id, subscription.id),
					sql`${schema.subscriptions.credits} - ${schema.subscriptions.creditsUsed} - ${schema.subscriptions.creditsReserved} >= ${input.quote.maximumCredits}`,
					orValidPeriod(schema.subscriptions.currentPeriodEnd),
				),
			)
			.returning({ id: schema.subscriptions.id });
		if (!updated.length) throw new Error("Insufficient available credit");
		const operationUpdates = await tx
			.update(schema.creditOperations)
			.set({
				state: "reserved",
				reservedCredits: input.quote.maximumCredits,
				reservedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(schema.creditOperations.id, operation.id),
					eq(schema.creditOperations.state, "quoted"),
				),
			)
			.returning({ id: schema.creditOperations.id });
		if (operationUpdates.length !== 1)
			throw new Error("Credit operation reservation transition conflict");
		await tx.insert(schema.creditLedgerEntries).values({
			id: crypto.randomUUID(),
			userId: input.userId,
			operationId: operation.id,
			amount: -input.quote.maximumCredits,
			entryType: "reservation",
			sourceCategory: "adaptive_credit",
			pricingVersion: input.quote.pricingVersion,
			metadata: { reason: "credit reservation" },
		});
		return { id: operation.id, state: "reserved", finalCharge: null };
	});
}

export async function quarantineCreditOperation(input: {
	userId: string;
	operationId: string;
	reason: string;
}): Promise<CreditOperationResult> {
	const { db, schema } = await getDatabase();
	return db.transaction(async (tx) => {
		const [operation] = await tx
			.select()
			.from(schema.creditOperations)
			.where(
				and(
					eq(schema.creditOperations.id, input.operationId),
					eq(schema.creditOperations.userId, input.userId),
				),
			)
			.for("update")
			.limit(1);
		if (!operation) throw new Error("Credit operation ownership mismatch");
		if (!["reserved", "running", "settling"].includes(operation.state))
			throw new Error("Credit operation is not active");
		if (operation.subscriptionId) {
			const [subscription] = await tx
				.select({ id: schema.subscriptions.id })
				.from(schema.subscriptions)
				.where(
					and(
						eq(schema.subscriptions.id, operation.subscriptionId),
						eq(schema.subscriptions.userId, input.userId),
					),
				)
				.for("update")
				.limit(1);
			if (subscription) {
				await tx
					.update(schema.subscriptions)
					.set({
						creditsReserved: sql`${schema.subscriptions.creditsReserved} - ${operation.reservedCredits}`,
						updatedAt: new Date(),
					})
					.where(eq(schema.subscriptions.id, subscription.id));
			}
		}
		if (operation.reservedCredits > 0)
			await tx.insert(schema.creditLedgerEntries).values({
				id: crypto.randomUUID(),
				userId: input.userId,
				operationId: operation.id,
				amount: operation.reservedCredits,
				entryType: "correction",
				sourceCategory: "manual_correction",
				pricingVersion: operation.pricingVersion,
				metadata: {
					reason: input.reason,
					reconciliationCode: "subscription_origin_unresolvable",
					accounting: "manual_correction_required",
				},
			});
		const [updated] = await tx
			.update(schema.creditOperations)
			.set({
				state: "quarantined",
				reservedCredits: 0,
				reconciliation: {
					status: "resolved",
					code: "subscription_origin_unresolvable",
					accounting: "manual_correction_required",
					resolvedAt: new Date().toISOString(),
				},
				failure: {
					message: input.reason,
					occurredAt: new Date().toISOString(),
				},
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(schema.creditOperations.id, operation.id),
					eq(schema.creditOperations.userId, input.userId),
				),
			)
			.returning({
				id: schema.creditOperations.id,
				state: schema.creditOperations.state,
				finalCharge: schema.creditOperations.finalCharge,
			});
		if (!updated) throw new Error("Credit operation quarantine conflict");
		return updated;
	});
}

export async function markCreditOperationRunning(input: {
	userId: string;
	operationId: string;
}): Promise<CreditOperationResult> {
	const { db, schema } = await getDatabase();
	return db.transaction(async (tx) => {
		const [operation] = await tx
			.select()
			.from(schema.creditOperations)
			.where(
				and(
					eq(schema.creditOperations.id, input.operationId),
					eq(schema.creditOperations.userId, input.userId),
				),
			)
			.for("update")
			.limit(1);
		if (!operation) throw new Error("Credit operation ownership mismatch");
		if (operation.state !== "reserved")
			throw new Error("Credit operation is not reserved");
		const updated = await tx
			.update(schema.creditOperations)
			.set({ state: "running", startedAt: new Date(), updatedAt: new Date() })
			.where(
				and(
					eq(schema.creditOperations.id, operation.id),
					eq(schema.creditOperations.state, "reserved"),
				),
			)
			.returning({
				id: schema.creditOperations.id,
				state: schema.creditOperations.state,
				finalCharge: schema.creditOperations.finalCharge,
			});
		if (updated.length !== 1)
			throw new Error("Credit operation transition conflict");
		return updated[0];
	});
}

export async function settleCreditOperation(input: {
	userId: string;
	operationId: string;
	finalCharge: number;
	measuredUnits: number;
	artifactReference: string;
}): Promise<CreditOperationResult> {
	if (!Number.isInteger(input.finalCharge) || input.finalCharge < 0)
		throw new Error("Final credit charge is invalid");
	if (!Number.isFinite(input.measuredUnits) || input.measuredUnits < 0)
		throw new Error("Measured credit usage is invalid");
	const { db, schema } = await getDatabase();
	return db.transaction(async (tx) => {
		const [operation] = await tx
			.select()
			.from(schema.creditOperations)
			.where(
				and(
					eq(schema.creditOperations.id, input.operationId),
					eq(schema.creditOperations.userId, input.userId),
				),
			)
			.for("update")
			.limit(1);
		if (!operation) throw new Error("Credit operation ownership mismatch");
		if (!["reserved", "running", "settling"].includes(operation.state))
			throw new Error("Credit operation is already terminal");
		if (input.finalCharge > operation.maximumCredits)
			throw new Error("Final credit charge exceeds operation maximum");
		const subscriptionId = requireBoundSubscriptionId(operation.subscriptionId);
		const [subscription] = await tx
			.select({ id: schema.subscriptions.id })
			.from(schema.subscriptions)
			.where(
				and(
					eq(schema.subscriptions.userId, input.userId),
					eq(schema.subscriptions.id, subscriptionId),
					orValidPeriod(schema.subscriptions.currentPeriodEnd),
				),
			)
			.orderBy(desc(schema.subscriptions.createdAt))
			.limit(1)
			.for("update");
		if (!subscription) throw new CreditSubscriptionOriginError("missing");
		const release = operation.reservedCredits - input.finalCharge;
		if (release < 0)
			throw new Error("Final credit charge exceeds reserved credit");
		const subscriptionUpdates = await tx
			.update(schema.subscriptions)
			.set({
				creditsReserved: sql`${schema.subscriptions.creditsReserved} - ${operation.reservedCredits}`,
				creditsUsed: sql`${schema.subscriptions.creditsUsed} + ${input.finalCharge}`,
				updatedAt: new Date(),
			})
			.where(eq(schema.subscriptions.id, subscription.id))
			.returning({ id: schema.subscriptions.id });
		if (subscriptionUpdates.length !== 1)
			throw new Error("Credit subscription settlement conflict");
		if (release > 0)
			await tx.insert(schema.creditLedgerEntries).values({
				id: crypto.randomUUID(),
				userId: input.userId,
				operationId: operation.id,
				amount: release,
				entryType: "release",
				sourceCategory: "adaptive_credit",
				pricingVersion: operation.pricingVersion,
				metadata: { reason: "unused credit reservation released" },
			});
		if (input.finalCharge > 0)
			await tx.insert(schema.creditLedgerEntries).values({
				id: crypto.randomUUID(),
				userId: input.userId,
				operationId: operation.id,
				amount: -input.finalCharge,
				entryType: "debit",
				sourceCategory: "adaptive_credit",
				pricingVersion: operation.pricingVersion,
				metadata: {
					reason: "credit operation settled",
					measuredUnits: input.measuredUnits,
				},
			});
		const updated = await tx
			.update(schema.creditOperations)
			.set({
				state: "settled",
				reservedCredits: 0,
				finalCharge: input.finalCharge,
				artifactReference: input.artifactReference,
				usage: { measuredUnits: input.measuredUnits },
				capApplied:
					input.finalCharge === operation.maximumCredits &&
					input.measuredUnits > input.finalCharge,
				settledAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(schema.creditOperations.id, operation.id),
					eq(schema.creditOperations.userId, input.userId),
					sql`${schema.creditOperations.state} IN ('reserved', 'running', 'settling')`,
				),
			)
			.returning({
				id: schema.creditOperations.id,
				state: schema.creditOperations.state,
				finalCharge: schema.creditOperations.finalCharge,
			});
		if (updated.length !== 1)
			throw new Error("Credit operation settlement conflict");
		return updated[0];
	});
}

export async function releaseCreditOperation(input: {
	userId: string;
	operationId: string;
	reason: string;
}): Promise<CreditOperationResult> {
	const { db, schema } = await getDatabase();
	return db.transaction(async (tx) => {
		const [operation] = await tx
			.select()
			.from(schema.creditOperations)
			.where(
				and(
					eq(schema.creditOperations.id, input.operationId),
					eq(schema.creditOperations.userId, input.userId),
				),
			)
			.for("update")
			.limit(1);
		if (!operation) throw new Error("Credit operation ownership mismatch");
		if (!["reserved", "running", "settling"].includes(operation.state))
			throw new Error("Credit operation is not active");
		const subscriptionId = requireBoundSubscriptionId(operation.subscriptionId);
		const [subscription] = await tx
			.select({ id: schema.subscriptions.id })
			.from(schema.subscriptions)
			.where(
				and(
					eq(schema.subscriptions.userId, input.userId),
					eq(schema.subscriptions.id, subscriptionId),
					orValidPeriod(schema.subscriptions.currentPeriodEnd),
				),
			)
			.orderBy(desc(schema.subscriptions.createdAt))
			.limit(1)
			.for("update");
		if (!subscription) throw new CreditSubscriptionOriginError("missing");
		const subscriptionUpdates = await tx
			.update(schema.subscriptions)
			.set({
				creditsReserved: sql`${schema.subscriptions.creditsReserved} - ${operation.reservedCredits}`,
				updatedAt: new Date(),
			})
			.where(eq(schema.subscriptions.id, subscription.id))
			.returning({ id: schema.subscriptions.id });
		if (subscriptionUpdates.length !== 1)
			throw new Error("Credit subscription release conflict");
		if (operation.reservedCredits > 0)
			await tx.insert(schema.creditLedgerEntries).values({
				id: crypto.randomUUID(),
				userId: input.userId,
				operationId: operation.id,
				amount: operation.reservedCredits,
				entryType: "release",
				sourceCategory: "adaptive_credit",
				pricingVersion: operation.pricingVersion,
				metadata: { reason: input.reason },
			});
		const updated = await tx
			.update(schema.creditOperations)
			.set({
				state: "released",
				reservedCredits: 0,
				releasedAt: new Date(),
				failure: {
					message: input.reason,
					occurredAt: new Date().toISOString(),
				},
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(schema.creditOperations.id, operation.id),
					sql`${schema.creditOperations.state} IN ('reserved', 'running', 'settling')`,
				),
			)
			.returning({
				id: schema.creditOperations.id,
				state: schema.creditOperations.state,
				finalCharge: schema.creditOperations.finalCharge,
			});
		if (updated.length !== 1)
			throw new Error("Credit operation release conflict");
		return updated[0];
	});
}

export async function refundCreditOperation(input: {
	userId: string;
	operationId: string;
	reason: string;
}): Promise<CreditOperationResult> {
	const { db, schema } = await getDatabase();
	return db.transaction(async (tx) => {
		const [operation] = await tx
			.select()
			.from(schema.creditOperations)
			.where(
				and(
					eq(schema.creditOperations.id, input.operationId),
					eq(schema.creditOperations.userId, input.userId),
				),
			)
			.for("update")
			.limit(1);
		if (!operation) throw new Error("Credit operation ownership mismatch");
		if (operation.state !== "settled" || operation.finalCharge === null)
			throw new Error("Only settled credit operations can be refunded");
		const subscriptionId = requireBoundSubscriptionId(operation.subscriptionId);
		const [subscription] = await tx
			.select({ id: schema.subscriptions.id })
			.from(schema.subscriptions)
			.where(
				and(
					eq(schema.subscriptions.userId, input.userId),
					eq(schema.subscriptions.id, subscriptionId),
					orValidPeriod(schema.subscriptions.currentPeriodEnd),
				),
			)
			.orderBy(desc(schema.subscriptions.createdAt))
			.limit(1)
			.for("update");
		if (!subscription) throw new CreditSubscriptionOriginError("missing");
		const subscriptionUpdates = await tx
			.update(schema.subscriptions)
			.set({
				creditsUsed: sql`${schema.subscriptions.creditsUsed} - ${operation.finalCharge}`,
				updatedAt: new Date(),
			})
			.where(eq(schema.subscriptions.id, subscription.id))
			.returning({ id: schema.subscriptions.id });
		if (subscriptionUpdates.length !== 1)
			throw new Error("Credit subscription refund conflict");
		await tx.insert(schema.creditLedgerEntries).values({
			id: crypto.randomUUID(),
			userId: input.userId,
			operationId: operation.id,
			amount: operation.finalCharge,
			entryType: "refund",
			sourceCategory: "adaptive_credit",
			pricingVersion: operation.pricingVersion,
			metadata: { reason: input.reason },
		});
		const updated = await tx
			.update(schema.creditOperations)
			.set({ state: "refunded", updatedAt: new Date() })
			.where(
				and(
					eq(schema.creditOperations.id, operation.id),
					eq(schema.creditOperations.state, "settled"),
				),
			)
			.returning({
				id: schema.creditOperations.id,
				state: schema.creditOperations.state,
				finalCharge: schema.creditOperations.finalCharge,
			});
		if (updated.length !== 1)
			throw new Error("Credit operation refund conflict");
		return updated[0];
	});
}

export async function getCreditOperation(input: {
	userId: string;
	operationId: string;
}): Promise<CreditOperationResult> {
	const { db, schema } = await getDatabase();
	const [operation] = await db
		.select({
			id: schema.creditOperations.id,
			state: schema.creditOperations.state,
			finalCharge: schema.creditOperations.finalCharge,
		})
		.from(schema.creditOperations)
		.where(
			and(
				eq(schema.creditOperations.id, input.operationId),
				eq(schema.creditOperations.userId, input.userId),
			),
		)
		.limit(1);
	if (!operation) throw new Error("Credit operation ownership mismatch");
	return operation;
}

export async function reconcileExpiredCreditOperations(input: {
	userId: string;
	now?: Date;
}): Promise<{ releasedOperationIds: string[] }> {
	const { db, schema } = await getDatabase();
	const nowValue = input.now ?? new Date();
	const claimed = await db.transaction(async (tx) => {
		const settling = await tx
			.select({ id: schema.creditOperations.id })
			.from(schema.creditOperations)
			.where(
				and(
					eq(schema.creditOperations.userId, input.userId),
					sql`${schema.creditOperations.expiresAt} <= ${nowValue}`,
					eq(schema.creditOperations.state, "settling"),
				),
			)
			.for("update");
		const newlyClaimed = await tx
			.update(schema.creditOperations)
			.set({ state: "settling", updatedAt: nowValue })
			.where(
				and(
					eq(schema.creditOperations.userId, input.userId),
					sql`${schema.creditOperations.expiresAt} <= ${nowValue}`,
					sql`${schema.creditOperations.state} IN ('reserved', 'running')`,
				),
			)
			.returning({ id: schema.creditOperations.id });
		return [...settling, ...newlyClaimed];
	});
	const releasedOperationIds: string[] = [];
	for (const operation of claimed) {
		try {
			const result = await releaseCreditOperation({
				userId: input.userId,
				operationId: operation.id,
				reason: "operation expired",
			});
			if (result.state === "released") releasedOperationIds.push(operation.id);
		} catch (error) {
			if (error instanceof CreditSubscriptionOriginError) {
				await quarantineCreditOperation({
					userId: input.userId,
					operationId: operation.id,
					reason: "subscription origin is permanently unresolvable",
				});
			}
			// Other failures remain in settling for a later retry.
		}
	}
	return { releasedOperationIds };
}

function orValidPeriod(period: AnyColumn) {
	return sql`(${period} IS NULL OR ${period} >= now())`;
}

export function reserveCreditOperationWithStore(
	store: CreditServiceStore,
	input: ReserveCreditOperationInput,
): CreditOperationResult {
	return createCreditService(store).reserveCreditOperation(input);
}
