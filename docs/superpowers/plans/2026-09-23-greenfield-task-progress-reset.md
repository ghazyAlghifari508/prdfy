# Greenfield Task-Progress Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user reset task progress (status only, no regeneration) so the same plan can be handed to an AI agent more than once.

**Architecture:** A new pure module `src/lib/services/task-reset.ts` holds the subtask normalization and no-op detection. A new route `POST /api/projects/$id/reset-progress` performs one transactional update scoped to the project. Two UI triggers call it: a button in the Kanban header, and a confirmation step inside the existing "Prompt AI Agent" flow.

**Tech Stack:** TanStack Start (file-based server routes), Drizzle ORM (PostgreSQL 17), Zod v4, Vitest, Playwright, Biome.

**Spec:** `docs/superpowers/specs/2026-09-23-handoff-repeat-and-codebase-checkpoint-design.md` (Part 1 and decisions D1–D5)

## Global Constraints

- No regeneration: no AI call, no credit consumption, no `saveTaskTree` call. Reset touches status columns only.
- Task rows are never deleted and never re-inserted. `tasks.id` is preserved.
- Columns reset: `status` → `'pending'`, `started_at` → `null`, `completed_at` → `null`, and each `subtasks[].status` → `'pending'`.
- Columns never touched: `title`, `description`, `priority`, `covers`, `surfaces`, `dependencies`, `position`, `order`, `feature_name`, `created_at`, `updated_at` (except `updated_at` which the update sets to `now()`), and everything in `projects` (`step`, `task_status`).
- PRD and AC stay locked and unchanged (decision D3).
- Valid task statuses are exactly `pending` | `in_progress` | `completed` | `failed` — copy from `src/routes/api/v1/tasks/$id/status.ts:11`.
- Ownership: `WHERE user_id = ?` plus `isNull(projects.deletedAt)`, enforced inside the transaction on the locked project row.
- UI copy is Bahasa Indonesia; technical terms stay in English. No emoji.
- No `any`, `as never`, `@ts-ignore`. Use Drizzle `$inferSelect`/`$inferInsert`.
- Test command is `pnpm exec vitest run <path>` — there is **no** `pnpm test` script in `package.json`.
- Lint/format: `pnpm lint`, `pnpm format`, `pnpm check`.

---

### Task 1: Pure reset helpers

**Files:**
- Create: `src/lib/services/task-reset.ts`
- Test: `src/lib/services/task-reset.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ResetableSubtask = { name: string; status: string; [key: string]: unknown }`
  - `const TASK_STATUS_PENDING = "pending"` (string literal)
  - `function normalizeSubtasksForReset(raw: unknown): ResetableSubtask[]` — returns a new array where every element is an object with a string `name`, every other own field preserved, and `status` set to `"pending"`. Elements that are not objects or lack a string `name` are dropped.
  - `function hasNonPendingSubtask(raw: unknown): boolean` — reads the **raw** subtask value and returns true when any well-formed element has `status !== "pending"`. This must read the input, not normalized output, because normalization always writes `"pending"` and so could never report a change.
  - `function needsProgressReset(tasks: readonly { status: string | null; subtasks: unknown }[]): boolean` — true when any task has `status !== "pending"` or `hasNonPendingSubtask(task.subtasks)` is true.

- [ ] **Step 1: Write the failing test**

