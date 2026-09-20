import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getRateLimitWindowStart } from "@/lib/rate-limit";

const migrationPath = new URL(
	"../../drizzle/0019_parched_kulan_gath.sql",
	import.meta.url,
);

describe("rate limit window", () => {
	it("normalizes timestamps into the same fixed window", () => {
		const windowSize = 60_000;
		const first = getRateLimitWindowStart(new Date(120_001), windowSize);
		const second = getRateLimitWindowStart(new Date(179_999), windowSize);

		expect(first).toEqual(new Date(120_000));
		expect(second).toEqual(first);
	});

	it("keeps adjacent windows separate", () => {
		const windowSize = 60_000;

		expect(getRateLimitWindowStart(new Date(119_999), windowSize)).toEqual(
			new Date(60_000),
		);
		expect(getRateLimitWindowStart(new Date(120_000), windowSize)).toEqual(
			new Date(120_000),
		);
	});

	it("migrates existing buckets before enforcing atomic uniqueness", async () => {
		const migration = await readFile(migrationPath, "utf8");

		expect(migration).toContain('SUM(COALESCE("count", 0))');
		expect(migration).toContain('DELETE FROM "rate_limits" AS duplicate');
		expect(migration).toContain(
			'CREATE UNIQUE INDEX "rate_limits_user_id_action_window_start_unique"',
		);
		expect(migration).not.toContain(
			'CREATE UNIQUE INDEX "subscriptions_user_id_id_unique"',
		);
	});
});
