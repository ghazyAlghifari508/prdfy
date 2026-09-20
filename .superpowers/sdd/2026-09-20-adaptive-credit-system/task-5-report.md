# Task 5 Implementation Report

## Status

Implemented and verified for Task 5. Integrated PRD generation (`src/routes/api/chat.ts`), AC generation (`src/routes/api/ac/generate.ts`), and Task generation (`src/routes/api/task/generate.ts`) with the full adaptive credit lifecycle (`reserveCreditOperation` -> `markCreditOperationRunning` -> `settleCreditOperation` / `releaseCreditOperation`).

## Changed Files

- `src/lib/adaptive-credit.ts`
- `src/lib/services/credit-service.ts`
- `src/lib/services/prd-service.ts`
- `src/lib/services/task-service.ts`
- `src/routes/api/ac/generate.ts`
- `src/routes/api/chat.ts`
- `src/routes/api/task/generate.ts`
- `src/lib/services/generation-credit.test.ts`

No FAQ, rule, main worktree, or `src/routeTree.gen.ts` files were committed.

## Implementation

1. **Stage Complexity Metrics Builders (`src/lib/adaptive-credit.ts` & `src/lib/services/credit-service.ts`)**:
   - `buildPrdMetrics`: Pure, deterministic calculation of PRD metrics (`promptChars`, `hasCodebaseContext`, `codebase` containing `fileCount` and `sourceBytes` from snapshot if present).
   - `buildAcMetrics`: Pure, deterministic calculation of AC metrics (`prdSourceChars`, `hasCodebaseContext`, `codebase`).
   - `buildTaskMetrics`: Pure, deterministic calculation of Task metrics (`prdSourceChars`, `taskCount`, `hasCodebaseContext`, `codebase`).
   - Standardized Indonesian error payload formatters: `formatInsufficientCreditsError` and `formatSubscriptionPausedError` containing authoritative quote, required and available credit counts, and billing top-up / renewal instructions.
   - Re-exported all builders and formatters from `src/lib/services/credit-service.ts`.

2. **Credit Service Settlement Extension (`src/lib/services/credit-service.ts`)**:
   - Extended `SettleCreditOperationInput` to accept `artifactId` and `actualMetrics`.
   - `resolveSettlementParameters`: If `actualMetrics` is provided, automatically computes measured units from `baseCredits + surcharge(actualMetrics)` and caps final charge within `maximumCredits`, while preserving explicit `finalCharge` and `measuredUnits` support for backwards compatibility.
   - Requires valid `artifactReference` or `artifactId` for settlement.

3. **Artifact Persistence Services (`prd-service.ts` & `task-service.ts`)**:
   - `savePrdVersion`: Updated to return `{ prdVersionId: string; version: number }`.
   - `saveTaskTree`: Updated to return `{ success: true; artifactId: string; taskCount: number } | { success: false; error: string }`.
   - `saveAcVersion` in `ac-service.ts` already returns `{ acVersionId: string; version: number }`.

4. **Route Lifecycle Integrations (`chat.ts`, `ac/generate.ts`, `task/generate.ts`)**:
   - Dynamic imports inside route handlers for server-only modules (`@/db`, `@/db/schema`, `@/lib/services/credit-service`), keeping the client bundle completely clean.
   - Preflight quote calculation & balance check: If available balance is insufficient or subscription is paused, immediately responds with HTTP 403 containing the quote and Indonesian copy without invoking AI providers.
   - Durable idempotency keys: `${projectId}:${stage}:${versionOrAttempt}` preventing double reservation.
   - Stream start: Transitions operation to running state via `markCreditOperationRunning` and emits `quote` and `started` SSE events.
   - Stream failure, truncation (`isTruncatedGeneration`), invalid JSON, or client cancellation: Calls `releaseCreditOperation` with reason and resets project status locks (`acStatus -> "pending"`, `taskStatus -> "pending"`), guaranteeing zero final debit.
   - Generation success: Only after artifact persistence succeeds and `settleCreditOperation` completes does the route emit the terminal `done` event.
   - Mode `revise` remains 100% free and unlimited on every tier with no reservation or charge.
   - Removed all deprecated direct `consumeCredit()` calls.

## Verification

- **TDD RED Phase**: Focused Vitest ran on `generation-credit.test.ts` before implementation, confirming expected failures for missing metric builders and formatters.
- **Focused Vitest (GREEN)**:
  `pnpm exec vitest run src/lib/services/generation-credit.test.ts src/lib/services/credit-service.test.ts src/lib/services/payment-service.test.ts`
  Result: 3 test files passed, 49 tests passed.
- **Full Credit Subsystem Vitest**:
  `pnpm exec vitest run src/lib/services/generation-credit.test.ts src/lib/services/credit-service.test.ts src/lib/services/credit-service.contract.test.ts src/lib/services/payment-service.test.ts src/lib/billing.test.ts src/lib/credit-ledger.test.ts src/lib/adaptive-credit.test.ts`
  Result: 7 test files passed, 105 tests passed.
- **Biome Check**:
  `pnpm exec biome check` passed with 0 errors and 0 warnings across all changed files.
- **Schema Check**:
  `pnpm exec drizzle-kit check` passed with `Everything's fine 🐶🔥`.
- **Production Build**:
  `pnpm build` passed without client/server bundling or type errors.
- **Type Bypass Scan**:
  Grep scan for `as never`, `as any`, `@ts-ignore`, etc., confirmed 0 matches in all changed Task 5 files.
- **Git Diff Hygiene**:
  `git diff --check` passed cleanly.

## Blockers and Concerns

- Full repository typecheck (`pnpm exec tsc --noEmit`) remains blocked by the pre-existing unrelated error in CLI workspace: `packages/cli/src/index.ts(17,25): Cannot find module 'commander' or its corresponding type declarations.`
- Live DB operations in test suites run in-memory / mock environments because `DATABASE_URL` is unset in the local environment; static Drizzle validation and production build verify SQL and bundle boundaries.