Create `src/lib/services/task-reset.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	hasNonPendingSubtask,
	needsProgressReset,
	normalizeSubtasksForReset,
} from "./task-reset";

describe("normalizeSubtasksForReset", () => {
	it("sets every subtask status to pending and keeps other fields", () => {
		const result = normalizeSubtasksForReset([
			{
				name: "Buat tabel",
				description: "Migrasi drizzle",
				details: ["kolom id", "kolom nama"],
				status: "completed",
			},
		]);
		expect(result).toEqual([
			{
				name: "Buat tabel",
				description: "Migrasi drizzle",
				details: ["kolom id", "kolom nama"],
				status: "pending",
			},
		]);
	});

	it("drops entries that are not objects with a string name", () => {
		const result = normalizeSubtasksForReset([
			null,
			"bukan objek",
			42,
			{ status: "completed" },
			{ name: 123, status: "completed" },
			{ name: "Valid", status: "failed" },
		]);
		expect(result).toEqual([{ name: "Valid", status: "pending" }]);
	});

	it("returns an empty array for non-array input", () => {
		expect(normalizeSubtasksForReset(null)).toEqual([]);
		expect(normalizeSubtasksForReset(undefined)).toEqual([]);
		expect(normalizeSubtasksForReset({})).toEqual([]);
		expect(normalizeSubtasksForReset("x")).toEqual([]);
	});

	it("does not mutate the input array", () => {
		const input = [{ name: "A", status: "completed" }];
		normalizeSubtasksForReset(input);
		expect(input[0].status).toBe("completed");
	});
});

describe("hasNonPendingSubtask", () => {
	it("reads the raw value and reports completed subtasks", () => {
		expect(
			hasNonPendingSubtask([{ name: "A", status: "completed" }]),
		).toBe(true);
		expect(hasNonPendingSubtask([{ name: "A", status: "pending" }])).toBe(false);
	});

	it("is false for non-array input", () => {
		expect(hasNonPendingSubtask(null)).toBe(false);
		expect(hasNonPendingSubtask({})).toBe(false);
	});

	it("ignores malformed entries", () => {
		expect(
			hasNonPendingSubtask([null, "x", { status: "completed" }]),
		).toBe(false);
	});

	it("treats a missing status as non-pending", () => {
		expect(hasNonPendingSubtask([{ name: "A" }])).toBe(true);
	});
});

describe("needsProgressReset", () => {
	it("is false for an empty task list", () => {
		expect(needsProgressReset([])).toBe(false);
	});

	it("is false when every task and subtask is pending", () => {
		expect(
			needsProgressReset([
				{ status: "pending", subtasks: [{ name: "A", status: "pending" }] },
			]),
		).toBe(false);
	});

	it("is true when a task status is not pending", () => {
		expect(
			needsProgressReset([{ status: "completed", subtasks: [] }]),
		).toBe(true);
		expect(
			needsProgressReset([{ status: "in_progress", subtasks: [] }]),
		).toBe(true);
		expect(needsProgressReset([{ status: "failed", subtasks: [] }])).toBe(true);
	});

	it("is true when a subtask is not pending even if the task is pending", () => {
		expect(
			needsProgressReset([
				{ status: "pending", subtasks: [{ name: "A", status: "completed" }] },
			]),
		).toBe(true);
	});

	it("treats a null task status as needing reset", () => {
		expect(needsProgressReset([{ status: null, subtasks: [] }])).toBe(true);
	});

	it("ignores malformed subtask entries", () => {
		expect(
			needsProgressReset([
				{ status: "pending", subtasks: [null, "x", { status: "completed" }] },
			]),
		).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/services/task-reset.test.ts`
Expected: FAIL — `Failed to resolve import "./task-reset"`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/services/task-reset.ts`:

```ts
// Task-progress reset (status only). No regeneration, no credit burn: the task
// set the user already approved is preserved and only its progress is cleared.

export const TASK_STATUS_PENDING = "pending" as const;

export interface ResetableSubtask {
	name: string;
	status: string;
	[key: string]: unknown;
}

function isWellFormedSubtask(entry: unknown): entry is Record<string, unknown> {
	return (
		entry !== null &&
		typeof entry === "object" &&
		!Array.isArray(entry) &&
		typeof (entry as Record<string, unknown>).name === "string"
	);
}

/**
 * Rebuild a subtask array for reset: every element must be an object carrying a
 * string `name`, its other own fields are preserved verbatim, and `status` is
 * forced to "pending". Malformed elements are dropped rather than trusted —
 * the same structural filter `getTaskTree` and `getKanbanData` already apply.
 */
export function normalizeSubtasksForReset(raw: unknown): ResetableSubtask[] {
	if (!Array.isArray(raw)) return [];
	const out: ResetableSubtask[] = [];
	for (const entry of raw) {
		if (!isWellFormedSubtask(entry)) continue;
		out.push({ ...entry, name: entry.name as string, status: TASK_STATUS_PENDING });
	}
	return out;
}

