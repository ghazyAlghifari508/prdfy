import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const servicePath = new URL("./credit-service.ts", import.meta.url);
const migrationPath = new URL(
	"../../../drizzle/0016_lame_squirrel_girl.sql",
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
			"Keep the durable settling state for a later retry.",
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
	});
});
