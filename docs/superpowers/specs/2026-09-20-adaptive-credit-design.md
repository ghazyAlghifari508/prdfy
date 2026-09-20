# Adaptive Credit System Design

**Status:** Draft for review
**Scope:** Adaptive credit pricing, credit accounting, codebase analysis billing, and Settings usage tracking

## Goal

Replace the current one-credit-per-generation counter behavior with an auditable adaptive credit system. The system must price work according to the operation's measurable scope and context while keeping the user-facing unit understandable, preventing overdraw, handling retries and failures honestly, and exposing durable usage history in Settings.

This design changes credit accounting for PRD, AC, Task, and new codebase analysis operations. It does not change the existing greenfield or existing-codebase product flow beyond when and how credit is estimated, reserved, settled, and displayed.

## Product Decisions

### Credit unit

Credits remain integer user-facing units. The system rounds an estimated or actual operation cost up to the next integer credit. No fractional balance is exposed or persisted as spend.

This preserves a stable product unit while allowing the cost formula to vary by operation and complexity.

### Billable operations

| Operation | Billing behavior |
|---|---|
| Codebase sync/upload | Free; protected by auth, ownership, size limits, and sync rate limits |
| New codebase analysis | Adaptive credit charge |
| Reuse of an already-ready analysis for the same snapshot/context | Free |
| PRD generation | Adaptive credit charge |
| AC generation | Adaptive credit charge |
| Task generation | Adaptive credit charge |
| Revision | Free; protected by rate and resource limits |
| Ask/options generation | Free unless a later product decision explicitly changes it |

A failed billable operation does not produce a final debit. A reused ready analysis never creates a new billable operation.

### Cost model

Each billable operation uses:

```text
estimated cost = base operation cost + measurable complexity surcharge
actual cost = validated usage cost converted to integer credits
final charge = actual cost, bounded by the approved maximum charge
```

The estimator must use measurable signals available before generation. It must not use arbitrary user text matching, a hardcoded symptom, or an invented progress signal.

Initial estimator inputs:

- operation type;
- project stage;
- compiled prompt/context size where available;
- number of product features, personas, workflows, requirements, or constraints extracted from structured project context;
- PRD source size for AC generation;
- feature/task scope signals for Task generation;
- existing-codebase snapshot file count, source byte size, language count, dependency count, and analysis relationship count where available;
- whether a codebase context is included.

The exact weights and thresholds are configuration/constants owned by the billing domain and identified by a pricing version. They must not be scattered through route handlers.

### Preflight quote and maximum charge

Before calling a billable generation or analysis operation, the server calculates an estimate and maximum charge. The client displays both values before the action is submitted:

```text
Estimasi: X kredit
Maksimum: Y kredit
```

The server remains authoritative. A client-provided estimate or confirmation is never trusted as the amount to debit.

The maximum charge is a configured cap for the operation and pricing version. The operation is rejected before provider invocation when the user's available balance cannot cover the maximum charge. This prevents an operation from starting when it cannot settle within its declared cap.

## Credit Lifecycle

Every billable operation has one durable operation identity and follows this state machine:

```text
quoted
  -> reserved
  -> running
  -> settling
  -> settled

reserved/running/settling -> released
reserved/running/settling -> failed
settled -> refunded (only through an explicit compensating transaction)
```

### Reservation

Reservation atomically verifies the user's ownership, active subscription state, available balance, and operation idempotency key. It makes the maximum charge unavailable to competing operations without permanently consuming it.

The reservation must include the user, project, stage/operation, estimate, maximum, pricing version, and expiration. A stale reservation is recoverable by a server-side reconciliation path and cannot permanently lock a user's balance.

### Running

The operation is marked running only after a successful reservation and before provider/model execution. Internal model fallback, stream reconnect handling, and output validation remain under the same operation identity.

### Settlement

After output validation and successful persistence, the system computes actual cost from recorded, real operation signals. It settles the operation atomically:

- release unused reserved amount;
- commit the final debit up to the maximum charge;
- append a ledger event describing the final charge;
- link the operation to the persisted artifact or analysis;
- mark the operation settled.

If actual cost is below the reservation, the unused amount returns to available balance. If actual cost would exceed the configured maximum, the operation is charged only up to the cap and the recorded result identifies that the cap was applied.

### Failure and release

The reservation is released when provider execution fails, output validation fails, persistence fails, the operation is rejected, or the operation expires before a valid result is committed. A failed operation does not create a final usage debit.

If persistence and settlement cannot complete atomically, the operation enters a recoverable reconciliation state rather than reporting success or silently swallowing the error. The client must not be told that generation completed until the server has a settled operation and a durable artifact.