/**
 * Whether the RAW subtask value holds work that is not pending. This reads the
 * input, never `normalizeSubtasksForReset`'s output: normalization always writes
 * "pending", so inspecting its result could never report a change. A well-formed
 * entry with a missing status counts as non-pending — it is not a value this
 * codebase writes, so it is treated as needing a reset rather than trusted.
 */
export function hasNonPendingSubtask(raw: unknown): boolean {
	if (!Array.isArray(raw)) return false;
	return raw.some(
		(entry) =>
			isWellFormedSubtask(entry) &&
			(entry as Record<string, unknown>).status !== TASK_STATUS_PENDING,
	);
}

/**
 * Whether a reset would change anything. Drives both the endpoint's no-op
 * response and the UI's disabled state, so the user is never told a reset
 * happened when nothing was reset.
 */
export function needsProgressReset(
	tasks: readonly { status: string | null; subtasks: unknown }[],
): boolean {
	return tasks.some(
		(task) =>
			task.status !== TASK_STATUS_PENDING ||
			hasNonPendingSubtask(task.subtasks),
	);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/services/task-reset.test.ts`
Expected: PASS — 15 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/task-reset.ts src/lib/services/task-reset.test.ts
git commit -m "feat(tasks): add pure task-progress reset helpers"
```

---

### Task 2: Reset endpoint

**Files:**
- Create: `src/routes/api/projects/$id/reset-progress.ts`
- Test: `src/routes/api/projects/-reset-progress.test.ts`

**Interfaces:**
- Consumes from Task 1: `normalizeSubtasksForReset`, `needsProgressReset`, `hasNonPendingSubtask`, `TASK_STATUS_PENDING` from `@/lib/services/task-reset`.
- Produces: `POST /api/projects/$id/reset-progress` returning
  `{ reset: true; tasksReset: number }` on success,
  `{ reset: false; tasksReset: 0 }` when nothing needed reset,
  `{ error: string }` with 401/404/429/500 otherwise.
  Also exports `RESET_PROGRESS_ROUTE_PATH = "/api/projects/$id/reset-progress"` for tests.

**Note on route registration:** `src/routeTree.gen.ts` is generated. After creating the file, run `pnpm generate-routes` so the route type exists; do not hand-edit the generated file.

- [ ] **Step 1: Write the failing test**

Create `src/routes/api/projects/-reset-progress.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RESET_PROGRESS_ROUTE_PATH } from "./reset-progress";

describe("reset-progress route", () => {
	it("is mounted under the project id path", () => {
		expect(RESET_PROGRESS_ROUTE_PATH).toBe("/api/projects/$id/reset-progress");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/routes/api/projects/-reset-progress.test.ts`
Expected: FAIL — `Failed to resolve import "./reset-progress"`

- [ ] **Step 3: Write minimal implementation**

Create `src/routes/api/projects/$id/reset-progress.ts`:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, isNull } from "drizzle-orm";
// Server-import exception: top-level `@/db` and schema imports are correct here
// — server handler only, no client component (neighboring `/api/projects`
// pattern). Never import this module from client code.
import { db } from "@/db";
import { projects, subscriptions, tasks } from "@/db/schema";
import {
	hasNonPendingSubtask,
	needsProgressReset,
	normalizeSubtasksForReset,
	TASK_STATUS_PENDING,
} from "@/lib/services/task-reset";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import type { Plan } from "@/types/database";

export const RESET_PROGRESS_ROUTE_PATH = "/api/projects/$id/reset-progress";

// Same plan resolution as the neighboring codebase routes
// (`src/routes/api/codebase/$projectId/session.ts:42-53`): the rate-limit tier
// comes from the user's own subscription, never a hardcoded default.
async function resolvePlan(userId: string): Promise<Plan> {
	const [sub] = await db
		.select({ plan: subscriptions.plan })
		.from(subscriptions)
		.where(eq(subscriptions.userId, userId))
		.orderBy(desc(subscriptions.createdAt))
		.limit(1);
	const rawPlan = sub?.plan || "free";
	return ["free", "pro", "hengker"].includes(rawPlan)
		? (rawPlan as Plan)
		: "free";
}

