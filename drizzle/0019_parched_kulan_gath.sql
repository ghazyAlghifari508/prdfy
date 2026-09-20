UPDATE "rate_limits" AS target
SET "count" = duplicates.total_count
FROM (
	SELECT MIN("id") AS keeper_id, SUM(COALESCE("count", 0)) AS total_count
	FROM "rate_limits"
	GROUP BY "user_id", "action", "window_start"
	HAVING COUNT(*) > 1
) AS duplicates
WHERE target."id" = duplicates.keeper_id;--> statement-breakpoint
DELETE FROM "rate_limits" AS duplicate
USING (
	SELECT MIN("id") AS keeper_id, "user_id", "action", "window_start"
	FROM "rate_limits"
	GROUP BY "user_id", "action", "window_start"
	HAVING COUNT(*) > 1
) AS keepers
WHERE duplicate."user_id" = keepers."user_id"
	AND duplicate."action" = keepers."action"
	AND duplicate."window_start" = keepers."window_start"
	AND duplicate."id" <> keepers.keeper_id;--> statement-breakpoint
DROP INDEX "rate_limits_user_id_action_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limits_user_id_action_window_start_unique" ON "rate_limits" USING btree ("user_id","action","window_start");
