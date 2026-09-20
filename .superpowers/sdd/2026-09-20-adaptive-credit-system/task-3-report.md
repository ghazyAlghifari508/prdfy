# Task 3 Implementation Report

## Status

Implemented and verified for the Task 3 service boundary. Generation route integration and payment grant migration remain intentionally out of scope.

## Changed Files

- `src/lib/services/credit-service.ts`
- `src/lib/services/credit-service.test.ts`

No FAQ, rule, generated route tree, schema, migration, payment, or generation route files were modified.

## Implementation

- Added typed quote, reservation, running, settlement, release, refund, lookup, and expiry reconciliation contracts.
- Added deterministic injected-store lifecycle tests for insufficient balance, ownership, idempotency, settlement accounting, release, refund, expiry, and competing reservations.
- Added server-only database reservation, running, settlement, release, refund, lookup, and reconciliation exports using dynamic `db`/schema imports.
- Reservation uses user/project ownership predicates, subscription period checks, unique user-scoped idempotency, guarded available-balance updates, and an append-only reservation ledger entry.
- Settlement releases unused reservation, commits final debit, appends release/debit ledger entries, and links the artifact before terminal state.
- Release and refund use compensating ledger entries without mutating prior ledger rows.

## Verification

- RED: `pnpm exec vitest run src/lib/services/credit-service.test.ts` failed because `credit-service` did not exist.
- Focused GREEN: `pnpm exec vitest run src/lib/services/credit-service.test.ts src/lib/adaptive-credit.test.ts src/lib/credit-ledger.test.ts` passed: `3 files, 28 tests`.
- Changed-file Biome: `pnpm exec biome check src/lib/services/credit-service.ts src/lib/services/credit-service.test.ts` passed.
- Schema check: `pnpm exec drizzle-kit check` passed with `Everything's fine`.
- Bypass scan over changed service/test files returned no matches.
- Full typecheck: `pnpm exec tsc --noEmit` remains blocked by the known unrelated error `packages/cli/src/index.ts(17,25): Cannot find module 'commander' or its corresponding type declarations.`

## Concerns

- The database lifecycle exports are not wired into generation routes by design; that belongs to Task 5.
- The existing `src/lib/credits.ts` one-credit compatibility path was not changed because Task 3 integration is consumed by later route/payment tasks and the brief forbids expanding scope.
- A live PostgreSQL transaction test was not run because the repository verification environment did not provide a database prerequisite; deterministic lifecycle and SQL-boundary compilation checks were run instead.

## Review Fix Report

### Status

Implemented and verified for the Task 3 review findings. Generation route integration and payment grant migration remain intentionally out of scope.

### Fixes

- Bound every operation to the originating subscription in the schema, persistence helper, in-memory lifecycle, and database mutation predicates.
- Added durable operation usage and cap-applied fields, including measured-unit persistence during settlement.
- Rejected non-finite, fractional, negative, and over-maximum quote values before reservation.
- Rejected settlement and release attempts for quoted or terminal operations, and enforced exact-one row checks for subscription and operation transitions.
- Made expiry reconciliation claim expired active operations before releasing them, preventing duplicate reconciliation work across concurrent callers.
- Added migration backfill and fail-closed validation before making `subscription_id` non-null for existing rows.
- Added regressions for invalid quotes, expiry persistence, actual usage, quoted-state rejection, conservation, and single terminal transition.

### Verification

- Focused Vitest: `pnpm exec vitest run src/lib/services/credit-service.test.ts src/lib/credit-ledger.test.ts src/lib/adaptive-credit.test.ts` passed: `3 files, 31 tests`.
- Changed-file Biome passed for the five changed TypeScript files.
- Schema check: `pnpm exec drizzle-kit check` passed with `Everything's fine`.
- Production build: `pnpm build` passed for client and SSR bundles. Existing large-chunk warnings remain informational.
- Bypass scan over changed Task 3 source/test files returned no matches.
- `git diff --check` passed.
- Full typecheck remains blocked only by the pre-existing unrelated error `packages/cli/src/index.ts(17,25): Cannot find module 'commander' or its corresponding type declarations.`
- A live PostgreSQL transaction test was not run because no database prerequisite was available; deterministic lifecycle tests and Drizzle schema checks do not claim to replace that coverage.

## Follow-up Review Fix Report

### Historical Binding Policy

Migration `0016` does not infer a historical subscription from `user_id`, timestamps, or the newest row. The pre-existing `credit_operations` table has no persisted subscription relationship, so ambiguous rows remain `subscription_id = NULL` and receive `reconciliation.status = 'pending'` with code `historical_subscription_unresolved`. The nullable foreign key preserves the row for explicit future reconciliation; mutation paths fail closed when the operation has no bound subscription. New reservations always persist the selected subscription ID, and the composite user/subscription foreign key prevents cross-user binding.

### Lifecycle Fixes

- Reservation now requires server-owned `operation` and `metrics` inputs and recomputes the quote with `estimateCreditQuote`; caller estimates, maximums, pricing versions, operation kinds, and metrics must exactly match the server result before any reservation.
- Expiry reconciliation processes existing expired `settling` rows and newly claims only expired `reserved`/`running` rows. A failed release leaves `settling` durable and retryable, and only successful `released` transitions are returned.
- In-memory and database mutation paths preserve ownership, valid-period checks, exact subscription binding, state guards, exact-one update assertions, durable usage/cap fields, and append-only ledger behavior.
- Conservation assertions now distinguish the reservation hold (`-maximum`), unused release, final debit, operation linkage, and terminal transition rather than treating temporary holds as final usage.

### Database Contract Coverage

- Added deterministic source/migration contract tests for subscription predicates, settling retry inclusion, quarantine migration policy, and absence of arbitrary historical subscription ordering.
- Repository inspection found no PostgreSQL test harness, DB test script, or configured database test environment. Live PostgreSQL transaction, concurrent locking, and migration execution remain blocked and are not claimed by the in-memory tests or Drizzle static checks.

### Verification

- Focused all-credit Vitest: `4 files, 35 tests` passed.
- Changed-file Biome passed after formatting.
- `pnpm exec drizzle-kit check` passed with `Everything's fine`.
- Production build, full typecheck, bypass scan, and `git diff --check` are run as the final gate; the known unrelated `commander` typecheck blocker remains documented if reproduced.