## Idempotency and Concurrency

The client/request boundary must provide or receive an operation idempotency key. The server scopes it to the authenticated user and intended project/stage. A repeated request with the same key returns the existing operation state/result and does not reserve or debit again.

Concurrent operations for the same project and stage must be rejected or coalesced according to the existing generation claim behavior. Credit reservation and final debit must remain atomic at the database boundary. A read-only `remaining > 0` pre-check is not sufficient for adaptive billing.

Network disconnects do not automatically cancel a server-side operation. The operation state remains queryable and the client can reconcile it after reconnect. A retry after a disconnect reuses the operation key when it is a continuation; a deliberate new generation uses a new key and a new charge.

## Codebase Analysis Policy

Sync and upload remain free. A new analysis that processes a new snapshot or explicitly starts a new analysis attempt is billable using the analysis estimator. A ready analysis for the same snapshot and compatible context is reused without a new charge.

Analysis failure releases its reservation. A retry of a failed analysis gets a new operation identity and a fresh estimate. A successful analysis remains linked to its snapshot and operation so its usage can be audited.

Changing the snapshot invalidates reuse for the changed snapshot; it does not mutate the prior analysis or its ledger history.

## Revision and Free Operations

Revision and Ask/options generation remain free. They are protected by existing authentication/ownership and rate limits plus explicit resource limits for request/context size. Free status does not mean unbounded provider work. The limits must fail closed and report an actionable error without creating a credit ledger debit.

## Data Model

The current `subscriptions.credits` and `subscriptions.creditsUsed` fields remain available as a compatibility aggregate during migration, but they are not sufficient as the audit source of truth.

The design adds two durable concepts:

### Credit operations

One row per billable attempt. It stores:

- operation ID;
- user ID and project ID;
- operation/stage;
- idempotency key with a user-scoped uniqueness constraint;
- state;
- estimated, reserved, maximum, and final integer credit amounts;
- pricing version;
- normalized complexity metrics and real usage metrics as typed JSON data;
- artifact/analysis identity when settled;
- failure/reconciliation information without leaking provider secrets;
- created, updated, reserved, settled, released, and expired timestamps.

### Credit ledger entries

An append-only financial-style record for grants, reservations, releases, debits, refunds, and corrections. Each entry stores:

- entry ID;
- user ID;
- operation ID when applicable;
- source bucket/category when applicable;
- signed integer amount;
- entry type;
- balance-impacting status;
- pricing version when related to usage;
- metadata needed for audit;
- created timestamp.

Ledger entries are never mutated or deleted as part of normal user actions. Corrections are compensating entries. Payment grants and existing top-ups must be linked to ledger grant entries going forward.

The ledger is the audit source of truth. For the generation hot path, the subscription aggregate remains materialized and gains a reserved amount: `available = credits - creditsUsed - creditsReserved`. Reservation, release, and settlement update the aggregate counters atomically under the same ownership and period predicates used by the current credit path. This avoids repeated full-ledger scans while reconciliation can compare aggregates against ledger entries. Existing `creditsUsed` remains compatible as the committed debit total; `creditsReserved` represents temporary holds and is not counted as final usage in Settings totals.

## Existing Credit and Migration Policy

Existing users and existing subscriptions must not lose available credit during rollout. The migration must explicitly reconcile legacy database values with current application plan constants, including the observed historical paid-plan backfill mismatch.

The ledger backfill policy is:

- do not invent per-operation historical usage when no operation identity exists;
- create an opening-balance or legacy-adjustment entry for the verified pre-migration aggregate;
- start detailed per-project/stage usage tracking when the new operation system is deployed;
- label pre-migration balance/history clearly in Settings.

The implementation plan must include a deterministic migration/backfill procedure and tests for legacy paid rows, free rollover rows, paused periods, grandfathered rows, and top-up balances.

## Settings Usage Tracking

Settings Billing gains a credit usage section. The current balance remains visible, but usage details are sourced from the ledger/operation records rather than reconstructing activity from `creditsUsed`.

The page must show:

- available credits;
- reserved credits, if any;
- total credits charged in the selected period;
- operation count by stage;
- usage history with timestamp, operation, project, estimate, final charge, and status;
- a detail view for complexity metrics and pricing version;
- filters for stage, project, status, and date range;
- clear handling for pending, released, failed, settled, refunded, and legacy entries.

Example user-facing rows:

| Waktu | Aktivitas | Project | Estimasi | Terpakai | Status |
|---|---|---|---:|---:|---|
| 20 Sep 2026 | Codebase analysis | Marketplace UMKM | 4 | 4 | Berhasil |
| 20 Sep 2026 | Generate PRD | Marketplace UMKM | 3 | 2 | Berhasil |
| 20 Sep 2026 | Generate Task | Marketplace UMKM | 5 | 0 | Dilepas |

