import { describe, expect, it, vi } from "vitest";

import {
	appendCreditLedgerEntry,
	type CreditLedgerPersistence,
	createCreditOperation,
	findCreditOperationByIdempotencyKey,
	listCreditUsage,
} from "@/lib/credit-ledger";

describe("credit ledger persistence contracts", () => {
	it("keeps operation idempotency scoped to the authenticated user", async () => {
		const find = vi.fn().mockResolvedValue({ id: "operation-1" });
		const persistence: CreditLedgerPersistence = {
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
		const persistence: CreditLedgerPersistence = {
			createOperation: create,
		};

		await createCreditOperation(persistence, {
			userId: "user-1",
			projectId: "project-1",
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

	it("appends ledger entries without exposing mutation or deletion operations", async () => {
		const append = vi.fn().mockResolvedValue({ id: "entry-1" });
		const persistence: CreditLedgerPersistence = {
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
		const persistence: CreditLedgerPersistence = {
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
});
