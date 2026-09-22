-- Convert payment/subscription timestamps to `timestamptz` so a stored instant
-- no longer depends on the server session timezone.
--
-- Why this migration exists: `timestamp without time zone` was written by two
-- different producers using two different conventions in the SAME column.
--
--   1. SQL `now()` / `DEFAULT now()` stored the SESSION wall clock. The app's
--      database session ran in Asia/Jakarta (UTC+7), so those digits are
--      Jakarta local time.
--   2. Drizzle's JS `Date` parameters stored UTC wall clock, because the
--      driver serializes a Date to its UTC representation.
--
-- Reading such a column back in the host timezone (UTC on Vercel) shifted the
-- `now()`-written values by +7h, which is how a payment taken at 22:05 WIB was
-- displayed as the following day.
--
-- Convention per column, established from the ground-truth epoch embedded in
-- `payments.order_id` (the true creation instant) and cross-checked against
-- Midtrans's own transaction_time/settlement_time:
--
--   * payments.created_at        -> Asia/Jakarta (DEFAULT now() at insert)
--   * payments.updated_at        -> Asia/Jakarta when the row was never
--                                   rewritten (the insert default copied it),
--                                   UTC once a JS Date updated it
--   * subscriptions.created_at   -> Asia/Jakarta (DEFAULT now() at insert)
--   * subscriptions.updated_at   -> UTC (always written from JS)
--   * subscriptions period columns / cancelled_at -> UTC (always written from JS)
--
-- The updated_at ambiguity is resolved by its own value: while a row was never
-- touched, `updated_at` still equals `created_at` byte-for-byte, so it carries
-- the Jakarta digits; the moment any code writes it, the value becomes a UTC
-- wall clock. `AT TIME ZONE` yields the true instant without depending on the
-- migration session's timezone.
--
-- Idempotent by column type: if the column is already timestamptz the block
-- returns early, so re-applying the file cannot shift rows twice.

DO $$
DECLARE
	needs_conversion boolean;
BEGIN
	SELECT data_type = 'timestamp without time zone'
	INTO needs_conversion
	FROM information_schema.columns
	WHERE table_schema = 'public'
		AND table_name = 'payments'
		AND column_name = 'created_at';

	IF NOT COALESCE(needs_conversion, false) THEN
		RETURN;
	END IF;

	ALTER TABLE "payments"
		ALTER COLUMN "created_at" TYPE timestamp with time zone
			USING ("created_at" AT TIME ZONE 'Asia/Jakarta'),
		ALTER COLUMN "updated_at" TYPE timestamp with time zone
			USING (
				CASE
					WHEN "updated_at" = "created_at" THEN
						"updated_at" AT TIME ZONE 'Asia/Jakarta'
					ELSE
						"updated_at" AT TIME ZONE 'UTC'
				END
			);

	ALTER TABLE "subscriptions"
		ALTER COLUMN "created_at" TYPE timestamp with time zone
			USING ("created_at" AT TIME ZONE 'Asia/Jakarta'),
		ALTER COLUMN "updated_at" TYPE timestamp with time zone
			USING ("updated_at" AT TIME ZONE 'UTC'),
		ALTER COLUMN "current_period_start" TYPE timestamp with time zone
			USING ("current_period_start" AT TIME ZONE 'UTC'),
		ALTER COLUMN "current_period_end" TYPE timestamp with time zone
			USING ("current_period_end" AT TIME ZONE 'UTC'),
		ALTER COLUMN "cancelled_at" TYPE timestamp with time zone
			USING ("cancelled_at" AT TIME ZONE 'UTC');
END
$$;
