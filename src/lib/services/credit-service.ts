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
	idempotencyKey: string;
	quote: CreditQuote;
	expiresAt?: Date;
}

export interface CreditOperationResult {
	id: string;
	state: CreditOperationState;
	finalCharge: number | null;
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
	if (!subscription)
		throw new Error("Active subscription is required for credit operation");
	if (
		subscription.currentPeriodEnd &&
		subscription.currentPeriodEnd.getTime() < Date.now()
	) {
		throw new Error("Subscription period is expired");
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

function assertTerminal(operation: CreditOperation): void {
	if (["settled", "released", "failed", "refunded"].includes(operation.state)) {
		throw new Error("Credit operation is already terminal");
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
				artifactReference: null,
				failureReason: null,
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
			assertTerminal(operation);
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
			const subscription = requireSubscription(store, input.userId);
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
				});
			if (input.finalCharge > 0)
				appendLedger(store, {
					userId: input.userId,
					operationId: operation.id,
					amount: -input.finalCharge,
					entryType: "debit",
					reason: "credit operation settled",
				});
			operation.state = "settled";
			operation.finalCharge = input.finalCharge;
			operation.reservedCredits = 0;
			operation.artifactReference = input.artifactReference;
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
			assertTerminal(operation);
			const subscription = requireSubscription(store, input.userId);
			const released = operation.reservedCredits;
			subscription.creditsReserved -= released;
			if (released > 0)
				appendLedger(store, {
					userId: input.userId,
					operationId: operation.id,
					amount: released,
					entryType: "release",
					reason: input.reason,
				});
			operation.state = "released";
			operation.reservedCredits = 0;
			operation.failureReason = input.reason;
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
			const subscription = requireSubscription(store, input.userId);
			subscription.creditsUsed -= operation.finalCharge;
			appendLedger(store, {
				userId: input.userId,
				operationId: operation.id,
				amount: operation.finalCharge,
				entryType: "refund",
				reason: input.reason,
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
				this.releaseCreditOperation({
					userId: input.userId,
					operationId: operation.id,
					reason: "operation expired",
				});
				releasedOperationIds.push(operation.id);
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
		if (!subscription)
			throw new Error("Active subscription is required for credit operation");

		const [operation] = await tx
			.insert(schema.creditOperations)
			.values({
				id: crypto.randomUUID(),
				userId: input.userId,
				projectId: input.projectId,
				kind: input.quote.operation,
				stage: input.stage,
				idempotencyKey: input.idempotencyKey,
				state: "quoted",
				estimatedCredits: input.quote.estimatedCredits,
				reservedCredits: 0,
				maximumCredits: input.quote.maximumCredits,
				pricingVersion: input.quote.pricingVersion,
				metrics: input.quote.metrics,
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
		await tx
			.update(schema.creditOperations)
			.set({
				state: "reserved",
				reservedCredits: input.quote.maximumCredits,
				reservedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(schema.creditOperations.id, operation.id));
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
		const [updated] = await tx
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
		if (!updated) throw new Error("Credit operation transition conflict");
		return updated;
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
		const [subscription] = await tx
			.select({ id: schema.subscriptions.id })
			.from(schema.subscriptions)
			.where(
				and(
					eq(schema.subscriptions.userId, input.userId),
					orValidPeriod(schema.subscriptions.currentPeriodEnd),
				),
			)
			.orderBy(desc(schema.subscriptions.createdAt))
			.limit(1)
			.for("update");
		if (!subscription)
			throw new Error("Active subscription is required for credit operation");
		const release = operation.reservedCredits - input.finalCharge;
		if (release < 0)
			throw new Error("Final credit charge exceeds reserved credit");
		await tx
			.update(schema.subscriptions)
			.set({
				creditsReserved: sql`${schema.subscriptions.creditsReserved} - ${operation.reservedCredits}`,
				creditsUsed: sql`${schema.subscriptions.creditsUsed} + ${input.finalCharge}`,
				updatedAt: new Date(),
			})
			.where(eq(schema.subscriptions.id, subscription.id));
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
		const [updated] = await tx
			.update(schema.creditOperations)
			.set({
				state: "settled",
				reservedCredits: 0,
				finalCharge: input.finalCharge,
				artifactReference: input.artifactReference,
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
		if (!updated) throw new Error("Credit operation settlement conflict");
		return updated;
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
			return {
				id: operation.id,
				state: operation.state,
				finalCharge: operation.finalCharge,
			};
		const [subscription] = await tx
			.select({ id: schema.subscriptions.id })
			.from(schema.subscriptions)
			.where(
				and(
					eq(schema.subscriptions.userId, input.userId),
					orValidPeriod(schema.subscriptions.currentPeriodEnd),
				),
			)
			.orderBy(desc(schema.subscriptions.createdAt))
			.limit(1)
			.for("update");
		if (!subscription)
			throw new Error("Active subscription is required for credit operation");
		await tx
			.update(schema.subscriptions)
			.set({
				creditsReserved: sql`${schema.subscriptions.creditsReserved} - ${operation.reservedCredits}`,
				updatedAt: new Date(),
			})
			.where(eq(schema.subscriptions.id, subscription.id));
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
		const [updated] = await tx
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
		if (!updated) throw new Error("Credit operation release conflict");
		return updated;
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
		const [subscription] = await tx
			.select({ id: schema.subscriptions.id })
			.from(schema.subscriptions)
			.where(eq(schema.subscriptions.userId, input.userId))
			.orderBy(desc(schema.subscriptions.createdAt))
			.limit(1)
			.for("update");
		if (!subscription)
			throw new Error("Active subscription is required for credit operation");
		await tx
			.update(schema.subscriptions)
			.set({
				creditsUsed: sql`${schema.subscriptions.creditsUsed} - ${operation.finalCharge}`,
				updatedAt: new Date(),
			})
			.where(eq(schema.subscriptions.id, subscription.id));
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
		const [updated] = await tx
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
		if (!updated) throw new Error("Credit operation refund conflict");
		return updated;
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
	const operations = await db
		.select({ id: schema.creditOperations.id })
		.from(schema.creditOperations)
		.where(
			and(
				eq(schema.creditOperations.userId, input.userId),
				sql`${schema.creditOperations.expiresAt} <= ${nowValue}`,
				sql`${schema.creditOperations.state} IN ('reserved', 'running', 'settling')`,
			),
		);
	for (const operation of operations)
		await releaseCreditOperation({
			userId: input.userId,
			operationId: operation.id,
			reason: "operation expired",
		});
	return { releasedOperationIds: operations.map((operation) => operation.id) };
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
