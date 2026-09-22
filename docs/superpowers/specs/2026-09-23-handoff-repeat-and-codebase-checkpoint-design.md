# Handoff Repeat & Codebase Checkpoint Design

**Status:** Draft for review
**Scope:** Two independent changes — (1) repeatable AI-agent handoff for greenfield
projects via task-progress reset, (2) codebase as a first-class entity so an
existing-codebase repository is synced once and reused across features.

---

## Problem

### 1. Greenfield handoff cannot be repeated

A greenfield project's task board is generated once. The AI-agent handoff
(`Prompt AI Agent` in `src/components/task/implementation-options.tsx`) only mints
a fresh API key — it does not touch task state. So when a user wants to hand the
same plan to an agent a second time, the board still shows the first run's
progress: tasks sit in `completed`, and the agent has nothing left to do.

There is no way to reset progress without regenerating. The only code path that
resets status is `saveTaskTree` (`src/lib/services/task-service.ts:289-290`),
which **deletes every task row and inserts new ones** — a full AI regeneration
that burns credits, mints new task IDs, and discards the exact task set the user
already approved.

### 2. Existing-codebase sync is welded to a single project

`codebase_sync_sessions`, `codebase_snapshots`, and `codebase_analyses` are all
keyed by `projectId`. A repository is therefore bound to exactly one PrdFy
project, and that project holds exactly one PRD/AC/Task set.

Consequences verified in the repository:

- `projects.step` is monotonic (`advanceStep`, `src/lib/flow-progress.ts:34-39`) —
  once at `task`, it never returns.
- PRD becomes read-only past the PRD stage (`isPrdLocked`, `flow-progress.ts:26`;
  enforced at `src/routes/api/chat.ts:241-249` with `PRD_LOCKED`).
- `prd_versions` is keyed `(project_id, version)` — every feature of a repository
  would land in one document.

So a second feature for the same repository has nowhere to go. Creating a second
PrdFy project forces a **second sync**, and that second sync is currently
**discarded**: `selectActiveSnapshot` (`src/lib/codebase-sync.ts:250-263`)
always returns the earliest `ready` snapshot and `selectedId` is never passed by
any caller.

### 3. Supporting defects found during the audit

These are in scope because the design must not preserve them:

- `SyncAgentModal` (`src/components/codebase/sync-agent-modal.tsx`) is dead code —
  only its own test imports it. The live screen is `screen-connect.tsx`.
- `DELETE /api/codebase/$projectId/session` (`session.ts:281-354`) has no UI
  consumer. `README.md:366-367` documents two buttons ("Mulai sync baru",
  "Cabut sesi lama & buat baru") that do not exist in `src/`.
- `codebase_sync_sessions.attempt` is written but never read.
- `schema.ts:719-722` states greenfield projects never write to
  `codebase_ask_handoffs`, but `src/routes/api/projects/index.ts:111` calls
  `initHandoff()` inside the greenfield branch, and
  `src/routes/api/ask/options.ts:127` documents "Greenfield & existing modes."

---

## Design decisions (confirmed with product owner)

| # | Decision | Value | Status |
|---|---|---|---|
| D1 | What resets in greenfield | **Task status only.** No regeneration of any kind. | Confirmed |
| D2 | Task set | **Unchanged.** Same titles, descriptions, subtasks, `covers`, `surfaces`, `priority`. | Confirmed |
| D3 | PRD / AC after reset | **Unchanged, stay locked.** Not reopened. | Confirmed |
| D4 | Credits | **None consumed.** No AI call. | Confirmed |
| D5 | Reset trigger | Both a dedicated button on the Kanban board **and** a confirmation surfaced when the user copies the AI-agent prompt while completed work exists. | Confirmed |
| D6 | Codebase model | **Option A** — codebase is its own entity; each feature is its own PrdFy project. | Confirmed |
| D7 | History content | **Projects only.** Codebases get their own page. | Confirmed |
| D8 | Re-sync | **Manual button on the codebase page.** A new snapshot is stored; subsequent features use the latest. | Confirmed |
| D9 | Feature creation entry | New codebase page: type a feature prompt → creates a PrdFy project bound to that codebase. | Confirmed |

