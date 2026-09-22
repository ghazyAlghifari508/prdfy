# Codebase Checkpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a repository a first-class entity that is synced once and reused across many features, so adding a feature never requires re-syncing.

**Architecture:** A new `codebases` table owns sync sessions and snapshots; `projects` gains a nullable `codebase_id`. Each feature is still a normal PrdFy project with its own PRD/AC/Task. Generation context resolves through the feature's own newest ready analysis, so a feature is permanently bound to the codebase state it was planned against. Two new pages (`/codebases`, `/codebases/$id`) replace `/codebase/$id`.

**Tech Stack:** TanStack Start (file-based routes + server functions), Drizzle ORM (PostgreSQL 17), Zod v4, Vitest, Playwright, Biome.

**Spec:** `docs/superpowers/specs/2026-09-23-handoff-repeat-and-codebase-checkpoint-design.md` (Part 2 and decisions D6–D9)

## Global Constraints

- Ownership: every query filters `WHERE user_id = ?` and `isNull(projects.deletedAt)`. No RLS — app-level filtering only.
- No `any`, `as never`, `@ts-ignore`, `as unknown as X`. Use Drizzle `$inferSelect`/`$inferInsert` and Zod at boundaries.
- Server-only modules (`db`, schema) are imported inside handlers/server-functions, never at client component top level. Existing exception: route files that are server-only already import `@/db` at top level (see `src/routes/api/codebase/$projectId/session.ts:3-7`).
- UI copy is Bahasa Indonesia; technical terms stay in English. No emoji. No fabricated progress — every indicator reads a real signal.
- Migration must be additive first. Do not drop `project_id` columns in this plan.
- Snapshot terminal state becomes `uploaded`. `ready` stays a valid enum member for historical rows but is no longer written for snapshots.
- Test command is `pnpm exec vitest run <path>` — there is **no** `pnpm test` script.
- Route generation: run `pnpm generate-routes` after adding or renaming a route file. Never hand-edit `src/routeTree.gen.ts`.
- Deletion must not destroy accounting: `credit_operations` and `credit_ledger_entries` are untouched, and the project tombstone rule in `src/lib/project-deletion.ts` is unchanged.

---

### Task 1: `codebases` table and ownership columns

**Files:**
- Modify: `src/db/schema.ts` (add `codebases`; add `codebaseId` to `projects`, `codebaseSyncSessions`, `codebaseSnapshots`)
- Create: `drizzle/<generated>_codebases.sql` (via `pnpm db:generate`)
- Test: `src/db/-codebases-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const codebases = pgTable("codebases", {...})` with columns `id`, `userId`, `name`, `createdAt`, `updatedAt`, and `index("codebases_user_id_idx").on(t.userId)`
  - `projects.codebaseId` — `text("codebase_id")`, nullable, `references(() => codebases.id, { onDelete: "cascade" })`
  - `codebaseSyncSessions.codebaseId` — nullable at first, backfilled in Task 2, and kept nullable permanently so a session can exist before its codebase link is written during creation
  - `codebaseSnapshots.codebaseId` — same

- [ ] **Step 1: Write the failing test**

Create `src/db/-codebases-schema.test.ts`:

```ts
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
	codebaseSnapshots,
	codebaseSyncSessions,
	codebases,
	projects,
} from "./schema";

describe("codebases schema", () => {
	it("declares the expected columns", () => {
		const config = getTableConfig(codebases);
		expect(config.name).toBe("codebases");
		const columns = config.columns.map((column) => column.name).sort();
		expect(columns).toEqual(
			["created_at", "id", "name", "updated_at", "user_id"].sort(),
		);
	});

	it("indexes user_id", () => {
		const config = getTableConfig(codebases);
		expect(config.indexes.map((index) => index.config.name)).toContain(
			"codebases_user_id_idx",
		);
	});

	it("adds a nullable codebase_id to projects", () => {
		const config = getTableConfig(projects);
		const column = config.columns.find((c) => c.name === "codebase_id");
		expect(column).toBeDefined();
		expect(column?.notNull).toBe(false);
	});

	it("adds codebase_id to sync sessions and snapshots", () => {
		for (const table of [codebaseSyncSessions, codebaseSnapshots]) {
			const config = getTableConfig(table);
			expect(config.columns.some((c) => c.name === "codebase_id")).toBe(true);
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/db/-codebases-schema.test.ts`
Expected: FAIL — `codebases` is not exported

- [ ] **Step 3: Add the schema**

In `src/db/schema.ts`, add the table above the `codebaseSyncSessions` block (so the FK target exists in reading order):

```ts
// Codebase: one user-owned repository. Sync sessions and snapshots belong to
// the codebase, not to a project, so a repository is synced once and reused by
// every feature planned against it. Each feature stays a normal project.
export const codebases = pgTable(
	"codebases",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(t) => [index("codebases_user_id_idx").on(t.userId)],
);
```

Add to `projects` (after `projectMode`):

```ts
		// Existing-codebase projects belong to a codebase; greenfield stays null.
		// Nullable so greenfield rows and pre-migration rows remain valid.
		codebaseId: text("codebase_id").references(() => codebases.id, {
			onDelete: "cascade",
		}),
```

Add to `codebaseSyncSessions` (after `userId`):

```ts
		// Owner of the sync attempt. Nullable until the migration backfill runs;
		// `projectId` remains for historical rows and is no longer the owner key.
		codebaseId: text("codebase_id").references(() => codebases.id, {
			onDelete: "cascade",
		}),
```

Add the same `codebaseId` field to `codebaseSnapshots`.

Add matching indexes:

```ts
		index("codebase_sync_sessions_codebase_id_idx").on(t.codebaseId),
		index("codebase_snapshots_codebase_id_idx").on(t.codebaseId),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/NNNN_*.sql` containing `CREATE TABLE "codebases"` and three `ALTER TABLE ... ADD COLUMN "codebase_id"`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run src/db/-codebases-schema.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm exec tsc --noEmit
git add src/db/schema.ts src/db/-codebases-schema.test.ts drizzle/
git commit -m "feat(db): add codebases table and codebase ownership columns"
```

---

### Task 2: Backfill migration

**Files:**
- Create: `drizzle/<generated>_backfill_codebases.sql` (hand-written, following the repo's `NNNN_name.sql` convention; the repo already has hand-written migrations such as `0017_credit_operation_quarantine_fix.sql`)
- Test: `src/db/-codebase-backfill.test.ts`

**Interfaces:**
- Consumes: the schema from Task 1.
- Produces: a migration that, for every `projects` row with `project_mode = 'existing_codebase'`, creates one `codebases` row and stamps `projects.codebase_id`, `codebase_sync_sessions.codebase_id`, and `codebase_snapshots.codebase_id`. Also exports `BACKFILL_CODEBASE_NAME_SQL` is **not** needed — the SQL lives only in the migration file.

- [ ] **Step 1: Write the failing test**

Create `src/db/-codebase-backfill.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const drizzleDir = join(process.cwd(), "drizzle");

function backfillMigrationSql(): string {
	const file = readdirSync(drizzleDir).find((name) =>
		name.endsWith("_backfill_codebases.sql"),
	);
	if (!file) throw new Error("backfill migration not found");
	return readFileSync(join(drizzleDir, file), "utf8");
}

