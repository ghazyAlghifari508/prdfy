-- Forward-only idempotent migration for existing users opening balance backfill.
-- Target: latest subscription row per user.
-- Paused state (current_period_end < NOW() AND current_period_end IS NOT NULL): remaining is 0.
-- Active paid, legacy grandfathered (current_period_end IS NULL), and active free:
-- remaining is GREATEST(0, credits - credits_used - credits_reserved).

WITH latest_subscriptions AS (
  SELECT DISTINCT ON ("user_id")
    "id",
    "user_id",
    "plan",
    "status",
    "credits",
    "credits_used",
    "credits_reserved",
    "current_period_start",
    "current_period_end",
    "created_at"
  FROM "subscriptions"
  ORDER BY "user_id", "created_at" DESC
),
eligible_balances AS (
  SELECT
    "id" AS "subscription_id",
    "user_id",
    CASE
      WHEN "current_period_end" IS NOT NULL AND "current_period_end" < NOW() THEN 0
      ELSE GREATEST(0, "credits" - "credits_used" - "credits_reserved")
    END AS "remaining_credits"
  FROM latest_subscriptions
)
INSERT INTO "credit_ledger_entries" (
  "id",
  "user_id",
  "operation_id",
  "amount",
  "entry_type",
  "source_category",
  "pricing_version",
  "metadata"
)
SELECT
  md5('opening_balance:' || eb."subscription_id"),
  eb."user_id",
  NULL,
  eb."remaining_credits",
  'grant',
  'system_grant',
  '2026-09-20',
  '{"reason":"opening_balance"}'::jsonb
FROM eligible_balances eb
WHERE eb."remaining_credits" > 0
  AND NOT EXISTS (
    SELECT 1
    FROM "credit_ledger_entries" cle
    WHERE cle."id" = md5('opening_balance:' || eb."subscription_id")
       OR (cle."user_id" = eb."user_id" AND cle."entry_type" = 'grant')
  );
