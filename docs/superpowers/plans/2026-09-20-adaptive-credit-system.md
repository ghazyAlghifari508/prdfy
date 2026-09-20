# Adaptive Credit System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace one-credit-per-generation accounting with an integer adaptive credit quote, reservation, settlement, release, and audit ledger for codebase analysis, PRD, AC, and Task operations, with Settings usage tracking.

**Architecture:** Keep `subscriptions` as the materialized hot-path balance and add `creditsReserved`; use append-only credit operations and ledger entries as the audit source of truth. A server-only credit service owns pricing, quotes, idempotency, reservation, settlement, release, refunds, and usage queries; generation routes call that service instead of mutating counters directly. Existing codebase analysis is charged only for new analysis attempts, while reuse of a ready analysis remains free.

**Tech Stack:** TanStack Start, React 19, TanStack Router, Drizzle ORM, PostgreSQL 17, Zod v4, TypeScript strict, Vitest, Playwright, Biome, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-20-adaptive-credit-design.md`

## Global Constraints

- Credits are integer user-facing units; no fractional balance is persisted or shown.
- The server calculates and displays an estimate plus maximum charge before billable work begins.
- Reservations are atomic and occur before provider/model execution.
- Failed or invalid operations produce no final debit.
- Every billable attempt has a user-scoped durable operation identity and idempotency key.
- The ledger is append-only; corrections use compensating entries.
- `subscriptions.credits` and `subscriptions.creditsUsed` remain compatible aggregates; `creditsReserved` is temporary reservation state.
- Available balance is `credits - creditsUsed - creditsReserved` and must be protected by ownership, subscription-period, and concurrency predicates.
- Codebase sync/upload is free; new codebase analysis is adaptive-billed; ready analysis reuse is free.
- Revision and Ask/options remain free but retain authentication, ownership, rate, and resource limits.
- All user-owned queries include the authenticated user boundary; server-only modules stay server-only.
- Unknown provider/model payloads use Zod or targeted type guards; no `as any`, `as never`, `as unknown as X`, or suppression comments.
- UI copy and error messages are Indonesian; technical identifiers remain English.
- Do not test AI prose, generated markdown, class names, Tailwind classes, or visual styling; test deterministic accounting and state invariants.
- Do not weaken existing auth, ownership, idempotency, validation, credit, or test assertions.

---

### Task 1: Define Adaptive Pricing and Accounting Domain Contracts

**Files:**
- Create: `src/lib/adaptive-credit.ts`
- Create: `src/lib/adaptive-credit.test.ts`
- Modify: `src/lib/constants.ts` (add versioned pricing constants only where the existing constants module owns billing rules)
- Modify: `src/types/database.ts` (add exported operation, ledger, and pricing types if this is the repository's shared type boundary)

**Interfaces:**
- Consumes: typed operation inputs from PRD, AC, Task, and codebase analysis contexts.
- Produces: `CreditOperationKind`, `CreditOperationState`, `CreditLedgerEntryType`, `CreditPricingVersion`, `CreditComplexityMetrics`, `CreditQuote`, and pure functions `estimateCreditQuote(input)` and `calculateFinalCreditCost(input)`.

- [ ] **Step 1: Write failing tests for deterministic pricing invariants**
  - Cover each operation kind: `codebase_analysis`, `prd_generation`, `ac_generation`, `task_generation`.
  - Assert base cost is included, metrics increase cost only according to configured thresholds, integer rounding is upward, and maximum charge is never below estimate.
  - Assert missing optional metrics are handled by the documented neutral value rather than a fabricated default operation.
  - Assert a pricing version is present in every quote.

- [ ] **Step 2: Run the focused test file and verify it fails for missing contracts**

  Run: `pnpm exec vitest run src/lib/adaptive-credit.test.ts`

  Expected: FAIL because the pricing contracts and functions do not exist yet.

- [ ] **Step 3: Implement the pure pricing domain**
  - Define operation and lifecycle unions without broad casts.
  - Define explicit metric shapes for project scope, PRD/AC/Task context, and codebase snapshot complexity.
  - Keep weights, thresholds, base costs, and maximum caps in one billing constants section with one pricing version.
  - Make the estimator independent of database and provider imports so it can be tested deterministically.
  - Make actual-cost calculation consume validated real usage metrics only; do not infer cost from user symptom text or invented progress.

- [ ] **Step 4: Run focused tests and typecheck the changed domain**

  Run: `pnpm exec vitest run src/lib/adaptive-credit.test.ts`

  Expected: PASS with all deterministic pricing cases.

  Run: `pnpm exec tsc --noEmit`

  Expected: PASS, or report and fix the actual type mismatch before continuing.

- [ ] **Step 5: Commit the domain contract**

  Run: `git add src/lib/adaptive-credit.ts src/lib/adaptive-credit.test.ts src/lib/constants.ts src/types/database.ts; git commit -m "feat: add adaptive credit pricing contracts"`

---

### Task 2: Add Credit Operation, Reservation, and Ledger Schema

**Files:**
- Modify: `src/db/schema.ts` near `subscriptions`, `projects`, and codebase tables
- Create: the migration file generated by `pnpm db:generate` after schema review; use the actual next journal name emitted by Drizzle rather than assuming a filename
- Create or modify: `src/lib/credit-ledger.ts`
- Create: `src/lib/credit-ledger.test.ts`
- Modify: `drizzle/meta/*` only through the repository's migration generator

**Interfaces:**
- Consumes: `CreditOperationKind`, `CreditOperationState`, and quote types from Task 1.
- Produces: Drizzle tables/inferred types for credit operations and ledger entries, plus typed persistence helpers for operation creation, ledger append, and ownership-scoped reads.

- [ ] **Step 1: Write failing schema/domain tests**
  - Test typed operation states and ledger entry types.
  - Test that operation idempotency is scoped by user and key.
  - Test that an append-only ledger helper creates a new entry and never updates or deletes a prior entry.
  - Test that usage queries require `userId` and return project/stage metadata without source-code contents or provider secrets.

- [ ] **Step 2: Run the focused tests and inspect the failure**

  Run: `pnpm exec vitest run src/lib/credit-ledger.test.ts`

  Expected: FAIL until the schema types and persistence helpers exist.

- [ ] **Step 3: Extend the schema**
  - Add `subscriptions.creditsReserved` with a non-negative default.
  - Add a credit operation table containing user/project ownership, operation kind, stage, idempotency key, state, estimate, reservation, maximum, final charge, pricing version, typed metrics JSON, artifact/analysis reference, failure/reconciliation fields, and lifecycle timestamps.
  - Add a credit ledger table containing user ownership, optional operation reference, signed integer amount, entry type, source category, pricing version, typed metadata JSON, and created timestamp.
  - Add indexes for user/time, user/project/stage, operation state/expiry, and user-scoped idempotency uniqueness.
  - Define JSON column shapes with Drizzle `$type()` rather than insert-time assertions.

- [ ] **Step 4: Generate and inspect the migration**

  Run: `pnpm db:generate`

  Inspect the generated SQL for non-destructive defaults, foreign keys, uniqueness, indexes, and integer constraints. Do not hand-edit generated output unless the repository migration convention requires it.

- [ ] **Step 5: Implement typed ledger persistence helpers**
  - Use `$inferInsert`/`$inferSelect` types.
  - Require authenticated ownership identifiers at every read/write boundary.
  - Append ledger entries with explicit signed amounts and entry types.
  - Prevent normal deletion or mutation of settled ledger entries.

- [ ] **Step 6: Run tests, migration checks, and typecheck**

  Run: `pnpm exec vitest run src/lib/credit-ledger.test.ts`

  Expected: PASS.

  Run: `pnpm exec tsc --noEmit`

  Expected: PASS with schema-generated types aligned.

- [ ] **Step 7: Commit schema and ledger foundation**

  Run: `git add src/db/schema.ts src/lib/credit-ledger.ts src/lib/credit-ledger.test.ts drizzle; git commit -m "feat: add credit operation and ledger schema"`

---

### Task 3: Implement Atomic Quote, Reservation, Settlement, Release, and Reconciliation

**Files:**
- Create: `src/lib/services/credit-service.ts`
- Create: `src/lib/services/credit-service.test.ts`
- Modify: `src/lib/credits.ts` to delegate adaptive balance/reservation behavior without retaining a one-credit-only path for billable operations
- Modify: `src/lib/billing.ts` only where subscription state needs a typed reserved-balance field

**Interfaces:**
- Consumes: pricing functions from Task 1 and tables/helpers from Task 2.
- Produces: server-only functions `createCreditQuote`, `reserveCreditOperation`, `markCreditOperationRunning`, `settleCreditOperation`, `releaseCreditOperation`, `refundCreditOperation`, `getCreditOperation`, and `reconcileExpiredCreditOperations`.

- [ ] **Step 1: Write failing tests for the lifecycle and concurrency contract**
  - Quote rejection when available balance is below maximum charge.
  - Atomic reservation increments `creditsReserved` once and creates exactly one reservation ledger event.
  - Duplicate user/key returns the existing operation without a second reservation.
  - Settlement commits final debit, releases the difference, decrements reservation, and creates debit/release ledger entries exactly once.
  - Provider failure, invalid output, persistence failure, and expiration release reservation without final debit.
  - Expired subscription and ownership mismatch fail closed.
  - Concurrent reservations cannot consume the same available units.

- [ ] **Step 2: Run the focused tests to confirm the lifecycle is absent**

  Run: `pnpm exec vitest run src/lib/services/credit-service.test.ts`

  Expected: FAIL until the service is implemented.

- [ ] **Step 3: Implement atomic reservation**
  - Validate the authenticated user/project ownership before creating the operation.
  - Insert or retrieve the user-scoped idempotency key under a unique constraint.
  - Update the latest eligible subscription only when `credits - creditsUsed - creditsReserved >= maximumCharge` and the subscription period is valid.
  - Increment `creditsReserved` and append the reservation ledger event inside one transaction.
  - Store quote metrics and pricing version exactly as calculated by the server.

- [ ] **Step 4: Implement settlement, release, refund, and expiry reconciliation**
  - Lock or transactionally update the operation so only one terminal transition succeeds.
  - On settlement, move reserved units into committed `creditsUsed`, release unused units, store final charge and actual metrics, link the artifact, and append immutable ledger events.
  - On failure/release, decrement only the reserved amount and append a compensating release event.
  - Make refunds explicit compensating operations; never mutate an old debit entry.
  - Reconcile stale operations safely and fail closed when the operation/artifact relationship cannot be proven.

- [ ] **Step 5: Run focused tests and inspect accounting invariants**

  Run: `pnpm exec vitest run src/lib/services/credit-service.test.ts`

  Expected: PASS with no negative reserved balance, no duplicate terminal settlement, and no overdraw.

- [ ] **Step 6: Run typecheck and the bypass scan**

  Run: `pnpm exec tsc --noEmit`

  Run: `rg -n "as never|as any|\\bas any\\b|: any|@ts-ignore|@ts-expect-error|as unknown as" src`

  Expected: typecheck passes and the new credit code introduces no bypass output.

- [ ] **Step 7: Commit the accounting service**

  Run: `git add src/lib/services/credit-service.ts src/lib/services/credit-service.test.ts src/lib/credits.ts src/lib/billing.ts; git commit -m "feat: add adaptive credit accounting lifecycle"`

---

### Task 4: Migrate Existing Balances and Payment Grants

**Files:**
- Create: the migration file generated by `pnpm db:generate` for the backfill; use the actual next journal name emitted by Drizzle rather than assuming a filename
- Modify: `src/lib/services/payment-service.ts`
- Modify: `src/lib/billing.ts`
- Modify: `src/lib/credits.ts`
- Modify: `src/lib/services/payment-service.test.ts`
- Modify: `src/lib/billing.test.ts`

**Interfaces:**
- Consumes: ledger grant helpers and materialized reserved-balance contract from Tasks 2-3.
- Produces: preserved balances for existing users, opening/legacy adjustment ledger entries, and future plan/top-up grants linked to ledger entries.

- [ ] **Step 1: Write failing migration and grant tests**
  - Existing paid rows with historical `10/35` values preserve verified available balances according to the explicit migration policy.
  - Current plan grants use the active plan constants without silently rewriting unrelated user balances.
  - Free rollover resets `creditsUsed` and `creditsReserved` safely and appends the correct opening/rollover record.
  - Top-up success adds a grant ledger entry exactly once under payment idempotency.
  - Paused, grandfathered, and legacy subscription states remain fail-closed and auditable.

- [ ] **Step 2: Run focused billing/payment tests and confirm missing behavior**

  Run: `pnpm exec vitest run src/lib/billing.test.ts src/lib/services/payment-service.test.ts`

  Expected: existing tests pass or expose the exact expected failures for the new migration contract; do not weaken valid assertions.

- [ ] **Step 3: Implement the migration/backfill**
  - Add the reserved column default.
  - Create one clearly labeled opening/legacy adjustment entry per existing subscription aggregate rather than inventing historical per-operation usage.
  - Make rerunning the backfill idempotent with a deterministic migration marker or unique grant key.
  - Reconcile the known historical plan-value mismatch based on verified database values and the approved migration policy.

- [ ] **Step 4: Link payment plan and top-up grants to the ledger**
  - Reuse the existing payment row lock/idempotency behavior.
  - Add one ledger grant per successful payment settlement.
  - Ensure a duplicate webhook cannot add credits or a grant twice.

- [ ] **Step 5: Run migration-related tests and typecheck**

  Run: `pnpm exec vitest run src/lib/billing.test.ts src/lib/services/payment-service.test.ts`

  Run: `pnpm exec tsc --noEmit`

  Expected: PASS with legacy and new grant invariants covered.

- [ ] **Step 6: Commit migration and grant integration**

  Run: `git add drizzle src/lib/billing.ts src/lib/credits.ts src/lib/services/payment-service.ts src/lib/billing.test.ts src/lib/services/payment-service.test.ts; git commit -m "feat: link credit grants to ledger"`

---

### Task 5: Integrate PRD, AC, and Task Generation With Credit Operations

**Files:**
- Modify: `src/routes/api/chat.ts`
- Modify: `src/routes/api/ac/generate.ts`
- Modify: `src/routes/api/task/generate.ts`
- Modify: `src/lib/services/prd-service.ts`
- Modify: `src/lib/services/ac-service.ts`
- Modify: `src/lib/services/task-service.ts`
- Create or modify: route/service tests at the existing feature boundaries

**Interfaces:**
- Consumes: quote/reservation/settlement/release service from Task 3 and stage-specific metric builders.
- Produces: one credit operation per deliberate generation, correct artifact linkage, honest SSE terminal events, and retry-safe behavior.

- [ ] **Step 1: Write failing integration tests for each generation stage**
  - A generation requests a server-side quote and reserves the maximum before invoking the model.
  - A valid PRD/AC/Task artifact settles exactly once and links to the operation.
  - Invalid output, provider error, persistence error, and client-disconnect reconciliation release the reservation and do not report success.
  - Duplicate operation key does not generate or charge twice.
  - Insufficient balance rejects before provider invocation.
  - `resume` semantics are explicit: a deliberate resumed generation receives a new operation key and charge; reconnect continuation reuses the existing key.
  - AC and Task no longer ignore a failed settlement result.

- [ ] **Step 2: Run the focused route/service tests and capture failures**

  Run: `pnpm exec vitest run src/routes/api src/lib/services --passWithNoTests=false`

  Expected: relevant new tests fail until the route integrations are implemented. Preserve unrelated existing failures as evidence rather than changing them silently.

- [ ] **Step 3: Add stage metric builders and quote calls**
  - Build PRD metrics from verified prompt/project/context data.
  - Build AC metrics from the verified PRD source.
  - Build Task metrics from verified PRD/AC/feature context available before generation.
  - Include codebase context metrics when present without charging a second hidden surcharge outside the quote.
  - Return quote data to the client before starting provider work through typed route responses/events.

- [ ] **Step 4: Wrap generation with one operation lifecycle**
  - Create or reuse the operation key at the request boundary.
  - Reserve before calling `tryStreamWithFallback()` or the stage generator.
  - Keep provider fallback, stream parsing, schema validation, artifact persistence, and settlement under the same operation identity.
  - Settle only after artifact persistence succeeds and emit the terminal success event only after settlement.
  - Release on all known failures and make reconciliation state visible for unknown transaction outcomes.
  - Preserve revision as free and keep its existing patch protocol; do not route revisions through the billable operation path.

- [ ] **Step 5: Run focused integration tests**

  Run: `pnpm exec vitest run src/routes/api src/lib/services --passWithNoTests=false`

  Expected: stage accounting tests pass, including no-double-charge and no-success-before-settlement invariants.

- [ ] **Step 6: Commit generation integration**

  Run: `git add src/routes/api/chat.ts src/routes/api/ac/generate.ts src/routes/api/task/generate.ts src/lib/services/prd-service.ts src/lib/services/ac-service.ts src/lib/services/task-service.ts; git commit -m "feat: apply adaptive credits to generation"`

---

### Task 6: Bill New Codebase Analysis and Preserve Ready-Analysis Reuse

**Files:**
- Modify: `src/routes/api/v1/projects/$id/codebase/analysis.ts`
- Modify: `src/lib/codebase-analysis.server.ts`
- Modify: `src/lib/codebase-generation-context.ts` only for typed analysis/reuse metadata if required by the existing context contract
- Modify: `src/lib/codebase-analysis.test.ts`
- Modify: relevant codebase route tests and `e2e/existing-codebase-sync.spec.ts`

**Interfaces:**
- Consumes: analysis quote/reservation/settlement/release from Task 3 and snapshot complexity metrics.
- Produces: billable new analysis attempts, free ready-analysis reuse, and analysis operation linkage without charging sync/upload.

- [ ] **Step 1: Write failing tests for analysis billing policy**
  - Sync/upload creates no credit operation.
  - A ready compatible analysis for the same snapshot/context returns reuse without reservation or debit.
  - A new analysis attempt reserves before model execution and settles after validated analysis persistence.
  - Failed analysis releases reservation and returns the session to the existing recoverable state.
  - A changed snapshot creates a new operation and does not mutate prior analysis/ledger history.
  - Ownership and rate-limit failures create no credit operation.

- [ ] **Step 2: Run codebase analysis tests and confirm the expected failures**

  Run: `pnpm exec vitest run src/lib/codebase-analysis.test.ts`

  Expected: new billing-policy assertions fail before integration.

- [ ] **Step 3: Add the analysis quote and operation lifecycle**
  - Calculate metrics from the verified snapshot manifest, source bytes, language/dependency counts, and available analysis relationship signals.
  - Check reusable ready analysis before creating a billable operation.
  - Reserve before `generate(messages)` and settle only after Zod validation plus the existing ready-state transaction succeeds.
  - Release on all failure paths and keep safe Indonesian errors.

- [ ] **Step 4: Run unit and existing-codebase browser tests**

  Run: `pnpm exec vitest run src/lib/codebase-analysis.test.ts`

  Run: `pnpm exec playwright test e2e/existing-codebase-sync.spec.ts`

  Expected: analysis billing and existing sync behavior pass without charging upload.

- [ ] **Step 5: Commit codebase analysis billing**

  Run: `git add "src/routes/api/v1/projects/$id/codebase/analysis.ts" src/lib/codebase-analysis.server.ts src/lib/codebase-generation-context.ts src/lib/codebase-analysis.test.ts e2e/existing-codebase-sync.spec.ts; git commit -m "feat: charge new codebase analysis operations"`

---

### Task 7: Add Settings Credit Usage Tracking and Quote UI

**Files:**
- Modify: `src/routes/settings/billing.tsx`
- Modify: `src/components/settings/settings-client.tsx` only if navigation or section composition needs the usage surface
- Create: `src/components/settings/credit-usage.tsx` if the current billing route cannot keep a focused responsibility
- Create or modify: `src/routes/settings/credit-usage.test.tsx` or the existing settings test boundary
- Modify: the existing generation UI consumers identified by searching for the PRD generate action, AC generate action, Task generate action, and codebase analysis trigger; add quote confirmation only in those consumers

**Interfaces:**
- Consumes: typed usage query and quote result from Tasks 2-3, plus operation status states.
- Produces: Indonesian Settings usage history, filters/detail view, available/reserved balance display, and preflight quote/maximum confirmation surfaces for billable actions.

- [ ] **Step 1: Discover and reuse existing Settings and generation UI primitives**
  - Read current settings components and existing dialog/table/filter primitives before creating new UI.
  - Record the chosen existing primitive in the implementation notes; use a custom component only where the usage detail behavior is domain-specific.
  - Preserve existing PRDFY visual tokens, flat borders, accessible focus states, and responsive behavior.

- [ ] **Step 2: Write failing deterministic UI tests**
  - Usage rows render operation, project, estimate, final charge, and status from typed loader data.
  - Filters constrain stage/project/status/date query inputs without exposing source content or provider payloads.
  - Reserved, released, failed, settled, refunded, and legacy states have distinct honest labels.
  - The quote confirmation displays estimate and maximum and disables duplicate submission while pending.
  - Empty, loading, unauthorized, insufficient balance, and server-error states have actionable Indonesian copy.

- [ ] **Step 3: Implement server-owned usage queries and typed loader DTOs**
  - Query by authenticated user and optional validated filters.
  - Return plain serializable DTOs without broad `Record` casts or raw JSON provider fields.
  - Include aggregate totals, reserved amount, stage counts, and paginated/limited history.
  - Fix the existing billing route's loose subscription field access while touching that boundary.

- [ ] **Step 4: Implement the usage and quote surfaces**
  - Show available and reserved credits separately.
  - Show the usage table and detail state with pricing version and normalized metrics.
  - Add quote confirmation before each billable operation using the server quote; never calculate the authoritative charge in the browser.
  - Do not add fake progress or fake dynamic status sequences; use actual operation/SSE state only.
  - Verify 320px mobile through desktop layouts do not horizontally overflow.

- [ ] **Step 5: Run settings tests and browser QA**

  Run: `pnpm exec vitest run src/components/settings src/routes/settings`

  Run: `pnpm exec playwright test --grep "billing|credit|generation"`

  Expected: deterministic accounting display and responsive interaction states pass; inspect browser console for errors.

- [ ] **Step 6: Commit Settings and quote UI**

  Run: `git add src/routes/settings/billing.tsx src/components/settings src/routes/settings; git commit -m "feat: add adaptive credit usage tracking"`

---

### Task 8: Reconcile, Verify, and Audit the Full Adaptive Credit Flow

**Files:**
- Modify: affected tests discovered by prior tasks
- Create: `src/lib/services/credit-reconciliation.test.ts` if reconciliation needs an isolated test boundary
- Modify: `docs/superpowers/specs/2026-09-20-adaptive-credit-design.md` only if verified implementation decisions require a spec correction before completion

**Interfaces:**
- Consumes: all adaptive credit services, generation routes, analysis flow, migration, and Settings usage DTOs.
- Produces: verified full-flow evidence and an explicit list of any blocked checks; no silent scope reduction.

- [ ] **Step 1: Run the complete deterministic test suite**

  Run the exact test script available in the repository after confirming the current package manifest. The current manifest has no `test` script, so use the repository's Vitest invocation and document the exact command/output rather than inventing `pnpm test`.

- [ ] **Step 2: Run formatting, lint, check, and type verification**

  Run: `pnpm format`

  Run: `pnpm lint`

  Run: `pnpm check`

  Run: `pnpm exec tsc --noEmit`

  Run: `rg -n "as never|as any|\\bas any\\b|: any|@ts-ignore|@ts-expect-error|as unknown as" src`

  Expected: commands pass and no new bypass output appears in application roots. If `pnpm format` modifies files, inspect the diff and commit only intended formatting.

- [ ] **Step 3: Run database migration verification**

  Run: `pnpm db:generate` and inspect generated migration status.

  Run the repository's configured migration command against the approved local database environment only after confirming environment prerequisites. Verify legacy balances, opening entries, reserved balance defaults, and idempotent rerun behavior.

- [ ] **Step 4: Run browser flows**
  - Existing-codebase sync/upload remains free.
  - New analysis shows quote, reserves, settles on success, and releases on failure.
  - PRD, AC, and Task show quote/maximum, reject insufficient balance, and do not double-charge on reconnect.
  - Settings displays operation history and reserved/settled/released states.
  - Verify 320px, mobile, and desktop widths with no horizontal overflow.
  - Inspect browser console and relevant network responses.

- [ ] **Step 5: Perform final rule audit**
  - Confirm ownership predicates, server-only boundaries, append-only ledger behavior, pricing versioning, no hardcoded secrets/URLs/business rules, no fake indicators, no type bypasses, and no weakened tests.
  - Scan changed files and surrounding touched code for TODO/FIXME/placeholders, silent catches, fake data, and incomplete state handling.
  - Compare every spec acceptance criterion to test or runtime evidence.

- [ ] **Step 6: Commit only verified final adjustments**

  Run: `git status --short; git diff --check; git diff --stat; git log --oneline -10`

  Inspect all commits included in the work. Stage only intended files and commit with a descriptive English message. Push only after verification evidence is recorded.

## Execution Notes

- Execute tasks in order because each later task depends on the typed contract and accounting invariants from earlier tasks.
- Do not start route/UI integration before reservation and settlement tests prove no-overdraw and no-double-charge behavior.
- If implementation reveals that codebase analysis metrics cannot be measured reliably before provider execution, stop and revise the estimator contract; do not silently fall back to a fixed or fake value.
- If a required database, browser, provider, or migration check cannot run, report the exact blocker and keep the status Partial or Blocked rather than claiming completion.