The UI must explain the policy in Indonesian:

> Biaya kredit dihitung berdasarkan jenis operasi dan kompleksitas context yang diproses. Estimasi dan batas maksimum ditampilkan sebelum proses dimulai. Operasi yang gagal tidak dikenakan biaya final.

Settings must not expose secrets, raw provider payloads, or sensitive source-code content from the codebase snapshot.

## API and Service Boundaries

Credit pricing, quote, reservation, settlement, release, refund, and ledger writes belong in a server-only billing/credit service. Generation and analysis routes call typed service boundaries; they must not update subscription counters or construct ledger rows inline.

The service must expose typed results for:

- quote creation;
- reservation;
- operation status/reconciliation;
- settlement;
- release/refund;
- Settings usage queries.

Unknown provider output and webhook-like payloads must be validated at the boundary. No broad type assertions or type bypasses are allowed.

Server-only database/auth/provider modules remain dynamically imported where required by the existing route architecture. All user-owned queries must include the authenticated user boundary.

## Failure and Recovery Matrix

| Condition | Required behavior |
|---|---|
| Estimate within balance | Show quote, reserve maximum, run operation |
| Estimate exceeds balance | Reject before provider invocation; no ledger debit |
| Duplicate idempotency key | Return/reconcile existing operation; no second charge |
| Provider/model failure | Release reservation; mark failed; allow explicit retry with a new attempt |
| Invalid provider output | Release reservation; preserve no invalid artifact; mark failed |
| Client disconnect | Keep server operation state; reconcile on reconnect |
| Persistence failure | Do not report success; release or reconcile reservation |
| Settlement conflict | Keep recoverable state; run reconciliation; never silently report success |
| Actual cost below reservation | Release difference; settle actual integer cost |
| Actual cost above estimate but within cap | Charge final actual cost up to cap; record variance |
| Actual cost above cap | Charge cap only; record cap application and operational metric |
| Ready analysis reused | No new reservation or debit |
| New snapshot analysis | New adaptive operation and ledger lifecycle |
| Revision/Ask rate limit | Reject free operation with actionable error; no credit entry |
| Expired subscription | Fail closed; no reservation or debit |
| Ownership failure | Return authorization error without revealing resource state |

## Verification Requirements

Deterministic tests must cover:

- estimator inputs, rounding, pricing versions, and maximum caps;
- atomic reservation under concurrent requests;
- idempotent duplicate operations;
- settlement and release accounting;
- failed provider/output/persistence paths;
- disconnect reconciliation;
- codebase analysis reuse versus new snapshot billing;
- free revision and Ask limits without credit debit;
- legacy subscription and top-up migration behavior;
- ownership filtering for operations, ledger, and Settings queries;
- Settings aggregation and status filters;
- no double charge when PRD/AC/Task routes retry or reconnect.

Tests must assert deterministic contracts and accounting invariants, not AI prose, generated markdown, class names, or visual styling.

Required verification before implementation completion includes the repository's exact lint, format, typecheck, check, affected tests, build, and relevant browser flow commands from the active package manifest and documentation. The type-bypass scan must be run against application roots.

## Out of Scope

- Dynamic provider pricing fetched from an external billing API.
- Charging raw token cost directly to users without a product-level estimator.
- Fractional user-facing credits.
- Automatic price changes without a versioned pricing rule and visible quote.
- Charging sync/upload solely because bytes were transferred.
- Reconstructing exact historical per-operation usage when the old system did not persist operation identity.
- Unrelated payment-provider hardening or broad billing refactors not required for adaptive credit accounting.

## Acceptance Criteria

1. Every new billable operation has a user-scoped durable operation identity and idempotency key.
2. The server shows an estimate and maximum before billable work starts.
3. The server reserves credit atomically before provider/model execution.
4. A failed or invalid operation produces no final debit.
5. A successful operation settles exactly once and links its charge to the artifact or analysis.
6. Codebase sync remains free; new analysis is adaptive-billed; ready analysis reuse is free.
7. PRD, AC, and Task generation use the same accounting lifecycle with stage-specific pricing inputs.
8. Revision and Ask remain free but enforce resource/rate limits.
9. Settings displays auditable usage by operation, project, stage, amount, estimate, status, and pricing version.
10. Existing balances are preserved through a tested migration/backfill policy.
11. No ownership, authentication, idempotency, transaction, or type-safety boundary is weakened.
12. The system fails closed when it cannot prove authorization, available reservation capacity, valid output, or settled accounting.