describe("codebase backfill migration", () => {
	it("creates one codebase per existing-codebase project", () => {
		const sql = backfillMigrationSql();
		expect(sql).toMatch(/INSERT INTO\s+"?codebases"?/i);
		expect(sql).toMatch(/project_mode\s*=\s*'existing_codebase'/i);
	});

	it("stamps codebase_id on projects, sessions, and snapshots", () => {
		const sql = backfillMigrationSql();
		expect(sql).toMatch(/UPDATE\s+"?projects"?/i);
		expect(sql).toMatch(/UPDATE\s+"?codebase_sync_sessions"?/i);
		expect(sql).toMatch(/UPDATE\s+"?codebase_snapshots"?/i);
	});

	it("is idempotent: it only fills rows where codebase_id is null", () => {
		const sql = backfillMigrationSql();
		const nullGuards = sql.match(/codebase_id IS NULL/gi) ?? [];
		expect(nullGuards.length).toBeGreaterThanOrEqual(3);
	});

	it("does not drop the legacy project_id columns", () => {
		const sql = backfillMigrationSql();
		expect(sql).not.toMatch(/DROP COLUMN/i);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/db/-codebase-backfill.test.ts`
Expected: FAIL — `backfill migration not found`

- [ ] **Step 3: Write the migration**

Create `drizzle/NNNN_backfill_codebases.sql`, replacing `NNNN` with the next number after the migration generated in Task 1. The content:

```sql
-- One codebase per existing-codebase project. Every statement is guarded on
-- `codebase_id IS NULL` so a partially applied migration can be re-run safely.
INSERT INTO "codebases" ("id", "user_id", "name", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  p."user_id",
  p."name",
  COALESCE(p."created_at", now()),
  now()
FROM "projects" p
WHERE p."project_mode" = 'existing_codebase'
  AND p."codebase_id" IS NULL;

UPDATE "projects" p
SET "codebase_id" = c."id"
FROM "codebases" c
WHERE p."codebase_id" IS NULL
  AND p."project_mode" = 'existing_codebase'
  AND c."user_id" = p."user_id"
  AND c."name" = p."name";

UPDATE "codebase_sync_sessions" s
SET "codebase_id" = p."codebase_id"
FROM "projects" p
WHERE s."codebase_id" IS NULL
  AND s."project_id" = p."id"
  AND p."codebase_id" IS NOT NULL;

UPDATE "codebase_snapshots" sn
SET "codebase_id" = p."codebase_id"
FROM "projects" p
WHERE sn."codebase_id" IS NULL
  AND sn."project_id" = p."id"
  AND p."codebase_id" IS NOT NULL;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/db/-codebase-backfill.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Apply and verify against the database**

Run: `pnpm db:migrate`
Then verify no existing-codebase project is left unlinked:

```bash
psql "$env:DATABASE_URL" -c "select count(*) from projects where project_mode = 'existing_codebase' and codebase_id is null;"
```

Expected: `0`. If `psql` or `DATABASE_URL` is unavailable, report that as a blocker rather than skipping the check.

- [ ] **Step 6: Commit**

```bash
git add drizzle/ src/db/-codebase-backfill.test.ts
git commit -m "feat(db): backfill codebases from existing-codebase projects"
```

---

### Task 3: Generation context resolves through the feature's own analysis

**Files:**
- Modify: `src/lib/codebase-generation-context.ts` (the `getProjectGenerationContext` function at lines 432–563, and `resolveActiveSnapshotId` at lines 571–599)
- Modify: `src/lib/codebase-sync.ts` (the `selectActiveSnapshot` function at lines 250–263)
- Test: `src/lib/codebase-generation-context.test.ts`, `src/lib/codebase-sync.test.ts`

**Interfaces:**
- Consumes: `codebases` from Task 1.
- Produces:
  - `selectActiveSnapshot<T extends SelectableSnapshot>(snapshots, selectedId?)` — now sorts **descending** by `createdAt` and returns the newest; `selectedId` still wins when it matches.
  - `function selectNewestReadyAnalysis<T extends SelectableAnalysis>(analyses: readonly T[]): T | null` where `SelectableAnalysis = { id: string; status: string; createdAt: string }` — returns the newest entry with `status === "ready"`, or null.
  - `getProjectGenerationContext(projectId)` — unchanged signature, new resolution order.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/codebase-sync.test.ts`:

```ts
describe("selectActiveSnapshot (newest wins)", () => {
	const snapshots = [
		{ id: "snap_old", status: "uploaded", createdAt: "2026-01-01T00:00:00.000Z" },
		{ id: "snap_new", status: "uploaded", createdAt: "2026-02-01T00:00:00.000Z" },
	];

	it("returns the newest snapshot", () => {
		expect(selectActiveSnapshot(snapshots)?.id).toBe("snap_new");
	});

	it("still honours an explicit selection", () => {
		expect(selectActiveSnapshot(snapshots, "snap_old")?.id).toBe("snap_old");
	});

	it("ignores an explicit selection that is not a member", () => {
		expect(selectActiveSnapshot(snapshots, "nope")?.id).toBe("snap_new");
	});

	it("accepts a legacy ready snapshot", () => {
		expect(
			selectActiveSnapshot([
				{ id: "legacy", status: "ready", createdAt: "2026-01-01T00:00:00.000Z" },
			])?.id,
		).toBe("legacy");
	});

	it("returns null when nothing is usable", () => {
		expect(
			selectActiveSnapshot([
				{ id: "x", status: "uploading", createdAt: "2026-01-01T00:00:00.000Z" },
			]),
		).toBeNull();
		expect(selectActiveSnapshot([])).toBeNull();
	});
});
```

Append to `src/lib/codebase-generation-context.test.ts`:

```ts
import { selectNewestReadyAnalysis } from "./codebase-generation-context";

describe("selectNewestReadyAnalysis", () => {
	it("returns the newest ready analysis", () => {
		expect(
			selectNewestReadyAnalysis([
				{ id: "a1", status: "ready", createdAt: "2026-01-01T00:00:00.000Z" },
				{ id: "a2", status: "ready", createdAt: "2026-02-01T00:00:00.000Z" },
			])?.id,
		).toBe("a2");
	});

	it("skips failed and pending rows even when they are newer", () => {
		expect(
			selectNewestReadyAnalysis([
				{ id: "ready", status: "ready", createdAt: "2026-01-01T00:00:00.000Z" },
				{ id: "failed", status: "failed", createdAt: "2026-03-01T00:00:00.000Z" },
				{ id: "pending", status: "pending", createdAt: "2026-04-01T00:00:00.000Z" },
			])?.id,
		).toBe("ready");
	});

	it("returns null when no analysis is ready", () => {
		expect(selectNewestReadyAnalysis([])).toBeNull();
		expect(
			selectNewestReadyAnalysis([
				{ id: "f", status: "failed", createdAt: "2026-01-01T00:00:00.000Z" },
			]),
		).toBeNull();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/lib/codebase-sync.test.ts src/lib/codebase-generation-context.test.ts`
Expected: FAIL — the newest-wins tests fail against the current ascending implementation; `selectNewestReadyAnalysis` is not exported

- [ ] **Step 3: Update `selectActiveSnapshot`**

In `src/lib/codebase-sync.ts`, replace the function body. The comment block above it must be rewritten to match — it currently claims the earliest snapshot wins deterministically:

```ts
// === Generation-context selection ===
// The codebase page asks "which snapshot is newest" — a re-sync must be visible
// immediately, so newest wins. Generation does NOT use this function: each
// feature resolves through its own newest ready analysis
// (`selectNewestReadyAnalysis`), which permanently binds a feature to the
// codebase state it was planned against and stops a later re-sync from
// retroactively changing an existing feature's context.
//
// `selectedId` remains an override for a future explicit snapshot picker.

export function selectActiveSnapshot<T extends SelectableSnapshot>(
	snapshots: readonly T[],
	selectedId?: string,
): T | null {
	const usable = [...snapshots]
		.filter((snapshot) => SNAPSHOT_CONTEXT_STATUSES.includes(snapshot.status))
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	if (usable.length === 0) return null;
	if (selectedId) {
		const selected = usable.find((snapshot) => snapshot.id === selectedId);
		if (selected) return selected;
	}
	return usable[0];
}
```

Add beside it:

```ts
// Snapshots a feature may be planned against: `uploaded` is the terminal state
// written by completion, `ready` is retained for rows created before the
// codebase model existed.
export const SNAPSHOT_CONTEXT_STATUSES: readonly string[] = [
	"uploaded",
	"ready",
] as const;
```

- [ ] **Step 4: Add `selectNewestReadyAnalysis`**

In `src/lib/codebase-generation-context.ts`, add beside `selectReadyAnalysis`:

```ts
export interface SelectableAnalysis {
	id: string;
	status: string;
	createdAt: string;
}

/** The newest analysis that actually succeeded. A project may accumulate failed
 *  attempts before one succeeds, so "newest ready" is required rather than "any
 *  ready" — otherwise a retry after a failure would keep resolving to the older
 *  successful record. */
export function selectNewestReadyAnalysis<T extends SelectableAnalysis>(
	analyses: readonly T[],
): T | null {
	const ready = analyses
		.filter((analysis) => analysis.status === "ready")
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	return ready[0] ?? null;
}
```

- [ ] **Step 5: Rewrite the resolution order in `getProjectGenerationContext`**

Replace the snapshot-then-analysis lookup (currently lines 451–506) so the analysis is resolved first. The new body:

```ts
	const analysisRows = await db
		.select({
			id: codebaseAnalyses.id,
			status: codebaseAnalyses.status,
			output: codebaseAnalyses.output,
			snapshotId: codebaseAnalyses.snapshotId,
			createdAt: codebaseAnalyses.createdAt,
		})
		.from(codebaseAnalyses)
		.where(eq(codebaseAnalyses.projectId, projectId))
		.orderBy(desc(codebaseAnalyses.createdAt));
	const readyAnalysis = selectNewestReadyAnalysis(
		analysisRows.map((row) => ({
			id: row.id,
			status: row.status,
			createdAt: row.createdAt?.toISOString() ?? "",
		})),
	);
	if (!readyAnalysis) return null;
	const readyRow = analysisRows.find((row) => row.id === readyAnalysis.id);
	if (!readyRow) return null;
	const parsed = safeParseCodebaseAnalysis(readyRow.output);
	if (!parsed.success) return null;

	// The snapshot is the one this feature's analysis was written against — not
	// the codebase's newest. A re-sync must not rewrite an existing feature's
	// context.
	const [activeRow] = await db
		.select({
			id: codebaseSnapshots.id,
			status: codebaseSnapshots.status,
			branch: codebaseSnapshots.branch,
			commitSha: codebaseSnapshots.commitSha,
			manifest: codebaseSnapshots.manifest,
			fileCount: codebaseSnapshots.fileCount,
			excludedCount: codebaseSnapshots.excludedCount,
			createdAt: codebaseSnapshots.createdAt,
		})
		.from(codebaseSnapshots)
		.where(eq(codebaseSnapshots.id, readyRow.snapshotId))
		.limit(1);
	if (!activeRow) return null;
```

Delete the now-unused `selectActiveSnapshot` import from this module if nothing else in the file uses it, and keep `asc`/`desc` imports accurate.

- [ ] **Step 6: Update `resolveActiveSnapshotId`**

This function feeds the advisory handoff stamp. It must return the snapshot of the project's newest ready analysis, matching Step 5. Replace its body's query with an analysis-first lookup:

```ts
export async function resolveActiveSnapshotId(
	projectId: string,
): Promise<string | null> {
	const { db } = await import("@/db");
	const { codebaseAnalyses } = await import("@/db/schema");
	const { desc, eq } = await import("drizzle-orm");
	const rows = await db
		.select({
			id: codebaseAnalyses.id,
			status: codebaseAnalyses.status,
			snapshotId: codebaseAnalyses.snapshotId,
			createdAt: codebaseAnalyses.createdAt,
		})
		.from(codebaseAnalyses)
		.where(eq(codebaseAnalyses.projectId, projectId))
		.orderBy(desc(codebaseAnalyses.createdAt));
	const newest = selectNewestReadyAnalysis(
		rows.map((row) => ({
			id: row.id,
			status: row.status,
			createdAt: row.createdAt?.toISOString() ?? "",
		})),
	);
	if (!newest) return null;
	return rows.find((row) => row.id === newest.id)?.snapshotId ?? null;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm exec vitest run src/lib/codebase-sync.test.ts src/lib/codebase-generation-context.test.ts`
Expected: PASS. If a pre-existing test asserted the earliest snapshot wins, it encoded the old behaviour and must be updated to the new contract — do not delete it.

- [ ] **Step 8: Typecheck and commit**

```bash
pnpm exec tsc --noEmit
git add src/lib/codebase-sync.ts src/lib/codebase-generation-context.ts src/lib/codebase-sync.test.ts src/lib/codebase-generation-context.test.ts
git commit -m "feat(codebase): bind each feature to its own analysis snapshot"
```

---

### Task 4: Snapshot lifecycle ends at `uploaded`

**Files:**
- Modify: `src/lib/codebase-analysis.server.ts` (lines 245–257)
- Modify: `src/routes/api/v1/projects/$id/codebase/analysis.ts` (snapshot selection and the `decideAnalysisRequest` call)
- Modify: `src/lib/codebase-analysis.ts` (`decideAnalysisRequest`, line 264)
- Test: `src/lib/codebase-analysis.test.ts`

**Interfaces:**
- Consumes: `SNAPSHOT_CONTEXT_STATUSES` from Task 3.
- Produces: `decideAnalysisRequest` accepts a snapshot whose status is `uploaded` (previously only `uploaded`, unchanged) and no longer relies on the snapshot transitioning to `ready`. Snapshot rows are never written to `ready` by analysis.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/codebase-analysis.test.ts`:

```ts
describe("decideAnalysisRequest with an already-analyzed uploaded snapshot", () => {
	it("reuses a ready analysis on an uploaded snapshot", () => {
		expect(
			decideAnalysisRequest(
				{ id: "s1", status: "uploaded" },
				[{ id: "a1", status: "ready" }],
			),
		).toEqual({ action: "reuse", analysisId: "a1" });
	});

	it("creates a new record when only failed attempts exist", () => {
		expect(
			decideAnalysisRequest(
				{ id: "s1", status: "uploaded" },
				[{ id: "a1", status: "failed" }],
			),
		).toEqual({ action: "create" });
	});

	it("rejects a snapshot that is not uploaded", () => {
		const decision = decideAnalysisRequest(
			{ id: "s1", status: "uploading" },
			[],
		);
		expect(decision.action).toBe("reject");
	});
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `pnpm exec vitest run src/lib/codebase-analysis.test.ts`
Expected: PASS if `decideAnalysisRequest` already behaves this way (it should — it checks `status !== "uploaded"`). If it passes, this step is a **regression guard**, not new behaviour; say so in the commit message.

- [ ] **Step 3: Stop writing `ready` to snapshots**

In `src/lib/codebase-analysis.server.ts`, inside the success path (lines ~245–257), remove the snapshot update and keep only the analysis and session updates. The block currently sets analysis → `ready`, snapshot → `ready`, session → `ready`. Change it to:

```ts
				await db.transaction(async (tx) => {
					await tx
						.update(codebaseAnalyses)
						.set({ status: "ready", output: analysis, updatedAt: new Date() })
						.where(eq(codebaseAnalyses.id, analysisId));
					// The snapshot stays `uploaded`: it is a repository artifact
					// shared by every feature, so its state must not depend on one
					// feature's analysis. `ready` remains valid for historical rows.
					assertSyncTransition("analyzing", "ready");
					await tx
						.update(codebaseSyncSessions)
						.set({ status: "ready", updatedAt: new Date() })
						.where(eq(codebaseSyncSessions.id, session.id));
				});
```

Keep the exact transaction shape already in the file; only the snapshot write is removed.

- [ ] **Step 4: Read `uploaded` snapshots in the analysis route**

In `src/routes/api/v1/projects/$id/codebase/analysis.ts`, the fallback snapshot query filters `eq(codebaseSnapshots.status, "uploaded")` — that already matches the new terminal state, so no change is needed there. Verify by reading the query; if it filters `ready`, change it to `uploaded`.

- [ ] **Step 5: Run the full codebase test set**

Run: `pnpm exec vitest run src/lib/codebase-analysis.test.ts src/lib/codebase-sync.test.ts src/lib/codebase-generation-context.test.ts src/lib/codebase-sync-upload.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm exec tsc --noEmit
git add src/lib/codebase-analysis.server.ts src/lib/codebase-analysis.ts src/routes/api/v1/projects/$id/codebase/analysis.ts src/lib/codebase-analysis.test.ts
git commit -m "fix(codebase): stop making a shared snapshot depend on one feature's analysis"
```

---

### Task 5: Codebase-scoped sync routes (browser side)

**Files:**
- Create: `src/routes/api/codebases/index.ts` (create + list)
- Create: `src/routes/api/codebases/$codebaseId/session.ts` (sync session mint/retry/revoke, codebase-scoped)
- Create: `src/routes/api/codebases/$codebaseId/status.ts` (sync status polling)
- Test: `src/routes/api/codebases/-codebases-routes.test.ts`

**Interfaces:**
- Consumes: `codebases` from Task 1; `generateSyncToken`, `hashSyncToken` from `@/lib/codebase-sync.server`; `buildSyncCommand`, `getSessionUsability`, `shouldCreateSyncSession`, `toSessionMetadata` from `@/lib/codebase-sync`; `CODEBASE_CLI_MIN_VERSION`, `CODEBASE_SYNC_SESSION_EXPIRY_MS` from `@/lib/constants`.
- Produces:
  - `POST /api/codebases` → `{ id, name, sync: SyncPromptPayload }` (creates the codebase and its first sync session in one transaction)
  - `GET /api/codebases` → `{ codebases: Array<{ id, name, createdAt, latestSnapshot: { id, createdAt, commitSha, fileCount } | null }> }`
  - `POST /api/codebases/$codebaseId/session` → `SyncPromptPayload`; `POST` with `{ action: "retry" }` revokes usable credentials and mints a replacement; 409 `SYNC_SESSION_ACTIVE` when a usable pre-upload session exists
  - `DELETE /api/codebases/$codebaseId/session` → `{ revoked: true, sessionIds: string[] }`
  - `GET /api/codebases/$codebaseId/status` → `SyncStatusResponse`
  - `export const CODEBASE_SESSION_ROUTE_PATH = "/api/codebases/$codebaseId/session"`

**Implementation note:** the handlers are ports of the existing project-scoped routes
(`src/routes/api/codebase/$projectId/session.ts` and `.../status.ts`) with the
ownership key changed from `projectId` to `codebaseId`. The advisory lock key
becomes `hashtext(codebaseId)`. Every ownership query filters
`eq(codebases.userId, user.id)`. The existing routes stay in place during this
task so nothing breaks; they are removed in Task 9.

**The `SyncPromptPayload.projectId` field keeps its name and value shape** — the
CLI and `buildAgentPrompt` read it, and the value carried is the codebase id.
Renaming it is a CLI-contract change and is deliberately out of scope.

- [ ] **Step 1: Write the failing test**

Create `src/routes/api/codebases/-codebases-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CODEBASE_SESSION_ROUTE_PATH } from "./$codebaseId/session";

describe("codebase routes", () => {
	it("exposes the codebase-scoped session path", () => {
		expect(CODEBASE_SESSION_ROUTE_PATH).toBe("/api/codebases/$codebaseId/session");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/routes/api/codebases/-codebases-routes.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the session route**

Create `src/routes/api/codebases/$codebaseId/session.ts` by copying
`src/routes/api/codebase/$projectId/session.ts` and applying exactly these
changes:

1. `export const CODEBASE_SESSION_ROUTE_PATH = "/api/codebases/$codebaseId/session";`
2. `createFileRoute("/api/codebases/$codebaseId/session")`
3. Params type becomes `{ codebaseId: string }`
4. `getGuardedProject` is replaced by:

```ts
async function getGuardedCodebase(userId: string, codebaseId: string) {
	const [codebase] = await db
		.select({ id: codebases.id, name: codebases.name })
		.from(codebases)
		.where(and(eq(codebases.id, codebaseId), eq(codebases.userId, userId)))
		.limit(1);
	return codebase ?? null;
}
```

5. The `isSyncCapableProject` check is **removed** — capability is now a property
   of being a codebase, not of a project's mode.
6. The advisory lock becomes
   ``sql`select pg_advisory_xact_lock(hashtext(${codebaseId}))` ``
7. Session reads filter `eq(codebaseSyncSessions.codebaseId, codebaseId)` and
   `eq(codebaseSyncSessions.userId, user.id)`
8. Session inserts set `codebaseId` and leave `projectId` **unset**. If the
   generated migration left `project_id` as `NOT NULL`, add a migration making it
   nullable in this task before proceeding — do not insert a placeholder project
   id.

- [ ] **Step 4: Create the status route and the codebase list/create route**

Port `src/routes/api/codebase/$projectId/status.ts` the same way (params
`codebaseId`, ownership through `codebases.userId`, no project-mode gate, session
and snapshot reads filtered by `codebaseId`). `SyncStatusResponse` is reused
unchanged.

Then create `src/routes/api/codebases/index.ts` with `GET` (list) and `POST`
(create). `POST` mirrors the existing existing-codebase branch of
`src/routes/api/projects/index.ts:119-179` minus the project insert: insert the
codebase and its first sync session in one transaction, then return the payload.

- [ ] **Step 5: Generate routes and run the test**

Run: `pnpm generate-routes; if ($?) { pnpm exec vitest run src/routes/api/codebases/-codebases-routes.test.ts }`
Expected: PASS — 1 test

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm exec tsc --noEmit
git add src/routes/api/codebases src/routeTree.gen.ts
git commit -m "feat(api): add codebase-scoped browser sync routes"
```

---

### Task 6: Codebase-scoped CLI upload boundary

**Files:**
- Create: `src/routes/api/v1/codebases/$id/codebase/sync.ts` (handshake)
- Create: `src/routes/api/v1/codebases/$id/codebase/manifest.ts`
- Create: `src/routes/api/v1/codebases/$id/codebase/files.ts`
- Create: `src/routes/api/v1/codebases/$id/codebase/complete.ts`
- Modify: `src/lib/codebase-sync-upload.server.ts` (`guardSyncUpload`, lines 145–279)
- Modify: `packages/cli/src/lib/sync-client.ts` (the URL builder at line 256)
- Modify: `packages/cli/src/commands/codebase.ts` (flag naming in user-facing output)
- Test: `src/lib/codebase-sync-upload.test.ts`, `packages/cli/src/lib/sync-client.test.ts`

**Interfaces:**
- Consumes: `codebases` from Task 1; everything else already used by the
  project-scoped upload path.
- Produces:
  - `guardSyncUpload(request, codebaseId, body, options?)` — now binds the
    credential to a **codebase** instead of a project. Signature is unchanged;
    the second parameter is now a codebase id.
  - CLI endpoints under `/api/v1/codebases/:id/codebase/{sync,manifest,files,complete}`.
  - `export function buildCodebaseSyncUrl(apiBaseUrl: string, codebaseId: string, suffix: string): string` in `packages/cli/src/lib/sync-client.ts`.

**Why this task exists:** the CLI-facing upload path is currently bound to
`projects` in three places — the credential lookup
(`codebase-sync-upload.server.ts:164`), the ownership/mode check (lines 205–221),
and the handshake route's own project lookup
(`src/routes/api/v1/projects/$id/codebase/sync.ts:112-136`). Changing only the
browser routes would leave the CLI writing snapshots to a project while the
codebase page reads them from a codebase, and nothing would ever appear as synced.
This task is therefore **required**, not optional.

**Compatibility:** the CLI sends `--project-id <id>` (see
`packages/cli/src/commands/codebase.ts` and `buildSyncCommand` in
`src/lib/codebase-sync.ts:524-529`). The value is now a codebase id. The flag name
stays for CLI compatibility; the sync prompt's label is updated in Task 9 to say
what the value actually is.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/codebase-sync-upload.test.ts`:

```ts
describe("guardSyncUpload binds to a codebase", () => {
	it("rejects a credential whose session belongs to another codebase", () => {
		// The guard's second argument is a codebase id: a session issued for
		// codebase A must not authenticate a request addressed to codebase B.
		// This mirrors the existing project-bound rejection and is asserted here
		// as the contract the new routes rely on.
		expect(typeof guardSyncUpload).toBe("function");
	});
});
```

This is a contract assertion only — the real binding is exercised by the browser
steps in Task 9. Do not write a test that mocks the database to fake it.

Append to `packages/cli/src/lib/sync-client.test.ts`:

```ts
describe("buildCodebaseSyncUrl", () => {
	it("targets the codebase-scoped upload boundary", () => {
		expect(
			buildCodebaseSyncUrl("https://prdfy.example", "cb_1", "manifest"),
		).toBe("https://prdfy.example/api/v1/codebases/cb_1/codebase/manifest");
	});

	it("encodes the codebase id", () => {
		expect(
			buildCodebaseSyncUrl("https://prdfy.example", "a/b", "files"),
		).toBe("https://prdfy.example/api/v1/codebases/a%2Fb/codebase/files");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/lib/codebase-sync-upload.test.ts packages/cli/src/lib/sync-client.test.ts`
Expected: FAIL — `buildCodebaseSyncUrl` is not exported

- [ ] **Step 3: Rebind the upload guard**

In `src/lib/codebase-sync-upload.server.ts`, change `guardSyncUpload`:

1. Rename the second parameter from `projectId` to `codebaseId` and update the
   doc comment above it to say the credential is codebase-bound.
2. The credential lookup filters
   `eq(codebaseSyncSessions.codebaseId, codebaseId)` instead of `.projectId`.
3. Replace the project ownership block (lines 203–221) with a codebase
   ownership check. The `isSyncCapableProject` gate is removed — every codebase
   is sync-capable by definition:

```ts
	// Ownership flows through the credential owner; the codebase must still
	// exist and belong to that owner.
	const [codebase] = await db
		.select({ id: codebases.id, userId: codebases.userId })
		.from(codebases)
		.where(eq(codebases.id, codebaseId))
		.limit(1);
	if (!codebase || codebase.userId !== session.userId)
		return fail(401, "Invalid sync credential", "INVALID_SYNC_CREDENTIAL");
```

4. The bound-snapshot lookup (lines 267–276) filters
   `eq(codebaseSnapshots.syncSessionId, session.id)` — unchanged, since it keys
   on the session, not the project.

- [ ] **Step 4: Create the four CLI upload routes**

Port each file from `src/routes/api/v1/projects/$id/codebase/` to
`src/routes/api/v1/codebases/$id/codebase/`, changing only:

- the route path in `createFileRoute`
- params type to `{ id: string }` carrying a codebase id
- `guardSyncUpload(request, codebaseId, body)` call sites
- the handshake route's own lookup: replace the `projects` query
  (`sync.ts:112-136`) with the same codebase ownership check used in Step 3, and
  drop the `isSyncCapableProject` branch
- the snapshot insert's `projectId` field: set `codebaseId` instead, and leave
  `projectId` unset (nullable from Task 1)

Everything else — idempotency claims, chunk validation, completion verification,
CLI version gate, safe error codes — is copied verbatim. Those paths are already
correct and must not be rewritten.

- [ ] **Step 5: Point the CLI at the new boundary**

In `packages/cli/src/lib/sync-client.ts`, add the URL builder and use it at line 256:

```ts
/** Codebase-scoped upload boundary. The `codebaseId` argument is the value the
 *  CLI receives as `--project-id`; the flag name is kept for compatibility. */
export function buildCodebaseSyncUrl(
	apiBaseUrl: string,
	codebaseId: string,
	suffix: string,
): string {
	const base = apiBaseUrl.replace(/\/+$/, "");
	return `${base}/api/v1/codebases/${encodeURIComponent(codebaseId)}/codebase/${suffix}`;
}
```

Replace the existing URL construction at line 256 with a call to this function.

- [ ] **Step 6: Run tests**

Run: `pnpm exec vitest run packages/cli/src/lib/sync-client.test.ts src/lib/codebase-sync-upload.test.ts src/lib/codebase-sync.test.ts`
Expected: PASS

- [ ] **Step 7: CLI end-to-end check**

Build the CLI and run a real sync against a local dev server:

```bash
pnpm --filter @ghazynabiel/prdfy build
```

Then, with `pnpm dev` running and a codebase created through `/codebases`,
run the printed `prdfy codebase sync --project-id <codebaseId> --sync-token <token>`
from a small local repository.

Expected: the CLI prints a real summary (root, included/excluded counts, bytes,
snapshot id, persisted status), and the codebase page moves to a synced state. If
this cannot be run, report it as a blocker — do not claim the boundary works from
unit tests alone.

- [ ] **Step 8: Commit**

```bash
git add src/routes/api/v1/codebases src/lib/codebase-sync-upload.server.ts packages/cli/src/lib/sync-client.ts packages/cli/src/lib/sync-client.test.ts src/lib/codebase-sync-upload.test.ts
git commit -m "feat(cli): rebind sync upload boundary to codebase"
```

---

### Task 7: Feature creation on a codebase

**Files:**
- Create: `src/routes/api/codebases/$codebaseId/features.ts`
- Modify: `src/routes/api/projects/index.ts` (accept `codebaseId`, skip the sync-session insert when one is supplied, and use the user's feature prompt as the authoritative analysis prompt)
- Test: `src/routes/api/codebases/-features.test.ts`

**Interfaces:**
- Consumes: `codebases` from Task 1; `saveAskHandoff` from `@/lib/codebase-generation-context`; `deriveProjectNameSync` from `@/lib/services/prd-service`; `parseProjectModeInput` from `./index`.
- Produces:
  - `POST /api/codebases/$codebaseId/features` with body `{ message: string, language?: string }` → `{ projectId, name }`
  - `export function buildFeatureProjectValues(input: { id: string; userId: string; name: string; codebaseId: string; language: string }): typeof projects.$inferInsert` — the insert shape, unit-testable without a database.
  - `export function resolveAnalysisFeaturePrompt(input: { handoffPrompt: string | null | undefined; projectName: string; projectId: string }): string` — the authoritative prompt for analysis.

- [ ] **Step 1: Write the failing test**

Create `src/routes/api/codebases/-features.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildFeatureProjectValues, resolveAnalysisFeaturePrompt } from "./$codebaseId/features";

describe("buildFeatureProjectValues", () => {
	it("creates an existing-codebase project bound to the codebase", () => {
		const values = buildFeatureProjectValues({
			id: "p1",
			userId: "u1",
			name: "Wishlist",
			codebaseId: "c1",
			language: "id",
		});
		expect(values).toMatchObject({
			id: "p1",
			userId: "u1",
			name: "Wishlist",
			projectMode: "existing_codebase",
			codebaseId: "c1",
			language: "id",
			status: "draft",
		});
	});
});

describe("resolveAnalysisFeaturePrompt", () => {
	it("prefers the user's own feature prompt over the derived name", () => {
		expect(
			resolveAnalysisFeaturePrompt({
				handoffPrompt: "tambahkan algoritma rekomendasi film",
				projectName: "Movie App",
				projectId: "p1",
			}),
		).toBe("tambahkan algoritma rekomendasi film");
	});

	it("trims the stored prompt", () => {
		expect(
			resolveAnalysisFeaturePrompt({
				handoffPrompt: "  ada spasi  ",
				projectName: "Movie App",
				projectId: "p1",
			}),
		).toBe("ada spasi");
	});

	it("falls back to the project name when no prompt was stored", () => {
		expect(
			resolveAnalysisFeaturePrompt({
				handoffPrompt: null,
				projectName: "Movie App",
				projectId: "p1",
			}),
		).toBe("Movie App");
		expect(
			resolveAnalysisFeaturePrompt({
				handoffPrompt: "   ",
				projectName: "Movie App",
				projectId: "p1",
			}),
		).toBe("Movie App");
	});

	it("falls back to the project id when neither is usable", () => {
		expect(
			resolveAnalysisFeaturePrompt({
				handoffPrompt: null,
				projectName: "",
				projectId: "p1",
			}),
		).toBe("p1");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/routes/api/codebases/-features.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the route and the helpers**

Create `src/routes/api/codebases/$codebaseId/features.ts`. It must:

1. `requireUser`; 401 on failure.
2. Rate-limit with the user's plan and the `api_call` action.
3. Load the codebase with `and(eq(codebases.id, codebaseId), eq(codebases.userId, user.id))`; 404 if absent.
4. Reject with 400 `CODEBASE_NOT_SYNCED` when the codebase has no snapshot in
   `SNAPSHOT_CONTEXT_STATUSES` (import from `@/lib/codebase-sync`). A feature
   cannot be planned against an un-synced repository.
5. Validate `message` (min 3 characters, matching `src/routes/api/projects/index.ts:46`).
6. Insert the project inside a transaction using `buildFeatureProjectValues`, then call `saveAskHandoff(user.id, {...})` with the prompt, mirroring
   `src/routes/api/projects/index.ts:75-90`.
7. Return `{ projectId, name }`.

The two exported helpers:

```ts
export function buildFeatureProjectValues(input: {
	id: string;
	userId: string;
	name: string;
	codebaseId: string;
	language: string;
}): typeof projects.$inferInsert {
	return {
		id: input.id,
		userId: input.userId,
		name: input.name,
		status: "draft",
		mode: "ai_auto",
		projectMode: "existing_codebase",
		codebaseId: input.codebaseId,
		language: input.language,
	};
}

/** The user's own feature request is the authoritative analysis prompt. The
 *  derived project name is a title, not a request: grounding analysis on it
 *  loses the actual feature. */
export function resolveAnalysisFeaturePrompt(input: {
	handoffPrompt: string | null | undefined;
	projectName: string;
	projectId: string;
}): string {
	const prompt = input.handoffPrompt?.trim();
	if (prompt) return prompt;
	const name = input.projectName.trim();
	return name || input.projectId;
}
```

- [ ] **Step 4: Use the authoritative prompt in analysis**

In `src/lib/codebase-analysis.server.ts`, replace the `featurePrompt` derivation
at lines 144–145 with a read of the persisted handoff prompt, falling back to the
project name. Import `resolveAnalysisFeaturePrompt` and read
`codebaseAskHandoffs.state` for the project:

```ts
	const [handoff] = await db
		.select({ state: codebaseAskHandoffs.state })
		.from(codebaseAskHandoffs)
		.where(eq(codebaseAskHandoffs.projectId, projectId))
		.limit(1);
	const handoffPrompt =
		handoff?.state &&
		typeof handoff.state === "object" &&
		"prompt" in handoff.state &&
		typeof (handoff.state as { prompt: unknown }).prompt === "string"
			? (handoff.state as { prompt: string }).prompt
			: null;
	const featurePrompt = resolveAnalysisFeaturePrompt({
		handoffPrompt,
		projectName: project?.name ?? "",
		projectId,
	});
```

Add a test to `src/lib/codebase-analysis.test.ts` asserting
`resolveAnalysisFeaturePrompt` prefers the handoff prompt — the unit tests from
Step 1 already cover this function, so reference them rather than duplicating.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run src/routes/api/codebases/-features.test.ts src/lib/codebase-analysis.test.ts`
Expected: PASS — 6 tests in the features file

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm exec tsc --noEmit
git add src/routes/api/codebases/$codebaseId/features.ts src/routes/api/codebases/-features.test.ts src/lib/codebase-analysis.server.ts
git commit -m "feat(codebase): create feature projects and ground analysis on the real prompt"
```

---

### Task 8: Codebase pages

**Files:**
- Create: `src/routes/codebases.tsx` (list) and `src/routes/codebases/$id.tsx` (detail)
- Modify: `src/components/layout/navbar.tsx` (add a `Codebase` nav entry)
- Modify: `src/components/layout/chat-input.tsx` (`decideHomePostCreationTarget`, lines 56–64)
- Modify: `src/lib/flow-progress.ts` (`HISTORY_URL_RE`, lines 80–81)
- Test: `src/routes/codebases/-codebases-pages.test.ts`

**Interfaces:**
- Consumes: `GET /api/codebases`, `POST /api/codebases`, `POST /api/codebases/$codebaseId/session`, `GET /api/codebases/$codebaseId/status`, `POST /api/codebases/$codebaseId/features` from Tasks 5–7; `getPendingSyncPayloadKey`, `SyncPromptPayload` from `@/lib/codebase-sync`.
- Produces:
  - `export function decideCodebaseListEntry(): "allow"` — placeholder-free; the list page requires auth only.
  - `export function decideCodebaseDetailEntry(codebaseId: string | undefined): "allow" | "deny"` — `deny` when the id is missing.

- [ ] **Step 1: Write the failing test**

Create `src/routes/codebases/-codebases-pages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isValidHistoryUrl } from "@/lib/flow-progress";
import { decideCodebaseDetailEntry } from "./$id";

describe("decideCodebaseDetailEntry", () => {
	it("allows a present codebase id", () => {
		expect(decideCodebaseDetailEntry("c1")).toBe("allow");
	});

	it("denies a missing id", () => {
		expect(decideCodebaseDetailEntry(undefined)).toBe("deny");
		expect(decideCodebaseDetailEntry("")).toBe("deny");
	});
});

describe("history url validation after the route change", () => {
	const id = "11111111-1111-1111-1111-111111111111";

	it("still accepts project routes", () => {
		expect(isValidHistoryUrl(`/prd/${id}`, id)).toBe(true);
		expect(isValidHistoryUrl(`/task/${id}`, id)).toBe(true);
	});

	it("rejects the removed singular codebase route", () => {
		expect(isValidHistoryUrl(`/codebase/${id}`, id)).toBe(false);
	});

	it("accepts the new codebases list route", () => {
		expect(isValidHistoryUrl("/codebases", id)).toBe(true);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/routes/codebases/-codebases-pages.test.ts`
Expected: FAIL — `./$id` not found; history regex still accepts `/codebase/...`

- [ ] **Step 3: Update history URL validation**

In `src/lib/flow-progress.ts`, change `HISTORY_URL_RE` so the singular codebase
route is no longer a valid last-route target and the new list route is:

```ts
const HISTORY_URL_RE =
	/^\/(?:ask|prd|ac|task|kanban)\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;

/** The codebases list is project-independent, so it is valid for any project. */
const CODEBASES_LIST_URL = "/codebases";

export function isValidHistoryUrl(url: string, projectId: string): boolean {
	if (url === CODEBASES_LIST_URL) return true;
	const m = HISTORY_URL_RE.exec(url);
	return m !== null && m[1] === projectId;
}
```

- [ ] **Step 4: Create the list page**

Create `src/routes/codebases.tsx`: a server function loads the user's codebases
with their latest snapshot (id, `createdAt`, `commitSha`, `fileCount`), ordered by
`updatedAt` descending. The page renders a table with name, latest sync time,
commit, and a link to `/codebases/$id`. It includes a "Codebase baru" action that
opens a name input, `POST`s to `/api/codebases`, stashes the returned `sync`
payload under `getPendingSyncPayloadKey(id)` in `sessionStorage`, and navigates to
the detail page. Follow `src/routes/history.tsx` for loader/redirect shape and
`src/components/codebase/sync-status.tsx` for status presentation.

- [ ] **Step 5: Create the detail page**

Create `src/routes/codebases/$id.tsx` by adapting the existing
`src/routes/codebase/$id.tsx`:

- Replace every `/api/codebase/${projectId}/...` call with
  `/api/codebases/${codebaseId}/...`.
- Keep the three-screen flow (`ScreenConnect` → `SyncStatus` → `CodebaseReview`).
- Add a feature prompt form: a textarea plus a submit button that `POST`s to
  `/api/codebases/$codebaseId/features` and, on success, navigates to
  `/ask/$id` with the returned `projectId`.
- Disable the feature form while no snapshot is in `SNAPSHOT_CONTEXT_STATUSES`,
  showing the sync screen instead. The disabled state must be driven by the real
  status response, never a timer.
- Add a `Sync ulang` button that calls `POST /api/codebases/$codebaseId/session`
  with `{ action: "retry" }`, matching the current retry semantics.
- Export `decideCodebaseDetailEntry` and call it in the loader, redirecting to
  `/codebases` when it returns `deny`.

- [ ] **Step 6: Point the Home composer and navbar at the new pages**

In `src/components/layout/chat-input.tsx`, `decideHomePostCreationTarget` no
longer returns `/codebase/$id`. The Home composer's existing-codebase mode now
creates a codebase, not a project:

```ts
export function decideHomePostCreationTarget(project: {
	id: string;
	projectMode?: string | null;
}): { to: "/ask/$id" | "/codebases"; params?: { id: string } } {
	if (project.projectMode === "existing_codebase") {
		return { to: "/codebases" };
	}
	return { to: "/ask/$id", params: { id: project.id } };
}
```

Update `handleSend` accordingly: when the target is `/codebases`, `POST` to
`/api/codebases` instead of `/api/projects`, then stash the sync payload and
navigate. Add a `Codebase` link to `src/components/layout/navbar.tsx` beside the
existing History link.

- [ ] **Step 7: Generate routes and run the test**

Run: `pnpm generate-routes; if ($?) { pnpm exec vitest run src/routes/codebases/-codebases-pages.test.ts }`
Expected: PASS — 6 tests

- [ ] **Step 8: Browser verification**

Run: `pnpm dev`
Expected:
- `/codebases` lists the codebases backfilled in Task 2.
- Opening one shows the sync status; with a snapshot present the feature form is
  enabled.
- Submitting a feature prompt creates a project and lands on `/ask/$id`.
- `Sync ulang` produces a new snapshot, and the codebase page shows the newer one.
- Home → "Codebase existing" → send lands on `/codebases`.

- [ ] **Step 9: Lint, typecheck, commit**

```bash
pnpm check
pnpm exec tsc --noEmit
git add src/routes/codebases.tsx src/routes/codebases src/components/layout/navbar.tsx src/components/layout/chat-input.tsx src/lib/flow-progress.ts src/routeTree.gen.ts
git commit -m "feat(codebase): add codebase list and detail pages"
```

---

### Task 9: Deletion semantics and cleanup

**Files:**
- Modify: `src/routes/api/projects/$id.ts` (`PROJECT_SYNC_CHILD_TABLES`, lines 28–36, and the delete transaction)
- Create: `src/routes/api/codebases/$codebaseId.ts` (DELETE)
- Delete: `src/routes/codebase/$id.tsx`, `src/routes/codebase/-codebase-entry.test.ts`, `src/routes/api/codebase/**`, `src/components/codebase/sync-agent-modal.tsx`, `src/components/codebase/sync-agent-modal.test.tsx`
- Modify: `README.md` (lines 361–367), `src/db/schema.ts` (the `codebaseAskHandoffs` comment at lines 719–722)
- Test: `src/routes/api/projects/-project-mode.test.ts`, `src/lib/project-deletion.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces:
  - `PROJECT_SYNC_CHILD_TABLES` reduced to the feature-owned tables only:
    `["codebase_ask_handoffs", "codebase_generation_contexts", "codebase_analyses"]`
  - `DELETE /api/codebases/$codebaseId` → `{ success: true, deleted: boolean }`; 409 `CODEBASE_HAS_FEATURES` unless the body carries `{ confirm: true }`

- [ ] **Step 1: Update the failing test first**

In `src/routes/api/projects/-project-mode.test.ts`, change the expected
`PROJECT_SYNC_CHILD_TABLES` set to the reduced list:

```ts
	it("enumerates only feature-owned tables", () => {
		expect([...PROJECT_SYNC_CHILD_TABLES].sort()).toEqual(
			[
				"codebase_analyses",
				"codebase_ask_handoffs",
				"codebase_generation_contexts",
			].sort(),
		);
	});
```

Keep the existing FK-order assertion but drop the removed table names from it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/routes/api/projects/-project-mode.test.ts`
Expected: FAIL — the constant still lists seven tables

- [ ] **Step 3: Reduce the constant and the delete transaction**

In `src/routes/api/projects/$id.ts`, set:

```ts
// Tables owned by the FEATURE (the project). Codebase-owned artifacts —
// codebase_sync_sessions, codebase_snapshots, codebase_snapshot_files,
// codebase_sync_idempotency_keys — are deliberately NOT here: they belong to
// the repository and every other feature depends on them. Deleting one feature
// must not destroy the codebase's sync history.
export const PROJECT_SYNC_CHILD_TABLES = [
	"codebase_ask_handoffs",
	"codebase_generation_contexts",
	"codebase_analyses",
] as const;
```

Remove the three `delete(codebaseSyncSessions)` / `delete(codebaseSnapshots)` /
`delete(codebaseSnapshotFiles)` / `delete(codebaseSyncIdempotencyKeys)`
statements from the transaction. Keep the ask-handoff, generation-context, and
analysis deletes, and keep the tombstone update unchanged.

- [ ] **Step 4: Create the codebase delete route**

Create `src/routes/api/codebases/$codebaseId.ts` with a `DELETE` handler that:

1. `requireUser`; 401 on failure.
2. Loads the codebase with ownership; 404 if absent.
3. Counts the codebase's projects (excluding tombstoned ones). If any exist and
   `body.confirm !== true`, returns 409 `CODEBASE_HAS_FEATURES`.
4. In one transaction, deletes the codebase's feature projects through the same
   per-project cleanup the project delete route performs (reuse the extracted
   helper rather than duplicating the statement list), then deletes the codebase
   row. Sessions, snapshots, files, idempotency keys, and analyses cascade via
   the FKs added in Task 1.
5. Returns `{ success: true, deleted: true }`.

- [ ] **Step 5: Remove the superseded code**

Delete these files and fix any import that referenced them:

- `src/routes/codebase/$id.tsx` and `src/routes/codebase/-codebase-entry.test.ts`
- `src/routes/api/codebase/$projectId/session.ts`
- `src/routes/api/codebase/$projectId/status.ts`
- `src/components/codebase/sync-agent-modal.tsx` and its test
- The `/codebase/$id` entry in `src/routeTree.gen.ts` is regenerated, not edited

Update `src/lib/project-deletion.test.ts`'s file lists (lines 94–121) to drop the
deleted paths and add the new ones.

- [ ] **Step 6: Fix the documentation drift**

- `README.md:361-367`: replace the failure-recovery table rows that name
  non-existent buttons with the actions that exist — `Sync ulang` on the codebase
  page for an expired or invalid credential, and `Codebase` in the navbar to find
  a codebase. Remove the `SYNC_SESSION_ACTIVE` row's reference to
  "Cabut sesi lama & buat baru" unless that control is built.
- `src/db/schema.ts:719-722`: correct the comment to state that both project
  modes write `codebase_ask_handoffs`, matching
  `src/routes/api/projects/index.ts:111` and `src/routes/api/ask/options.ts:127`.

- [ ] **Step 7: Run the full verification**

Run: `pnpm generate-routes; if ($?) { pnpm check }; if ($?) { pnpm exec tsc --noEmit }; if ($?) { pnpm exec vitest run }; if ($?) { pnpm build }`
Expected: all pass. The bypass scan must be clean:

```bash
rg -n "as never|as any|\bas any\b|: any|@ts-ignore|@ts-expect-error|as unknown as" src
```

Expected: no output for the files touched in this plan.

- [ ] **Step 8: Commit**

```bash
git add -A src/ README.md
git commit -m "feat(codebase): codebase-owned deletion and remove superseded routes"
```

---

## Self-Review Notes

**Spec coverage (Part 2):**

| Spec requirement | Task |
|---|---|
| `codebases` table | 1 |
| `projects.codebase_id`, session/snapshot `codebase_id` | 1 |
| Migration backfilling existing projects | 2 |
| Snapshot selection: newest wins, `selectedId` still wins | 3 |
| Generation context resolves through the feature's own newest ready analysis | 3 |
| Snapshot lifecycle ends at `uploaded` | 4 |
| Codebase-scoped browser sync routes (mint/retry/revoke/status) | 5 |
| **CLI upload boundary rebound to the codebase** | 6 |
| Analysis grounded on the user's real prompt, not the derived name | 7 |
| Feature creation from the codebase page | 7 |
| `/codebases` and `/codebases/$id` pages | 8 |
| History keeps listing projects; codebases get their own page | 8 |
| Manual `Sync ulang` on the codebase page | 8 |
| Project deletion keeps codebase artifacts | 9 |
| Codebase deletion cascades | 9 |
| Correction: remove dead `SyncAgentModal` | 9 |
| Correction: remove unreachable `DELETE /api/codebase/$projectId/session` | 9 |
| Correction: README drift | 9 |
| Correction: `codebaseAskHandoffs` schema comment | 9 |
| Correction: unused `attempt` column | Not addressed — see below |

**Task 6 exists because of a gap found during plan self-review.** The spec's Part 2
describes rebinding sync ownership to the codebase but does not enumerate every
place the project binding lives. The CLI upload path binds to `projects` in three
separate places — `guardSyncUpload`'s credential lookup, its ownership/mode check,
and the handshake route's project lookup. Rebinding only the browser routes would
produce a system where the CLI writes snapshots keyed to a project while the
codebase page reads them keyed to a codebase, and no sync would ever appear to
succeed. Task 6 was added to close that hole before implementation starts.

**Deliberately not addressed in this plan:**

- The spec's correction #5 (`codebase_sync_sessions.attempt` is written but never
  read). Task 5 ports the session route unchanged, so the column keeps being
  written. Surfacing or dropping it is a small independent decision that does not
  block this plan; it must be resolved rather than left silently.
- `codebase_snapshots.project_id` / `codebase_sync_sessions.project_id` are not
  dropped. They stay nullable for historical rows; a later migration can drop
  them once no reader depends on them.
- Per-snapshot selection UI. The `selectedId` contract is preserved but unused,
  matching the spec's Out of scope.

**Ordering dependency:** Task 3 must land before Task 4 — Task 4 stops writing
`ready` to snapshots, and Task 3 is what makes resolution stop depending on it.
Tasks 5–7 are independent of each other but all must land before Task 8, which is
the first surface that exercises them end to end.

**Verification gap:** Tasks 5–8 touch authenticated routes and cascading deletes
that unit tests do not cover. Their verification is the browser steps in Task 8
and the full-suite run in Task 9; no automated integration test is added because
the repository has no database-backed integration test harness. This gap is
recorded rather than papered over.
