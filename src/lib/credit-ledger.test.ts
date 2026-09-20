import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { PgDialect } from "drizzle-orm/pg-core/dialect";
import { describe, expect, it, vi } from "vitest";
import { creditLedgerEntries, creditOperations } from "@/db/schema";
import {
	appendCreditLedgerEntry,
	buildCreditUsageConditions,
	type CreditLedgerPersistence,
	createCreditOperation,
	findCreditOperationByIdempotencyKey,
	listCreditUsage,
	parseCreditLedgerMetadata,
	parseCreditLedgerSource,
} from "@/lib/credit-ledger";

describe("credit ledger persistence contracts", () => {
	it("keeps operation idempotency scoped to the authenticated user", async () => {
		const find = vi.fn().mockResolvedValue({ id: "operation-1" });
		const persistence: Pick<
			CreditLedgerPersistence,
			"findOperationByIdempotencyKey"
		> = {
			findOperationByIdempotencyKey: find,
		};

		await findCreditOperationByIdempotencyKey(persistence, {
			userId: "user-1",
			idempotencyKey: "request-1",
		});

		expect(find).toHaveBeenCalledWith({
			userId: "user-1",
			idempotencyKey: "request-1",
		});
	});

	it("creates an operation with the typed Task 1 quote fields", async () => {
		const create = vi.fn().mockResolvedValue({ id: "operation-1" });
		const persistence: Pick<CreditLedgerPersistence, "createOperation"> = {
			createOperation: create,
		};

		await createCreditOperation(persistence, {
			userId: "user-1",
			projectId: "project-1",
			subscriptionId: "subscription-1",
			operation: "prd_generation",
			stage: "prd",
			idempotencyKey: "request-1",
			quote: {
				operation: "prd_generation",
				pricingVersion: "adaptive-v1",
				estimatedCredits: 2,
				maximumCredits: 4,
				metrics: { promptChars: 120 },
			},
		});

		expect(create).toHaveBeenCalledOnce();
		expect(create.mock.calls[0]?.[0]).toMatchObject({
			userId: "user-1",
			projectId: "project-1",
			idempotencyKey: "request-1",
			estimatedCredits: 2,
			maximumCredits: 4,
			state: "quoted",
		});
	});

	it("rejects a quote whose estimate exceeds its maximum", async () => {
		const create = vi.fn();
		await expect(
			createCreditOperation(
				{ createOperation: create },
				{
					userId: "user-1",
					projectId: "project-1",
					subscriptionId: "subscription-1",
					operation: "prd_generation",
					stage: "prd",
					idempotencyKey: "request-2",
					quote: {
						operation: "prd_generation",
						pricingVersion: "adaptive-v1",
						estimatedCredits: 3,
						maximumCredits: 2,
						metrics: {},
					},
				},
			),
		).rejects.toThrow("maximum");
		expect(create).not.toHaveBeenCalled();
	});

	it("appends ledger entries without exposing mutation or deletion operations", async () => {
		const append = vi.fn().mockResolvedValue({ id: "entry-1" });
		const persistence: Pick<CreditLedgerPersistence, "appendLedgerEntry"> = {
			appendLedgerEntry: append,
		};

		await appendCreditLedgerEntry(persistence, {
			userId: "user-1",
			operationId: "operation-1",
			amount: -2,
			entryType: "reservation",
			source: "adaptive_credit",
			pricingVersion: "adaptive-v1",
			metadata: { reason: "quote reservation" },
		});

		expect(append).toHaveBeenCalledOnce();
		expect(append.mock.calls[0]?.[0]).toMatchObject({
			userId: "user-1",
			amount: -2,
			entryType: "reservation",
		});
		expect(persistence).not.toHaveProperty("updateLedgerEntry");
		expect(persistence).not.toHaveProperty("deleteLedgerEntry");
	});

	it("requires user ownership when reading usage metadata", async () => {
		const list = vi.fn().mockResolvedValue([]);
		const persistence: Pick<CreditLedgerPersistence, "listUsage"> = {
			listUsage: list,
		};

		await listCreditUsage(persistence, {
			userId: "user-1",
			projectId: "project-1",
			stage: "prd",
		});

		expect(list).toHaveBeenCalledWith({
			userId: "user-1",
			projectId: "project-1",
			stage: "prd",
		});
	});

	it("builds usage predicates for both operation and project ownership", () => {
		const conditions = buildCreditUsageConditions({
			userId: "user-1",
			projectId: "project-1",
			stage: "prd",
		});
		const query = new PgDialect().sqlToQuery(sql.join(conditions, sql` AND `));
		expect(query.sql).toContain('"credit_operations"."user_id"');
		expect(query.sql).toContain('"projects"."user_id"');
		expect(query.sql).toContain('"credit_operations"."project_id"');
		expect(query.sql).toContain('"credit_operations"."stage"');
	});

	it("declares ownership and credit-bound constraints in the Drizzle table config", () => {
		const operationConfig = getTableConfig(creditOperations);
		const ledgerConfig = getTableConfig(creditLedgerEntries);

		expect(
			operationConfig.foreignKeys.map((foreignKey) => foreignKey.getName()),
		).toContain("credit_operations_user_project_fk");
		expect(
			ledgerConfig.foreignKeys.map((foreignKey) => foreignKey.getName()),
		).toContain("credit_ledger_entries_user_operation_fk");
		expect(operationConfig.checks.map((check) => check.name)).toContain(
			"credit_operations_credit_bounds_check",
		);
		expect(ledgerConfig.checks.map((check) => check.name)).toContain(
			"credit_ledger_entries_amount_nonzero_check",
		);
	});

	it("accepts only project-owned ledger source categories", () => {
		expect(parseCreditLedgerSource("adaptive_credit")).toBe("adaptive_credit");
		expect(() => parseCreditLedgerSource("provider")).toThrow(
			"Unsupported credit ledger source category",
		);
	});

	it("rejects unknown ledger metadata keys", () => {
		expect(() =>
			parseCreditLedgerMetadata({ reason: "reservation", provider: "secret" }),
		).toThrow();
	});

	it("accepts manual correction metadata emitted by reconciliation", () => {
		expect(
			parseCreditLedgerMetadata({
				reason: "historical active reservation quarantined",
				reconciliationCode: "historical_active_reservation_quarantined",
				accounting: "manual_correction_required",
			}),
		).toMatchObject({
			reconciliationCode: "historical_active_reservation_quarantined",
			accounting: "manual_correction_required",
		});
	});

	it("rejects invalid measured units and unsafe metadata content", () => {
		expect(() =>
			parseCreditLedgerMetadata({ measuredUnits: Number.POSITIVE_INFINITY }),
		).toThrow();
		expect(() =>
			parseCreditLedgerMetadata({ reason: "https://provider.example/secret" }),
		).toThrow();
	});

	it("validates metadata before appending a ledger entry", async () => {
		const append = vi.fn();
		await expect(
			appendCreditLedgerEntry(
				{ appendLedgerEntry: append },
				{
					userId: "user-1",
					amount: -1,
					entryType: "reservation",
					source: "adaptive_credit",
					pricingVersion: "adaptive-v1",
					metadata: { measuredUnits: -1 },
				},
			),
		).rejects.toThrow();
		expect(append).not.toHaveBeenCalled();
	});

	it("ships a database trigger for ledger immutability", () => {
		const migration = readFileSync(
			"drizzle/0015_moaning_ozymandias.sql",
			"utf8",
		);
		expect(migration).toContain(
			'BEFORE UPDATE OR DELETE ON "credit_ledger_entries"',
		);
		expect(migration).toContain("credit ledger entries are append-only");
	});
});
