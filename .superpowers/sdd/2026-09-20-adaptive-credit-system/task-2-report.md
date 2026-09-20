# Task 2 Report

## Implemented

- Added `subscriptions.credits_reserved` with a non-negative default and database check.
- Added typed `credit_operations` schema with Task 1 operation/state/pricing contracts, quote metrics, lifecycle timestamps, failure/reconciliation fields, references, bounds checks, and required indexes.
- Added append-only `credit_ledger_entries` schema with signed non-zero amounts, typed metadata, ownership, optional operation reference, pricing version, and indexes.
- Added typed persistence helpers for operation creation, user-scoped idempotency lookup, ledger append, and ownership-scoped usage reads.
- Added deterministic tests covering typed operation creation, user-scoped idempotency, append-only helper surface, signed ledger entries, and required ownership on usage reads.

## Migration

- `drizzle/0013_dry_silk_fever.sql`: generated tables, reservation column, foreign keys, unique idempotency index, query indexes, and credit bounds checks.
- `drizzle/0014_wandering_dagger.sql`: generated reservation non-negative check after the schema constraint was added.
- `drizzle/meta/0013_snapshot.json`, `drizzle/meta/0014_snapshot.json`, and `drizzle/meta/_journal.json` were produced by `pnpm db:generate`.

## Verification

- `pnpm exec vitest run src/lib/credit-ledger.test.ts`: PASS, 4 tests.
- `pnpm exec biome check src/db/schema.ts src/lib/credit-ledger.ts src/lib/credit-ledger.test.ts`: PASS.
- `pnpm exec tsc --noEmit`: BLOCKED by pre-existing `packages/cli/src/index.ts(17,25): Cannot find module 'commander' or its corresponding type declarations.` No unrelated dependency changes were made.

## Reviewer Fixes

- Added composite ownership foreign keys for operation/project and ledger/operation associations, plus explicit project-owner predicates in usage reads.
- Added database credit-bound checks for estimate, reservation, and final charge relationships.
- Added project-owned stage and ledger source categories, restricted metadata, and source parsing at the persistence boundary.
- Added a PostgreSQL trigger migration that rejects ledger updates and deletes; ledger inserts remain available for Task 3 settlement flows.
- Added direct deterministic tests for generated ownership predicates, Drizzle foreign-key/check metadata, quote bounds, source parsing, and the append-only database trigger.

## Follow-up Verification

- `pnpm exec vitest run src/lib/credit-ledger.test.ts`: PASS, 9 tests.
- `pnpm exec biome check src/db/schema.ts src/lib/credit-ledger.ts src/lib/credit-ledger.test.ts`: PASS.
- `pnpm exec tsc --noEmit`: BLOCKED only by baseline `packages/cli/src/index.ts(17,25): Cannot find module 'commander' or its corresponding type declarations.`
- Bypass scan over changed TypeScript files: PASS, no forbidden type bypass patterns found.

## Remaining Review Fixes

- Added Zod v4 strict runtime parsing for ledger metadata before persistence. It rejects unknown keys, non-finite or negative `measuredUnits`, oversized reasons, and unsafe provider/source/token/secret content while returning the project-owned `CreditLedgerMetadata` shape.
- The repository has no configured PostgreSQL test harness. Live verification found `DATABASE_URL=UNSET`, `.env=NOT_FOUND`, `.env.local=NOT_FOUND`; `.env.example` is only a template and no test-specific database script/configuration exists. The PostgreSQL integration requirement is therefore explicitly blocked, not represented as satisfied by source/configuration inspections.
- Pure deterministic coverage now exercises metadata rejection and confirms invalid metadata never reaches the append persistence callback. Existing pure coverage remains for ownership predicates, bounds metadata, source categories, and trigger migration presence; these are not substitutes for live database enforcement.

## Final Follow-up Verification

- `pnpm exec vitest run src/lib/credit-ledger.test.ts`: PASS, 12 tests.
- `pnpm exec biome check src/db/schema.ts src/lib/credit-ledger.ts src/lib/credit-ledger.test.ts`: PASS.
- `pnpm exec tsc --noEmit`: BLOCKED by baseline `packages/cli/src/index.ts(17,25): Cannot find module 'commander' or its corresponding type declarations.`
- Bypass scan over changed TypeScript files: PASS, no forbidden type bypass patterns found.
