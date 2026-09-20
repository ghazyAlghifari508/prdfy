# Task 4 Implementation Report

## Status

Implemented and verified for Task 4. Payment grants, free rollover grants, and existing balance migration are linked to the append-only ledger (`credit_ledger_entries`).

## Changed Files

- `drizzle/0018_opening_balance_backfill.sql`
- `drizzle/meta/_journal.json`
- `src/lib/adaptive-credit.ts`
- `src/lib/billing.ts`
- `src/lib/credits.ts`
- `src/lib/services/payment-service.ts`
- `src/lib/billing.test.ts`
- `src/lib/services/payment-service.test.ts`

No FAQ, rule, main worktree, or `src/routeTree.gen.ts` files were modified.

## Implementation

1. **Payment Service Grant Integration (`src/lib/services/payment-service.ts`)**:
   - `applyPaymentSuccess`: Inside row-lock transaction (`FOR UPDATE`), resets `creditsReserved: 0` alongside `creditsUsed: 0` and `credits: grant.credits` for both existing and new subscriptions, and appends a ledger grant entry (`entryType: "grant"`, `sourceCategory: "system_grant"`, `amount: grant.credits`, `pricingVersion: ADAPTIVE_CREDIT_PRICING.version`, `metadata: { reason: "payment_order:<orderId>" }`).
   - `applyTopUpSuccess`: Inside row-lock transaction, increments `credits` by `TOPUP_SKU.credits` without touching reservations or period, and appends a ledger grant entry (`entryType: "grant"`, `sourceCategory: "system_grant"`, `amount: TOPUP_SKU.credits`, `pricingVersion: ADAPTIVE_CREDIT_PRICING.version`, `metadata: { reason: "topup_order:<orderId>" }`).
   - Added in-memory `PaymentServiceStore` and `createPaymentService(store)` providing pure lifecycle testing for plan purchases, top-ups, non-active-paid rejection, and webhook retry idempotency.
   - Preserved server-only DB module dynamic import boundary inside functions.

2. **Free Rollover Integration (`src/lib/credits.ts` & `src/lib/billing.ts`)**:
   - `rollOverFreeIfNeeded`: Resets `creditsReserved = 0` alongside `creditsUsed = 0` and `credits = PLAN_CREDITS.free` on atomic rollover update, and appends a ledger grant entry (`entryType: "grant"`, `sourceCategory: "system_grant"`, `amount: PLAN_CREDITS.free`, `pricingVersion: ADAPTIVE_CREDIT_PRICING.version`, `metadata: { reason: "free_rollover:<isoPeriodStart>" }`) for the winning update.
   - `applyFreeRollover`: Added pure rollover calculation helper and updated `resolveSubscriptionState` to deduct `creditsReserved` from `remaining`.
   - Updated `SubscriptionRowLike` to include optional `creditsReserved` and `userId`.

3. **Database Migration / Backfill (`drizzle/0018_opening_balance_backfill.sql`)**:
   - Forward-only idempotent migration targeting the latest subscription row per user (`DISTINCT ON ("user_id") ... ORDER BY "user_id", "created_at" DESC`).
   - Computes available balance: paused subscriptions (`current_period_end < NOW() AND current_period_end IS NOT NULL`) receive 0 remaining (no opening grant). Active paid, legacy grandfathered (`current_period_end IS NULL`), and active free receive `GREATEST(0, credits - credits_used - credits_reserved)`.
   - Inserts opening grant entry with deterministic `id = md5('opening_balance:' || subscription.id)`, `entry_type = 'grant'`, `source_category = 'system_grant'`, `pricing_version = '2026-09-20'`, and `metadata = '{"reason":"opening_balance"}'::jsonb`.
   - Idempotency guaranteed via deterministic ID and `NOT EXISTS` anti-join guard.
   - Registered migration in `drizzle/meta/_journal.json` with tag `0018_opening_balance_backfill`.

4. **Pricing Version Domain Contract (`src/lib/adaptive-credit.ts`)**:
   - Extended `CreditPricingVersion` union with `"2026-09-20"` to support the opening balance migration contract.

## Verification

- **TDD RED Phase**: Focused Vitest ran on `payment-service.test.ts` and `billing.test.ts` before implementation, confirming expected failures for missing rollover, missing ledger grants, missing in-memory payment service, and ungenerated migration.
- **Focused Vitest (GREEN)**:
  `pnpm exec vitest run src/lib/services/payment-service.test.ts src/lib/billing.test.ts src/lib/services/credit-service.test.ts src/lib/credit-ledger.test.ts src/lib/adaptive-credit.test.ts`
  Result: 5 test files passed, 83 tests passed.
- **Contract Vitest**:
  `pnpm exec vitest run src/lib/services/credit-service.contract.test.ts`
  Result: 1 test file passed, 4 tests passed.
- **Biome Check**:
  `pnpm exec biome check` passed with 0 errors across all changed files.
- **Schema & Migration Check**:
  `pnpm exec drizzle-kit check` passed with `Everything's fine`.
  `pnpm exec drizzle-kit generate` confirmed `No schema changes, nothing to migrate`.
- **Production Build**:
  `pnpm build` passed without client/server bundling errors.
- **Type Bypass Scan**:
  Grep scan for `as never`, `as any`, `@ts-ignore`, etc., returned 0 matches in changed Task 4 files.
- **Git Diff Hygiene**:
  `git diff --check` passed cleanly.

## Blockers and Concerns

- Full typecheck (`pnpm exec tsc --noEmit`) remains blocked by the pre-existing unrelated error: `packages/cli/src/index.ts(17,25): Cannot find module 'commander' or its corresponding type declarations.`
- A live PostgreSQL transaction test was not run because no database prerequisite or credentials were configured in the environment; deterministic lifecycle tests and Drizzle static checks verify the SQL boundaries and behavior.