### D3 rationale — why PRD/AC stay locked

Reopening PRD after a reset was considered and rejected for a concrete reason: the
lock exists to stop PRD drift after AC and tasks are generated from it
(`isPrdLocked`, `flow-progress.ts:26`; `PRD_LOCKED` at `chat.ts:241-249`).
Reopening it re-enables exactly that drift — a revised PRD no longer matches the
AC and tasks derived from it — and the only existing signal is the advisory
`acChanged` banner (`kanban-board.tsx:340`), which fires for AC changes only and
cannot detect PRD changes.

Reopening would also require a supported way to lower `projects.step`, which
`advanceStep` (`flow-progress.ts:34-39`) deliberately cannot do, plus a decision
about whether existing AC and tasks become invalid. None of that is needed for
the stated goal, which is repeating the handoff with the *same* plan.

Reopening PRD/AC after a reset is therefore **out of scope**, recorded in the
Out of scope section. It is a separate change if ever requested.

---

## Part 1 — Greenfield task-progress reset

### Behavior

Reset sets the following on every task of the project:

| Column | Value |
|---|---|
| `tasks.status` | `pending` |
| `tasks.startedAt` | `null` |
| `tasks.completedAt` | `null` |
| `tasks.subtasks[].status` | `pending` (jsonb, per element) |

Every other column is untouched, including `id`. Task identity is preserved, so
Kanban positions, ordering, feature grouping, and `covers`/`surfaces` traceability
all survive.

`projects.step` and `projects.taskStatus` are **not** modified. The project
remains at the task stage, and the existing documents stay exactly as generated.

### Reset is scoped to work that actually exists

A reset request on a project with no tasks, or with every task already `pending`
and every subtask already `pending`, is a no-op. The endpoint reports how many
rows changed so the UI can show an honest result rather than an unconditional
success message.

### Triggers

**Trigger A — Kanban button.** A `Reset Progress` button in the Kanban header
(`src/components/kanban/kanban-board.tsx:316-335`, alongside `Roadmap` and
`Kembali ke Beranda`). Opens a confirmation dialog stating exactly what is reset
and what is kept. Disabled while no completed or in-progress work exists.

**Trigger B — handoff confirmation.** `handlePromptAi`
(`implementation-options.tsx:285-312`) currently mints a key and opens the modal.
When the project has any task not in `pending`, it first shows the same
confirmation. Confirming performs the reset, then continues to the prompt modal.
Declining still opens the prompt modal without resetting — the user may simply
want a fresh key.

Trigger B is a **convenience path**, not a semantic one: it never resets without
an explicit confirmation.

### State matrix

| State | Behavior |
|---|---|
| No tasks | Button disabled; no-op endpoint response |
| All tasks `pending` | Button disabled; no-op endpoint response |
| Any task `in_progress` / `completed` / `failed` | Button enabled; reset allowed |
| Reset in flight | Button disabled, progress shown |
| Reset succeeded | Board refetches, all columns `pending`, confirmation shown with count |
| Reset failed (network/server) | Error surfaced; board unchanged; retry available |
| Unauthenticated | 401, no state change |
| Non-owner / deleted project | 404, no state change |
| Concurrent reset from two tabs | Both succeed idempotently; final state identical |

### API

`POST /api/projects/$id/reset-progress`

- `requireUser`; ownership and `isNull(deletedAt)` enforced **inside** the
  transaction on the locked project row, matching the existing delete handler
  (`src/routes/api/projects/$id.ts:70-79`).
- One transaction: `SELECT ... FOR UPDATE` on the project, then a single
  `UPDATE tasks SET status='pending', started_at=NULL, completed_at=NULL,
  subtasks=<normalized>` over `WHERE project_id = ?`.
