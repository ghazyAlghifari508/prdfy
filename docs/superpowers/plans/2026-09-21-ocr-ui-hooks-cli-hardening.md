# Implementation Plan: PRDFY Codebase Remediation (OCR Findings)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining valid OCR findings for PRDFY across Modal Dialog Accessibility & Focus Trap, Codebase Review & Sync UI, Kanban Hooks, and CLI Hardening, with full test coverage and zero type-safety bypasses.

**Architecture:** 
- Add a shared accessible focus-trap and focus-restoration hook for custom overlays and enhance `CreditExhaustedModal`, `ResumeErrorModal`, and `SyncAgentModal` with ARIA dialog semantics, labeled headings, keyboard escape dismissal, and URL parameter retention.
- Harden `CodebaseReview`, `ScreenConnect`, and `SyncStatus` with generic uncertainty formatting, collision-free React keys, accurate unavailable metadata states, unmount timer cleanup, clipboard fallback handling, and single-source sequential polling.
- Harden `useKanbanTasks`, `useCanvasZoom`, and `usePanelResize` against race conditions, RAF leaks, unbounded reconnection, and gesture jumps.
- Harden `packages/cli` against terminal control sequence spoofing and replace unconstrained in-memory repo loading with streaming chunk uploads.

**Tech Stack:** React 19, TypeScript 5/6, TanStack Router/Start, TanStack Query, Vitest, Commander, Chalk.

**Spec:** OCR Review findings (`C:/Users/alghi/AppData/Local/Temp/opencode/ocr-prdfy-source.json`) and User Task Instructions.

## Global Constraints
- Zero type bypasses (`as any`, `as never`, `@ts-ignore`, `@ts-expect-error` are strictly forbidden).
- Adhere strictly to existing styling tokens and design conventions (`DESIGN.md` and `.agents/rules/*`).
- Do not weaken or delete existing tests; all existing 806 tests must remain green.
- Verify with `pnpm exec tsc --noEmit` and `pnpm exec vitest run` before and after each domain.

---

### Task 1: Modal Dialog Accessibility & Focus Trap

**Files:**
- Create: `src/hooks/use-focus-trap.ts`
- Create: `src/hooks/use-focus-trap.test.tsx`
- Modify: `src/components/chat/credit-exhausted-modal.tsx`
- Modify: `src/components/chat/resume-error-modal.tsx`
- Modify: `src/components/codebase/sync-agent-modal.tsx`
- Create: `src/components/chat/credit-exhausted-modal.test.tsx`
- Create: `src/components/chat/resume-error-modal.test.tsx`

**Interfaces:**
- `useFocusTrap(options: { isOpen: boolean; onEscape?: () => void }): React.RefObject<HTMLDivElement | null>`: traps tab navigation within the ref container, handles Escape callback, and restores previous activeElement on close/unmount.

- [ ] **Step 1: Write failing tests for `useFocusTrap`**
- [ ] **Step 2: Implement `src/hooks/use-focus-trap.ts`**
- [ ] **Step 3: Update `CreditExhaustedModal` with dialog semantics (`role="dialog"`, `aria-modal="true"`, `aria-labelledby="credit-exhausted-modal-title"`), returnUrl search/hash preservation, and `useFocusTrap`**
- [ ] **Step 4: Update `ResumeErrorModal` with dialog semantics, close button `aria-label="Tutup"`, `aria-labelledby`, `aria-describedby`, and `useFocusTrap`**
- [ ] **Step 5: Update `SyncAgentModal` with dialog semantics, `useFocusTrap`, escape dismissal, and copy status resets on payload/open change**
- [ ] **Step 6: Run tests and verify all pass**
- [ ] **Step 7: Commit Area 1 changes**

---

### Task 2: Codebase Review & Sync UI

**Files:**
- Modify: `src/components/codebase/codebase-review.tsx`
- Modify: `src/components/codebase/screen-connect.tsx`
- Modify: `src/components/codebase/sync-status.tsx`
- Modify: `src/components/codebase/codebase-review.test.tsx`
- Create: `src/components/codebase/screen-connect.test.tsx`
- Modify: `src/components/codebase/sync-status.test.tsx`

**Interfaces:**
- `CodebaseReview`: render generic uncertainty `Perlu verifikasi: {f.uncertainty}`, unique keys `${entry.path}-${idx}`, `${area}-${idx}`, `${f.title}-${idx}`, `${lim}-${idx}`, display `—` when `fileCount` or `excludedCount` is undefined.
- `ScreenConnect`: unmount cleanup for copy timer ref, `copyError` state and visible fallback prompt selection when clipboard API fails.
- `SyncStatus`: eliminate double polling when `propStatus !== undefined`, use single recursive timer loop or clean in-flight guard, handle `onBackToInstructions` action if passed.