export const Route = createFileRoute("/api/projects/$id/reset-progress")({
	server: {
		handlers: {
			// Clears task progress only. The task set, PRD, AC, and the project's
			// stage are untouched: this exists so the same plan can be handed to
			// an agent again without burning a credit on regeneration.
			POST: async ({
				request,
				params,
			}: {
				request: Request;
				params: { id: string };
			}) => {
				let user: { id: string };
				try {
					user = await requireUser(request.headers);
				} catch {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}
				const { id: projectId } = params;

				const plan = await resolvePlan(user.id);
				const rateCheck = await checkRateLimit(user.id, plan, "api_call");
				if (!rateCheck.allowed)
					return Response.json(
						{ error: "Terlalu banyak permintaan", retryAfter: 60 },
						{ status: 429 },
					);

				try {
					const result = await db.transaction(async (tx) => {
						// Ownership is established on the locked project row so a
						// project that disappears or changes hands mid-request can
						// never be reset without revalidation.
						const [project] = await tx
							.select({ id: projects.id })
							.from(projects)
							.where(
								and(
									eq(projects.id, projectId),
									eq(projects.userId, user.id),
									isNull(projects.deletedAt),
								),
							)
							.limit(1)
							.for("update");
						if (!project) return { kind: "not_found" as const };

						// Row lock: concurrent resets serialize here instead of
						// racing on a stale read, and the no-op decision is made
						// on the locked rows.
						const rows = await tx
							.select({
								id: tasks.id,
								status: tasks.status,
								subtasks: tasks.subtasks,
							})
							.from(tasks)
							.where(eq(tasks.projectId, projectId))
							.for("update");

						if (!needsProgressReset(rows)) {
							return { kind: "noop" as const, tasksReset: 0 };
						}

						const now = new Date();
						let tasksReset = 0;
						for (const row of rows) {
							// Change is detected with the raw-value helper:
							// normalizeSubtasksForReset always writes "pending", so
							// inspecting its output could never report a change.
							if (
								row.status === TASK_STATUS_PENDING &&
								!hasNonPendingSubtask(row.subtasks)
							) {
								continue;
							}
							await tx
								.update(tasks)
								.set({
									status: TASK_STATUS_PENDING,
									startedAt: null,
									completedAt: null,
									subtasks: normalizeSubtasksForReset(row.subtasks),
									updatedAt: now,
								})
								.where(
									and(eq(tasks.id, row.id), eq(tasks.projectId, projectId)),
								);
							tasksReset += 1;
						}
						return { kind: "reset" as const, tasksReset };
					});

					if (result.kind === "not_found")
						return Response.json(
							{ error: "Project tidak ditemukan" },
							{ status: 404 },
						);
					if (result.kind === "noop")
						return Response.json({ reset: false, tasksReset: 0 });
					return Response.json({
						reset: true,
						tasksReset: result.tasksReset,
					});
				} catch (e) {
					console.error("reset-progress handler failed:", e);
					return Response.json(
						{ error: "Gagal mereset progress" },
						{ status: 500 },
					);
				}
			},
		},
	},
});
```

- [ ] **Step 4: Generate routes and run test to verify it passes**

Run: `pnpm generate-routes; if ($?) { pnpm exec vitest run src/routes/api/projects/-reset-progress.test.ts }`
Expected: PASS — 1 test

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. If `createFileRoute` rejects the path, re-run `pnpm generate-routes`.

- [ ] **Step 6: Commit**

```bash
git add src/routes/api/projects/$id/reset-progress.ts src/routes/api/projects/-reset-progress.test.ts src/routeTree.gen.ts
git commit -m "feat(api): add project task-progress reset endpoint"
```

---

### Task 3: Kanban reset button

**Files:**
- Modify: `src/components/kanban/kanban-board.tsx` (header actions block at lines 316–335; component props at lines 34–45)
- Test: `src/components/kanban/kanban-board.test.tsx`

**Interfaces:**
- Consumes: `POST /api/projects/$id/reset-progress` from Task 2; `needsProgressReset` from Task 1.
- Produces: an exported pure helper
  `function canResetProgress(columns: Record<string, Array<{ id: string }>> | null): boolean`
  returning true when any card sits outside the `pending` column. Later tasks rely on this name.

- [ ] **Step 1: Write the failing test**

Append to `src/components/kanban/kanban-board.test.tsx`:

```ts
import { canResetProgress } from "./kanban-board";