- Subtask normalization rebuilds the jsonb array with each element's `status`
  set to `pending`, preserving every other field. Malformed elements are dropped
  using the same structural filter already used by `getTaskTree`
  (`task-service.ts:360-373`) and `getKanbanData`.
- Returns `{ reset: true, tasksReset: number }`.
- Rate limited with the existing `api_call` action.

Pure helpers (subtask normalization, whether a reset is a no-op) live in
`src/lib/services/task-service.ts` beside `getTaskTree` so they are unit-testable
without a database.

---

## Part 2 — Codebase as a first-class entity

### Data model

New table:

```
codebases
  id          text primary key
  user_id     text not null → users.id (cascade)
  name        text not null
  created_at  timestamp default now()
  updated_at  timestamp default now()
  index (user_id)
```

Ownership moves from project to codebase for sync artifacts:

| Table | Change |
|---|---|
| `codebases` | new |
| `projects` | `+ codebase_id` text null → `codebases.id` |
| `codebase_sync_sessions` | `+ codebase_id` not null → `codebases.id` |
| `codebase_snapshots` | `+ codebase_id` not null → `codebases.id` |

`codebase_snapshots.project_id` and `codebase_sync_sessions.project_id` become
**nullable** and stop being the ownership key. They are retained so existing rows
and existing reads keep resolving during migration, then reads migrate to
`codebase_id`.

`codebase_analyses` stays keyed by `project_id` **and** `snapshot_id` — see below.

### Why analysis stays project-scoped

`requestCodebaseAnalysis` (`src/lib/codebase-analysis.server.ts:144-145`) derives
its prompt from the project:

```
featurePrompt = project.description ?? project.name ?? projectId
```

and `buildAnalysisUserPrompt` (`src/lib/codebase-analysis.ts:146-179`) embeds that
prompt to answer *"which areas of this repository does this feature affect?"*.

Analysis is therefore **feature-scoped, not repository-scoped**. One codebase
yields one analysis per feature. That is exactly what Part 2 needs, so the table
shape is already correct — only its snapshot lookup changes from
`snapshot.projectId = projectId` to `snapshot.codebaseId = project.codebaseId`.

**Defect this exposes.** `projects.description` is written only *after* PRD
generation completes (`src/routes/api/chat.ts:823-826`, inside the PRD-save
block), while codebase analysis runs *before* PRD. At analysis time
`project.description` is therefore always `null`, so `featurePrompt` silently
falls back to `project.name` — a title derived by `deriveProjectNameSync`, not
the user's actual feature request.

The generated name is not guaranteed to preserve the request's meaning. A prompt
like *"tambahkan algoritma rekomendasi film berdasarkan rating user"* may be
reduced to a short product title, and that title is what the analysis is asked to
reason about. The analysis is then grounded on a lossy restatement of the feature.

Fix: the feature prompt the user types on the codebase page is persisted at
project creation as the authoritative feature request, and analysis reads that
value instead of `project.name`. The existing `initHandoff` call
(`src/routes/api/projects/index.ts:75-90`) already stores the raw prompt in
`codebase_ask_handoffs.state.prompt`, so the value exists — the analysis lookup
must read it rather than `projects.description`.

### Snapshot selection must be driven by the feature's own analysis

The current resolver inverts the lookup in a way that breaks under this model.
`getProjectGenerationContext` (`codebase-generation-context.ts:451-503`):

1. loads every snapshot for the project with `status = 'ready'`, ordered ascending;
2. runs `selectActiveSnapshot` over them, which returns the **earliest**;
3. then looks for a ready analysis **for that snapshot**;
4. returns null if none exists.

A "pick the newest snapshot instead" change would be wrong. Consider: feature A
analyzes snapshot #1 and generates its PRD; the repository is then re-synced to
snapshot #2; feature B analyzes snapshot #2. Feature A's PRD revision would
resolve to snapshot #2 — a codebase state its PRD was never written against.

The correct resolution order is the reverse — **the feature's own analysis first**:

1. load the project's own `codebase_analyses` rows, newest first;
2. take the newest `ready` row (a project may have failed attempts before a
   successful one, so "newest ready" is required, not "any ready");
