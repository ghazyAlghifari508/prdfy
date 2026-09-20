-- Historical operations have no persisted subscription relationship. Keep them
-- unbound and make reconciliation explicitly require manual resolution instead
-- of guessing an origin from the user's subscription history.
ALTER TABLE "credit_operations" ADD COLUMN "subscription_id" text;--> statement-breakpoint
INSERT INTO "credit_ledger_entries" ("id", "user_id", "operation_id", "amount", "entry_type", "source_category", "pricing_version", "metadata")
SELECT
  md5(operation."id" || ':historical_active_reservation_quarantined'),
  operation."user_id",
  operation."id",
  operation."reserved_credits",
  'correction',
  'manual_correction',
  operation."pricing_version",
  jsonb_build_object(
    'reason', 'historical active reservation quarantined',
    'reconciliationCode', 'historical_active_reservation_quarantined',
    'accounting', 'manual_correction_required'
  )
FROM "credit_operations" AS operation
WHERE operation."reserved_credits" > 0
  AND operation."state" IN ('reserved', 'running', 'settling');--> statement-breakpoint
UPDATE "credit_operations"
SET
  "state" = CASE
    WHEN "reserved_credits" > 0 AND "state" IN ('reserved', 'running', 'settling') THEN 'quarantined'
    ELSE "state"
  END,
  "reserved_credits" = CASE
    WHEN "reserved_credits" > 0 AND "state" IN ('reserved', 'running', 'settling') THEN 0
    ELSE "reserved_credits"
  END,
  "reconciliation" = CASE
    WHEN "reserved_credits" > 0 AND "state" IN ('reserved', 'running', 'settling') THEN
      COALESCE("reconciliation", '{}'::jsonb) || jsonb_build_object(
        'status', 'resolved',
        'code', 'historical_active_reservation_quarantined',
        'accounting', 'manual_correction_required',
        'resolvedAt', now()::text
      )
    ELSE COALESCE("reconciliation", '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object(
        'status', CASE WHEN "reconciliation" ? 'status' THEN NULL ELSE 'pending' END,
        'code', CASE WHEN "reconciliation" ? 'code' THEN NULL ELSE 'historical_subscription_unresolved' END
      ))
  END
WHERE "subscription_id" IS NULL;--> statement-breakpoint
ALTER TABLE "credit_operations" ADD COLUMN "usage" jsonb;--> statement-breakpoint
ALTER TABLE "credit_operations" ADD COLUMN "cap_applied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_operations" ADD CONSTRAINT "credit_operations_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_operations" ADD CONSTRAINT "credit_operations_user_subscription_fk" FOREIGN KEY ("user_id","subscription_id") REFERENCES "public"."subscriptions"("user_id","id") ON DELETE no action ON UPDATE no action;
