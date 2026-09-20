-- Correct the historical compensation boundary without rewriting deployed 0016.
-- Only unresolved active operations may receive this manual correction.
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
WHERE operation."subscription_id" IS NULL
  AND operation."reserved_credits" > 0
  AND operation."state" IN ('reserved', 'running', 'settling')
  AND NOT EXISTS (
    SELECT 1
    FROM "credit_ledger_entries" AS entry
    WHERE entry."operation_id" = operation."id"
      AND entry."entry_type" = 'correction'
      AND entry."metadata" ->> 'reconciliationCode' = 'historical_active_reservation_quarantined'
  );