- [ ] **Step 1: Update `src/components/codebase/codebase-review.tsx` with generic uncertainty formatting, unique composite keys, and undefined count guards**
- [ ] **Step 2: Update `src/components/codebase/screen-connect.tsx` with timer ref cleanup and clipboard fallback error UI**
- [ ] **Step 3: Update `src/components/codebase/sync-status.tsx` to cleanly handle controlled propStatus, recursive polling timing, and onBackToInstructions action**
- [ ] **Step 4: Run codebase review, screen-connect, and sync-status tests to verify they pass**
- [ ] **Step 5: Commit Area 2 changes**

---

### Task 3: Kanban Hooks Hardening

**Files:**
- Modify: `src/hooks/use-kanban-polling.ts`
- Modify: `src/hooks/use-canvas-zoom.ts`
- Modify: `src/hooks/use-panel-resize.ts`
- Modify: `src/hooks/use-kanban-polling.test.tsx`
- Modify: `src/hooks/use-canvas-zoom.test.tsx`
- Modify: `src/hooks/use-panel-resize.test.tsx`

**Interfaces:**
- `useKanbanTasks`: reset data and state on disable/project change; bounded reconnect with retry count (e.g. 3 attempts) and backoff before permanently falling back to polling.
- `useCanvasZoom`: `resetZoom` cancels both RAFs and resets refs (`pendingPointerRef`, `pendingZoomFactorRef`, `isPanningRef`); `startPan` cancels pending pan RAF and clears `pendingPointerRef` before setting new baseline; bounds `zoom` to `[minZoom, maxZoom]`.
- `usePanelResize`: clamp initial widths (`initialRightWidth`, `initialLeftWidth`); prevent concurrent left/right drag overlap; preserve and restore previous `document.body.style.userSelect`; cancel pending RAF on cleanup.

- [ ] **Step 1: Update `src/hooks/use-canvas-zoom.ts` to cancel RAFs, clear transient refs on reset and startPan, and clamp zoom limits**
- [ ] **Step 2: Update `src/hooks/use-panel-resize.ts` to clamp initial widths, prevent drag overlap, and cleanly restore userSelect**
- [ ] **Step 3: Update `src/hooks/use-kanban-polling.ts` with bounded reconnect attempts before permanent polling degradation and full state reset on disable**
- [ ] **Step 4: Run hook tests and verify all pass**
- [ ] **Step 5: Commit Area 3 changes**

---

### Task 4: CLI Hardening (`packages/cli`)

**Files:**
- Modify: `packages/cli/src/commands/kanban.ts`
- Modify: `packages/cli/src/lib/sync-client.ts`
- Modify: `packages/cli/src/commands/codebase.ts`
- Modify: `packages/cli/src/commands/codebase.test.ts`
- Create: `packages/cli/src/commands/kanban.test.ts`

**Interfaces:**
- `packages/cli/src/commands/kanban.ts`: sanitize task names and column output against ANSI/OSC control sequences; runtime validation of columns array.
- `packages/cli/src/lib/sync-client.ts`: support `startIndex` in `uploadFileChunksWithRetry` for correct slot idempotency keys.
- `packages/cli/src/commands/codebase.ts`: stream uploads file-by-file without buffering the entire repository base64 array in memory; accurate `uploadedBytes` calculation; safe client factory error handling.

- [ ] **Step 1: Add unit tests for `kanbanCommand` sanitization and column validation**
- [ ] **Step 2: Harden `kanbanCommand` in `packages/cli/src/commands/kanban.ts`**
- [ ] **Step 3: Add `startIndex` parameter in `uploadFileChunksWithRetry` in `packages/cli/src/lib/sync-client.ts`**
- [ ] **Step 4: Stream file chunks file-by-file in `packages/cli/src/commands/codebase.ts` to prevent out-of-memory spikes on large repositories**
- [ ] **Step 5: Run CLI build and test suites to verify**
- [ ] **Step 6: Commit Area 4 changes**

---

### Task 5: Final Full Verification & Audit

- [ ] **Step 1: Run `pnpm exec tsc --noEmit` across whole repo**
- [ ] **Step 2: Run `pnpm exec vitest run` across all test suites**
- [ ] **Step 3: Run `pnpm -C packages/cli run build`**
- [ ] **Step 4: Verify zero type bypasses (`rg -n "as never|as any|@ts-ignore|@ts-expect-error" src packages/cli/src`)**
- [ ] **Step 5: Final git status inspection and summary**
