import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import type {
	CreditLedgerMetadata,
	CreditOperationFailure,
	CreditOperationReconciliation,
} from "@/db/schema";
import { creditLedgerEntries, creditOperations, projects } from "@/db/schema";
import type {
	CreditLedgerEntryType,
	CreditOperationKind,
	CreditOperationState,
	CreditPricingVersion,
	CreditQuote,
} from "@/lib/adaptive-credit";

export type CreditOperationInsert = typeof creditOperations.$inferInsert;
export type CreditOperationRow = typeof creditOperations.$inferSelect;
export type CreditLedgerEntryInsert = typeof creditLedgerEntries.$inferInsert;
export type CreditLedgerEntryRow = typeof creditLedgerEntries.$inferSelect;

export interface CreditOperationCreateInput {
	userId: string;
	projectId: string;
	operation: CreditOperationKind;
	stage: string;
	idempotencyKey: string;
	quote: CreditQuote;
	expiresAt?: Date;
}

export interface CreditLedgerAppendInput {
	userId: string;
	operationId?: string;
	amount: number;
	entryType: CreditLedgerEntryType;
	source: string;
	pricingVersion: CreditPricingVersion;
	metadata: CreditLedgerMetadata;
}

export interface CreditUsageQuery {
	userId: string;
	projectId?: string;
	stage?: string;
}

export interface CreditUsageRow {
	operationId: string;
	projectId: string;
	stage: string;
	operation: CreditOperationKind;
	state: CreditOperationState;
	estimatedCredits: number;
	reservedCredits: number;
	finalCharge: number | null;
	pricingVersion: CreditPricingVersion;
	createdAt: Date;
}

export interface CreditLedgerPersistence {
	createOperation?: (
		operation: CreditOperationInsert,
	) => Promise<CreditOperationRow>;
	findOperationByIdempotencyKey?: (input: {
		userId: string;
		idempotencyKey: string;
	}) => Promise<CreditOperationRow | undefined>;
	appendLedgerEntry?: (
		entry: CreditLedgerEntryInsert,
	) => Promise<CreditLedgerEntryRow>;
	listUsage?: (query: CreditUsageQuery) => Promise<CreditUsageRow[]>;
}

export function createCreditLedgerPersistence(
	database: typeof db,
): CreditLedgerPersistence {
	return {
		async createOperation(operation) {
			const [row] = await database
				.insert(creditOperations)
				.values(operation)
				.returning();
			if (!row) throw new Error("Credit operation was not created");
			return row;
		},
		async findOperationByIdempotencyKey(input) {
			const [row] = await database
				.select()
				.from(creditOperations)
				.where(
					and(
						eq(creditOperations.userId, input.userId),
						eq(creditOperations.idempotencyKey, input.idempotencyKey),
					),
				)
				.limit(1);
			return row;
		},
		async appendLedgerEntry(entry) {
			const [row] = await database
				.insert(creditLedgerEntries)
				.values(entry)
				.returning();
			if (!row) throw new Error("Credit ledger entry was not created");
			return row;
		},
		async listUsage(query) {
			const conditions = [eq(creditOperations.userId, query.userId)];
			if (query.projectId)
				conditions.push(eq(creditOperations.projectId, query.projectId));
			if (query.stage) conditions.push(eq(creditOperations.stage, query.stage));
			return database
				.select({
					operationId: creditOperations.id,
					projectId: creditOperations.projectId,
					stage: creditOperations.stage,
					operation: creditOperations.kind,
					state: creditOperations.state,
					estimatedCredits: creditOperations.estimatedCredits,
					reservedCredits: creditOperations.reservedCredits,
					finalCharge: creditOperations.finalCharge,
					pricingVersion: creditOperations.pricingVersion,
					createdAt: creditOperations.createdAt,
				})
				.from(creditOperations)
				.innerJoin(projects, eq(creditOperations.projectId, projects.id))
				.where(and(...conditions));
		},
	};
}

function requiredPersistenceMethod<Name extends keyof CreditLedgerPersistence>(
	persistence: CreditLedgerPersistence,
	name: Name,
): NonNullable<CreditLedgerPersistence[Name]> {
	const method = persistence[name];
	if (!method)
		throw new Error(`Credit ledger persistence method is required: ${name}`);
	return method;
}

export async function createCreditOperation(
	persistence: CreditLedgerPersistence,
	input: CreditOperationCreateInput,
): Promise<CreditOperationRow> {
	const createOperation = requiredPersistenceMethod(
		persistence,
		"createOperation",
	);
	return createOperation({
		id: crypto.randomUUID(),
		userId: input.userId,
		projectId: input.projectId,
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
	});
}

export async function findCreditOperationByIdempotencyKey(
	persistence: CreditLedgerPersistence,
	input: { userId: string; idempotencyKey: string },
): Promise<CreditOperationRow | undefined> {
	const findOperation = requiredPersistenceMethod(
		persistence,
		"findOperationByIdempotencyKey",
	);
	return findOperation(input);
}

export async function appendCreditLedgerEntry(
	persistence: CreditLedgerPersistence,
	input: CreditLedgerAppendInput,
): Promise<CreditLedgerEntryRow> {
	if (!Number.isInteger(input.amount) || input.amount === 0) {
		throw new Error("Credit ledger amount must be a non-zero integer");
	}

	const appendLedgerEntry = requiredPersistenceMethod(
		persistence,
		"appendLedgerEntry",
	);
	return appendLedgerEntry({
		id: crypto.randomUUID(),
		userId: input.userId,
		operationId: input.operationId,
		amount: input.amount,
		entryType: input.entryType,
		sourceCategory: input.source,
		pricingVersion: input.pricingVersion,
		metadata: input.metadata,
	});
}

export async function listCreditUsage(
	persistence: CreditLedgerPersistence,
	query: CreditUsageQuery,
): Promise<CreditUsageRow[]> {
	if (!query.userId) throw new Error("Credit usage queries require userId");
	const listUsage = requiredPersistenceMethod(persistence, "listUsage");
	return listUsage(query);
}

export type CreditOperationFailureShape = CreditOperationFailure;
export type CreditOperationReconciliationShape = CreditOperationReconciliation;