3. resolve that analysis's `snapshot_id` to the snapshot it was written against;
4. use that snapshot's manifest and paths as generation context.

Each feature is then permanently bound to the codebase state it was planned
against, and a re-sync cannot retroactively change an existing feature's context.
`selectActiveSnapshot` remains for the codebase page's "which snapshot is newest"
display, where newest-wins is the correct semantic.

This also means the snapshot does **not** need a `ready` status at all, and no
snapshot needs to change state when a feature is analyzed.

### Snapshot status simplification

Today a snapshot reaches `ready` only after analysis
(`src/lib/codebase-analysis.server.ts:245-257` sets snapshot → `ready`). With
analysis per feature, one snapshot is analyzed by **many** features, so its
terminal state cannot depend on any single feature's analysis.

Change: a snapshot's lifecycle ends at `uploaded`. `ready` remains a valid enum
member for historical rows but is no longer produced. The codebase page treats
`uploaded` as "ready for features". `codebase_analyses.status` continues to track
per-feature analysis state independently, and `codebase_sync_sessions` may still
reach `ready` to mark the sync attempt itself as finished.

### Flow

**First time (sync a repository):**

```
/codebases → "Codebase baru"
  → create codebase + first sync session
  → show sync prompt (reuses buildAgentPrompt)
  → CLI syncs → snapshot `uploaded`
  → codebase page shows snapshot ready for features
```

**Adding a feature:**

```
/codebases/$id → type feature prompt → "Buat fitur"
  → creates project (projectMode = existing_codebase, codebaseId = $id)
  → analysis runs for that feature against the codebase's latest snapshot
  → review → Ask → PRD → AC → Task → Kanban
```

**Re-sync (code changed):**

```
/codebases/$id → "Sync ulang"
  → new sync session + token (existing retry semantics)
  → new snapshot `uploaded`
  → features created afterwards use the latest snapshot
```

### Snapshot selection

`selectActiveSnapshot` (`codebase-sync.ts:250-263`) currently sorts ascending and
returns `ready[0]`, and no caller passes `selectedId`. In the new model:

- The function sorts **descending** by `createdAt` and returns the newest
  snapshot with status `uploaded` (or legacy `ready`). It is used for the
  codebase page's "latest snapshot" display only.
- `selectedId`, when supplied, still wins — preserving the existing override
  contract for a future selection UI.
- Generation context does **not** use this function; it resolves through the
  feature's own analysis as described above.

This is the fix for the discarded-snapshot defect: a re-sync is no longer
silently ignored, and it also no longer retroactively rewrites existing features.

### Pages

| Route | Purpose |
|---|---|
| `/codebases` | List of the user's codebases: name, latest snapshot time, commit, feature count |
| `/codebases/$id` | Detail: snapshot metadata, `Sync ulang`, sync prompt, feature prompt, feature list |

`/codebase/$id` (singular, current) is **replaced**. Existing links from History
and the Home composer are redirected to the codebase page for the project's
codebase.

History keeps listing **projects** only (D7). Navbar gains a `Codebase` entry.

### Migration

1. Create `codebases`.
2. For every project with `projectMode = 'existing_codebase'`, create one codebase
   named after the project and set `projects.codebase_id`.
3. Backfill `codebase_id` on that project's sync sessions and snapshots.
4. Make the new columns `NOT NULL` once backfilled; keep the legacy `project_id`
   columns nullable.

The migration is additive and reversible up to step 4. Existing snapshots,
analyses, and generated documents are preserved.

### Deletion semantics

Artifacts split by ownership, which changes `PROJECT_SYNC_CHILD_TABLES`
(`src/routes/api/projects/$id.ts:28-36`):

| Artifact | Owner | Deleted with |
|---|---|---|
| PRD, AC, tasks, conversations, messages, ask handoff | project (the feature) | project |
| `codebase_analyses`, `codebase_generation_contexts` | project (per-feature) | project |
| `codebases` | user | codebase |
| `codebase_sync_sessions`, `codebase_snapshots`, `codebase_snapshot_files`, `codebase_sync_idempotency_keys` | codebase | codebase |