describe("canResetProgress", () => {
	it("is false when there are no columns", () => {
		expect(canResetProgress(null)).toBe(false);
	});

	it("is false when every card is pending", () => {
		expect(
			canResetProgress({
				pending: [{ id: "t1" }],
				in_progress: [],
				completed: [],
				failed: [],
			}),
		).toBe(false);
	});

	it("is true when any card left the pending column", () => {
		expect(
			canResetProgress({
				pending: [],
				in_progress: [{ id: "t1" }],
				completed: [],
				failed: [],
			}),
		).toBe(true);
		expect(
			canResetProgress({
				pending: [],
				in_progress: [],
				completed: [{ id: "t1" }],
				failed: [],
			}),
		).toBe(true);
		expect(
			canResetProgress({
				pending: [],
				in_progress: [],
				completed: [],
				failed: [{ id: "t1" }],
			}),
		).toBe(true);
	});

	it("is false for an empty board", () => {
		expect(
			canResetProgress({
				pending: [],
				in_progress: [],
				completed: [],
				failed: [],
			}),
		).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/kanban/kanban-board.test.tsx`
Expected: FAIL — `canResetProgress is not a function` (or import error)

- [ ] **Step 3: Add the pure helper**

In `src/components/kanban/kanban-board.tsx`, add beside the other module-level exports (above the component):

```ts
// Whether a progress reset would change anything. Mirrors the server's
// `needsProgressReset` for the UI's disabled state: a board with everything
// still pending has no work to clear, so the action is hidden rather than
// offering a no-op button.
export function canResetProgress(
	columns: Record<string, Array<{ id: string }>> | null,
): boolean {
	if (!columns) return false;
	const nonPending = ["in_progress", "completed", "failed"] as const;
	return nonPending.some((status) => (columns[status]?.length ?? 0) > 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/kanban/kanban-board.test.tsx`
Expected: PASS — existing tests plus 4 new ones

- [ ] **Step 5: Wire the button and confirmation dialog**

In `src/components/kanban/kanban-board.tsx`:

Add imports (keep the existing import style in the file):

```ts
import { RotateCcw } from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
```

Inside the component, next to the other state hooks, add:

```ts
const [resetDialogOpen, setResetDialogOpen] = useState(false);
const [isResetting, setIsResetting] = useState(false);
```

Add the handler beside the other callbacks:

```ts
const handleResetProgress = async () => {
	setIsResetting(true);
	try {
		const res = await fetch(
			`/api/projects/${encodeURIComponent(projectId)}/reset-progress`,
			{ method: "POST" },
		);
		const json = (await res.json().catch(() => null)) as unknown;
		if (!res.ok) {
			const message =
				json && typeof json === "object" && "error" in json
					? String((json as { error: unknown }).error)
					: "Gagal mereset progress.";
			showToast(message, "error");
			return;
		}
		const tasksReset =
			json && typeof json === "object" && "tasksReset" in json
				? Number((json as { tasksReset: unknown }).tasksReset)
				: 0;
		showToast(
			tasksReset > 0
				? `${tasksReset} task dikembalikan ke pending.`
				: "Tidak ada progress yang perlu direset.",
			"success",
		);
		setResetDialogOpen(false);
		refetch();
	} catch {
		showToast("Gagal menghubungi server.", "error");
	} finally {
		setIsResetting(false);
	}
};
```

Add `const showToast = useUIStore((s) => s.showToast);` beside the existing `useUIStore` reads if it is not already destructured in this component.

In the header actions block (currently containing the `Roadmap` and `Kembali ke Beranda` links), add before `Roadmap`:

```tsx
{canResetProgress(columns) && (
	<Button
		variant="outline"
		size="sm"
		onClick={() => setResetDialogOpen(true)}
		disabled={isResetting}
		className="gap-1.5"
	>
		<RotateCcw size={14} />
		{isResetting ? "Mereset..." : "Reset Progress"}
	</Button>
)}
```

Add the confirmation dialog at the end of the component's returned JSX, inside the same fragment as the existing `KanbanBanner`/dialog siblings:

```tsx
<Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
	<DialogContent className="max-w-md">
		<DialogHeader>
			<DialogTitle>Reset progress task?</DialogTitle>
			<DialogDescription>
				Status semua task dikembalikan ke <strong>pending</strong> supaya agent
				bisa mengerjakannya dari awal. Task, PRD, dan AC tidak diubah, dan tidak
				ada kredit yang terpakai.
			</DialogDescription>
		</DialogHeader>
		<DialogFooter>
			<Button
				variant="ghost"
				onClick={() => setResetDialogOpen(false)}
				disabled={isResetting}
			>
				Batal
			</Button>
			<Button
				onClick={() => void handleResetProgress()}
				disabled={isResetting}
			>
				{isResetting ? "Mereset..." : "Reset Progress"}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
```

- [ ] **Step 6: Verify in the browser**

Run: `pnpm dev`
Open a project at `/kanban/$id` that has at least one completed task.
Expected:
- "Reset Progress" appears only when a task is not pending.
- Clicking it opens the confirmation; "Batal" closes without change.
- Confirming moves every card back to the Pending column and the button disappears.
- `/prd/$id` and `/ac/$id` still show the same content as before the reset.

- [ ] **Step 7: Lint, typecheck, commit**

```bash
pnpm check
pnpm exec tsc --noEmit
git add src/components/kanban/kanban-board.tsx src/components/kanban/kanban-board.test.tsx
git commit -m "feat(kanban): add task-progress reset action"
```

---

### Task 4: Confirmation in the AI-agent handoff flow

**Files:**
- Modify: `src/components/task/implementation-options.tsx` (the `handlePromptAi` callback at lines 285–312 and the dialog block at lines 359–416)
- Test: `src/components/task/implementation-options.test.tsx` (new)

**Interfaces:**
- Consumes: `POST /api/projects/$id/reset-progress` from Task 2.
- Produces: exported pure helper
  `function shouldConfirmReset(hasUnfinishedProgress: boolean): boolean`
  returning its argument unchanged — a named seam so the branching is unit-tested rather than inlined.

- [ ] **Step 1: Write the failing test**

Create `src/components/task/implementation-options.test.tsx`:

```ts
import { describe, expect, it } from "vitest";
import { shouldConfirmReset } from "./implementation-options";

describe("shouldConfirmReset", () => {
	it("asks for confirmation when progress exists", () => {
		expect(shouldConfirmReset(true)).toBe(true);
	});

	it("skips confirmation when nothing has been worked on", () => {
		expect(shouldConfirmReset(false)).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/task/implementation-options.test.tsx`
Expected: FAIL — `shouldConfirmReset is not a function`

- [ ] **Step 3: Add the helper and the confirmation branch**

In `src/components/task/implementation-options.tsx`, add above the component:

```ts
// The handoff flow offers a progress reset, but only as a confirmation: copying
// a fresh API key must never silently discard work the user already finished.
export function shouldConfirmReset(hasUnfinishedProgress: boolean): boolean {
	return hasUnfinishedProgress;
}
```

Extend the props interface:

```ts
interface ImplementationOptionsProps {
	projectId: string;
	projectName: string;
	hasContent: boolean;
	/** True when at least one task is not in `pending`. */
	hasUnfinishedProgress?: boolean;
}
```

Add state beside the existing state hooks:

```ts
const [resetDialogOpen, setResetDialogOpen] = useState(false);
const [isResetting, setIsResetting] = useState(false);
```

Change `handlePromptAi` so the confirmation gates the prompt modal. Replace the existing `handlePromptAi` body's first lines with:

```ts
const handlePromptAi = useCallback(async () => {
	if (shouldConfirmReset(hasUnfinishedProgress ?? false)) {
		setResetDialogOpen(true);
		return;
	}
	await buildPromptAndOpen();
}, [hasUnfinishedProgress, buildPromptAndOpen]);
```

Rename the existing prompt-building body (everything currently inside `handlePromptAi`) into a new callback above it, unchanged except for the name:

```ts
const buildPromptAndOpen = useCallback(async () => {
	setIsLoading(true);
	try {
		const [data, autoKeyData] = await Promise.all([
			fetchContent(),
			fetch("/api/settings/api-keys/auto", { method: "POST" })
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null),
		]);
		const apiKey = autoKeyData?.rawKey || "<GANTI_DENGAN_API_KEY_KAMU>";
		const prompt = AI_AGENT_PROMPT_TEMPLATE.replace(
			/{projectName}/g,
			data.projectName || projectName,
		)
			.replace(/{prdContent}/g, data.prd || "(Belum ada PRD)")
			.replace(/{acContent}/g, data.ac || "(Belum ada AC)")
			.replace(/{tasksContent}/g, data.tasks || "(Belum ada tasks)")
			.replace(/{projectId}/g, projectId)
			.replace(/{apiKey}/g, apiKey);

		setPromptText(prompt);
		setShowPromptModal(true);
	} catch {
		showToast("Gagal mengambil data project", "error");
	} finally {
		setIsLoading(false);
	}
}, [fetchContent, projectName, showToast, projectId]);
```

Add the reset handler:

```ts
const handleConfirmReset = useCallback(async () => {
	setIsResetting(true);
	try {
		const res = await fetch(
			`/api/projects/${encodeURIComponent(projectId)}/reset-progress`,
			{ method: "POST" },
		);
		const json = (await res.json().catch(() => null)) as unknown;
		if (!res.ok) {
			const message =
				json && typeof json === "object" && "error" in json
					? String((json as { error: unknown }).error)
					: "Gagal mereset progress.";
			showToast(message, "error");
			return;
		}
		const tasksReset =
			json && typeof json === "object" && "tasksReset" in json
				? Number((json as { tasksReset: unknown }).tasksReset)
				: 0;
		showToast(
			tasksReset > 0
				? `${tasksReset} task dikembalikan ke pending.`
				: "Tidak ada progress yang perlu direset.",
			"success",
		);
		setResetDialogOpen(false);
		await buildPromptAndOpen();
	} catch {
		showToast("Gagal menghubungi server.", "error");
	} finally {
		setIsResetting(false);
	}
}, [projectId, showToast, buildPromptAndOpen]);
```

Add the dialog before the closing `</>` of the component's return:

```tsx
<Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
	<DialogContent className="max-w-md">
		<DialogHeader>
			<DialogTitle>Reset progress sebelum handoff?</DialogTitle>
			<DialogDescription>
				Beberapa task sudah dikerjakan. Reset status ke <strong>pending</strong>{" "}
				supaya agent mengerjakan semuanya dari awal. Task, PRD, dan AC tidak
				diubah, dan tidak ada kredit yang terpakai.
			</DialogDescription>
		</DialogHeader>
		<DialogFooter>
			<Button
				variant="ghost"
				onClick={() => {
					setResetDialogOpen(false);
					void buildPromptAndOpen();
				}}
				disabled={isResetting}
			>
				Tanpa reset
			</Button>
			<Button onClick={() => void handleConfirmReset()} disabled={isResetting}>
				{isResetting ? "Mereset..." : "Reset lalu lanjut"}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/task/implementation-options.test.tsx`
Expected: PASS — 2 tests

- [ ] **Step 5: Pass the prop from the task page**

In `src/components/task/task-detail.tsx`, compute the flag from the loaded task tree and pass it to `ImplementationOptions` at line ~428:

```tsx
const hasUnfinishedProgress = Boolean(
	taskTree?.features.some((feature) =>
		feature.tasks.some((task) => task.status !== "pending"),
	),
);
```

The `TaskTree` type does not currently carry `status`; extend it in
`src/lib/services/task-service.ts` (`TaskTree.features[].tasks[]`) with
`status: string`, and populate it in `getTaskTree`'s row mapping from the
selected `tasks.status` column (add it to the `.select({...})` projection at
lines 326–337).

```tsx
<ImplementationOptions
	projectId={projectId}
	projectName={projectName}
	hasContent={hasContent}
	hasUnfinishedProgress={hasUnfinishedProgress}
/>
```

- [ ] **Step 6: Verify in the browser**

Run: `pnpm dev`
Open a project with completed tasks at `/task/$id`.
Expected:
- "Pilih Implementasi" → "Prompt AI Agent" opens the reset confirmation.
- "Tanpa reset" opens the prompt modal and leaves the board untouched.
- "Reset lalu lanjut" resets, shows the count toast, then opens the prompt modal.
- On a project with nothing worked on, "Prompt AI Agent" opens the modal directly.

- [ ] **Step 7: Lint, typecheck, test, commit**

```bash
pnpm check
pnpm exec tsc --noEmit
pnpm exec vitest run
git add src/components/task/implementation-options.tsx src/components/task/implementation-options.test.tsx src/components/task/task-detail.tsx src/lib/services/task-service.ts
git commit -m "feat(task): offer progress reset during AI-agent handoff"
```

---

### Task 5: End-to-end verification

**Files:**
- Create: `e2e/task-progress-reset.spec.ts`

**Interfaces:**
- Consumes: the endpoint from Task 2 and both UI triggers from Tasks 3–4.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the spec**

Create `e2e/task-progress-reset.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test.describe("Task progress reset", () => {
	test("API rejects unauthenticated reset", async ({ request }) => {
		const res = await request.post(
			"/api/projects/00000000-0000-0000-0000-000000000000/reset-progress",
		);
		expect(res.status()).toBe(401);
	});

	test("API rejects a nonexistent project for an authenticated user", async ({
		request,
	}) => {
		const res = await request.post(
			"/api/projects/00000000-0000-0000-0000-000000000000/reset-progress",
		);
		expect([401, 404]).toContain(res.status());
	});
});
```

- [ ] **Step 2: Run the spec**

Run: `pnpm exec playwright test e2e/task-progress-reset.spec.ts`
Expected: PASS — 2 tests. If the dev server is not running, start it with `pnpm dev` first.

- [ ] **Step 3: Full verification**

Run: `pnpm check; if ($?) { pnpm exec tsc --noEmit }; if ($?) { pnpm exec vitest run }; if ($?) { pnpm build }`
Expected: all pass, no errors.

- [ ] **Step 4: Commit**

```bash
git add e2e/task-progress-reset.spec.ts
git commit -m "test(e2e): cover task-progress reset guards"
```

---

## Self-Review Notes

**Spec coverage (Part 1):**

| Spec requirement | Task |
|---|---|
| Reset sets `status`/`startedAt`/`completedAt`/subtask status | 1, 2 |
| Task set, ids, and every other column preserved | 1 (normalization), 2 (update projection) |
| No AI call, no credit, no `saveTaskTree` | 2 (transaction touches only `tasks` status columns) |
| No-op detection and honest count | 1 (`needsProgressReset`), 2 (`tasksReset`), 3/4 (toasts) |
| Trigger A — Kanban button | 3 |
| Trigger B — handoff confirmation, decline does not reset | 4 |
| PRD/AC unchanged and locked | 3 Step 6, 5 Step 3 (manual browser check) |
| Ownership + deleted-project rejection inside the transaction | 2 Step 3 |
| Rate limiting | 2 Step 3 |
| Concurrent double reset idempotent | 2 (single transaction, `needsProgressReset` re-read under `FOR UPDATE`) |
| Unit / API / browser verification | 1, 2, 3, 4, 5 |

**Spec items intentionally not covered here** (they belong to the codebase plan):
`codebases` table, snapshot selection, generation-context resolution, codebase pages, migration, deletion semantics, and the five corrections in the spec's "Corrections carried into this design" section.

**Deferred from this plan:** the spec's state-matrix row "Reset failed (network/server) — retry available" is satisfied by the toast plus the button remaining enabled; no separate retry affordance is added because the action is idempotent and re-clickable.
