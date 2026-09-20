import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const servicePath = new URL("./credit-service.ts", import.meta.url);
const migrationPath = new URL(
	"../../../drizzle/0016_lame_squirrel_girl.sql",
	import.meta.url,
);
const followUpMigrationPath = new URL(
	"../../../drizzle/0017_credit_operation_quarantine_fix.sql",
	import.meta.url,
);
const journalPath = new URL(
	"../../../drizzle/meta/_journal.json",
	import.meta.url,
);

describe("adaptive credit database contracts", () => {
	it("pins every mutating subscription lookup to the operation subscription", async () => {
		const source = await readFile(servicePath, "utf8");
		const mutationSections = source.match(
			/eq\(schema\.subscriptions\.id, subscriptionId\)[\s\S]*?\.for\("update"\)/g,
		);

		expect(mutationSections).toHaveLength(3);
		expect(source).toContain("state} IN ('reserved', 'running', 'settling')");
		expect(source).toContain(
			"Other failures remain in settling for a later retry.",
		);
		expect(source).toContain('eq(schema.creditOperations.state, "settling")');
	});

	it("uses quarantine metadata instead of guessing historical subscription origins", async () => {
		const migration = await readFile(migrationPath, "utf8");

		expect(migration).toContain('ADD COLUMN "subscription_id" text;');
		expect(migration).toContain("historical_subscription_unresolved");
		expect(migration).not.toContain('ORDER BY "subscriptions"."created_at"');
		expect(migration).not.toContain(
			'ALTER COLUMN "subscription_id" SET NOT NULL',
		);
		expect(migration).toContain("jsonb_build_object");
		expect(migration).toContain("jsonb_strip_nulls");
		expect(migration).toContain("historical_active_reservation_quarantined");
		expect(migration).toContain('"reserved_credits" = CASE');
		expect(migration).toContain("COALESCE(\"reconciliation\", '{}'::jsonb)");
		expect(migration).toContain("\"reconciliation\" ? 'status'");
	});

	it("keeps the deployed migration correction predicate safe in a follow-up migration", async () => {
		const migration = await readFile(followUpMigrationPath, "utf8");
		const journal = await readFile(journalPath, "utf8");

		expect(migration).toContain('operation."subscription_id" IS NULL');
		expect(migration).toContain(
			"operation.\"state\" IN ('reserved', 'running', 'settling')",
		);
		expect(migration).toContain('operation."reserved_credits" > 0');
		expect(migration).toContain("NOT EXISTS");
		expect(journal).toContain('"tag": "0017_credit_operation_quarantine_fix"');
	});

	it("models nullable origins and terminal reconciliation outcomes", async () => {
		const source = await readFile(servicePath, "utf8");
		expect(source).toContain("subscriptionId: string | null");
		expect(source).toContain('state: "quarantined"');
		expect(source).toContain('accounting: "manual_correction_required"');
		expect(source).toContain("if (existing) return operationResult(existing);");
		expect(source).toContain("export async function quarantineCreditOperation");
		expect(source).toContain('state: "quarantined"');
		expect(source).toContain("class CreditSubscriptionOriginError");
		expect(source).toContain("instanceof CreditSubscriptionOriginError");
	});
});