- **Project deletion** removes the feature's own documents, its analyses, its
  generation contexts, and its ask handoff. The codebase, its snapshots, and its
  files survive — deleting one feature must not destroy the repository data every
  other feature depends on.
- **Codebase deletion** is a new path that removes the codebase and cascades
  sessions, snapshots, files, and idempotency keys. It also deletes the codebase's
  features and their artifacts, since a feature without its codebase has no
  generation context. Deletion is refused without explicit confirmation while
  features exist.
- `credit_operations` and `credit_ledger_entries` are untouched by both paths;
  the project tombstone rule (`src/lib/project-deletion.ts`) is unchanged.

### State matrix

| State | Behavior |
|---|---|
| Codebase with no snapshot | Feature creation disabled; sync prompt shown |
| Snapshot `uploading` | Feature creation disabled; progress shown |
| Snapshot `uploaded` | Feature creation enabled |
| Re-sync while a feature analysis is running | Allowed; running analysis keeps its own snapshot |
| Sync session expired | `Sync ulang` mints a new session (existing semantics) |
| Two tabs open the codebase page | Only one usable credential exists at a time (existing advisory-lock semantics); the second tab must use `Sync ulang` |
| Feature creation with no credits | 403 with the existing credit-exhausted payload |
| Codebase deleted | Its features are deleted; History no longer lists them |
| Unauthenticated | 401 |
| Non-owner | 404, no oracle |

---

## Corrections carried into this design

These fix defects found in the audit rather than adding new capability:

1. **Dead code:** remove `src/components/codebase/sync-agent-modal.tsx` and its
   test. `buildAgentPrompt` already lives in `codebase-sync.ts`.
2. **Unreachable endpoint:** `DELETE /api/codebase/$projectId/session` is
   superseded by the codebase-scoped revoke. If no UI consumes it after this
   change, remove it rather than leaving an unauthenticated-by-obscurity surface.
3. **README drift:** `README.md:361-367` must describe the shipped recovery
   actions, or the actions must be built. It currently documents buttons that do
   not exist.
4. **Schema comment:** `schema.ts:719-722` must state that both project modes
   write `codebase_ask_handoffs`, matching `projects/index.ts:111`.
5. **Unused column:** either surface `codebase_sync_sessions.attempt` or drop it.
   Leaving a written-never-read column is misleading.

---

## Testing

**Unit (Vitest):**

- Reset: subtask normalization preserves non-status fields; malformed elements
  dropped; no-op detection; count reporting.
- Snapshot selection: newest-uploaded wins; `selectedId` override still wins;
  legacy `ready` rows still resolve; empty list returns null.
- Generation context resolution: a feature binds to the snapshot its own newest
  `ready` analysis was written against; a later re-sync does not change an
  existing feature's context; a feature whose only analyses failed resolves to
  null rather than falling back to another feature's snapshot.

**API/integration:**

- Reset endpoint: ownership, deleted-project rejection, idempotency, no-op path,
  concurrent double reset.
- Codebase endpoints: ownership, feature creation, snapshot binding, re-sync
  producing a usable newer snapshot.
- Deletion: project deletion leaves codebase intact; codebase deletion cascades.

**Browser (Playwright):**

- Kanban reset button: disabled with no work, confirmation, board returns to
  `pending`, PRD/AC unchanged.
- Prompt-AI-Agent confirmation path: decline does not reset; confirm does.
- Codebase page: list → detail → create feature → analysis → Ask.

**Not tested (per `basic-rules.md`):** generated prose, class names, layout
structure.

---

## Out of scope

- Reopening PRD/AC after a greenfield reset (D3).
- Per-task selective reset.
- Archiving or versioning reset task progress.
- Automatic re-sync on a schedule.
- Multiple repositories per codebase.
- Snapshot selection UI beyond the `selectedId` contract already present.
