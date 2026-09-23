# Super-Detailed Task Generation Protocol & Navbar Top-Up Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform PRDFY's task generation engine into a microscopic, 5-layer engineering blueprint (with Phase 0 infrastructure scaffolding, strict 1:1 mapping to PRD Section 5.3 Pages & Screens, and 4 mandatory UI states) while adding a dedicated credit top-up modal and navbar trigger button beside the dark/light mode toggle for active subscribers.

**Architecture:**
1. Task Generation: Update system prompt and depth directives (`prompts-task.ts`, `prompt-depth.ts`) to mandate Phase 0 Scaffolding, enforce 5-layer decomposition per AC feature, remove the single-task fullstack loophole, and lock UI tasks to PRD Section 5.3 surfaces with mandatory 4-state subtasks.
2. Top-Up Modal & Navbar Trigger: Extract pure eligibility logic `canShowNavbarTopUp`, implement `TopUpModal` using `@radix-ui/react-dialog` with Midtrans Snap integration, and mount the top-up trigger button beside `<ThemeToggle />` in `navbar.tsx`.

**Tech Stack:** TanStack Start, React 19, Radix UI Dialog, Tailwind CSS 4, Drizzle ORM, Midtrans Snap, Vitest, Biome, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-09-23-super-detailed-task-generation-and-topup-modal-design.md`

## Global Constraints

- Strict AC Bounding: Tasks generated must strictly cover existing Acceptance Criteria. Zero invented features, external services, or unrequested database tables.
- Zero Type Bypasses: No `as any`, `as never`, `@ts-ignore`, or `as unknown as` anywhere in application or test code.
- No Hardcoding: Use existing constants (`TOPUP_SKU` in `src/lib/constants.ts`).
- Anti-AI-Slop & UI Standards: Hairline 1px borders, no 3D drop shadows, no neon gradients, monochromatic SVG icons, Indonesian UI copy with English technical terms.
- Tests: Pure helpers tested first via Vitest; full suite and typecheck must remain pristine.

---

### Task 1: Update Task Depth Directive

**Files:**
- Modify: `src/lib/prompt-depth.ts`
- Test: `src/lib/prompt-depth.test.ts` (create)

**Interfaces:**
- Consumes: `depthDirective(kind: DocKind): string`
- Produces: Enhanced `TASK` depth directive mandating uncompressed, granular task decomposition across all project tiers.

- [ ] **Step 1: Write the failing test**

Create `src/lib/prompt-depth.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { depthDirective } from "./prompt-depth";

describe("depthDirective('task')", () => {
	it("mandates deep, uncompressed structural decomposition without skipping layers", () => {
		const directive = depthDirective("task");
		expect(directive).toContain("KOMPLEKSITAS");
		expect(directive).toContain("JANGAN mengurangi task atau menggabungkan requirement berbeda");
		expect(directive).toContain("5-layer");
		expect(directive).toContain("Fase 0");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/prompt-depth.test.ts`
Expected: FAIL ("5-layer" / "Fase 0" not yet in directive).

- [ ] **Step 3: Update `src/lib/prompt-depth.ts`**

Update `TASK` constant in `src/lib/prompt-depth.ts`:
```ts
const TASK = `
## MODE KEDALAMAN: ADAPTIF & DETAIL LENGKAP
Sesuaikan jumlah task, subtask, dan detail dengan KOMPLEKSITAS requirement di PRD + AC:
- Wajib menyertakan Fase 0 (Inisialisasi & Fondasi Infrastruktur) sebelum masuk ke fitur fungsional.
- Setiap fitur pada AC wajib dipecah ke dalam 5-layer teknis (Data/Storage, Domain/Service Logic, API Contract, Dedicated Screen Layout, UI States & Interaction).
- Fitur simpel → sedikit task per layer tapi tetap modular, detail secukupnya.
- Fitur kompleks (banyak state, aturan bisnis, integrasi, async lifecycle) → banyak task dan subtask, detail mendalam per sub-komponen.
Jumlah task mengikuti jumlah deliverable yang benar-benar dibutuhkan, bukan target angka. JANGAN memaksakan banyak task kosong untuk fitur simpel. JANGAN mengurangi task atau menggabungkan requirement berbeda hanya agar output lebih pendek. Setiap subtask WAJIB punya field "details" (array langkah granular, minimum 1 item).`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/prompt-depth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompt-depth.ts src/lib/prompt-depth.test.ts
git commit -m "feat(prompt): mandate 5-layer and Phase 0 depth in task directive"
```

---

### Task 2: Implement Super-Detailed Task Generation Prompt & Coverage Rules

**Files:**
- Modify: `src/lib/prompts-task.ts`
- Test: `src/lib/prompts-task.test.ts` (create)

**Interfaces:**
- Consumes: `TASK_GENERATION_PROMPT`
- Produces: Comprehensive task prompt specifying:
  1. Mandatory Phase 0: "Inisialisasi & Fondasi Infrastruktur"
  2. 5-Layer technical decomposition per feature (Data, Logic, API, Screen Layout, UI States)
  3. Elimination of "combine UI + handler if small" loophole
  4. 1:1 binding to PRD Section 5.3 Pages & Screens
  5. Mandatory 4 UI states per screen: Loading, Empty, Error, Success
  6. Granular subtask technical specifications (file path recommendations, validation rules, HTTP status codes, failure handling)

- [ ] **Step 1: Write the failing test**

Create `src/lib/prompts-task.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { TASK_GENERATION_PROMPT } from "./prompts-task";

describe("TASK_GENERATION_PROMPT", () => {
	it("mandates Phase 0 scaffolding as the first feature group", () => {
		expect(TASK_GENERATION_PROMPT).toContain("FASE 0: INISIALISASI & FONDASI INFRASTRUKTUR");
		expect(TASK_GENERATION_PROMPT).toContain("Scaffolding Repositori & Konfigurasi Environtment");
		expect(TASK_GENERATION_PROMPT).toContain("Koneksi Database");
	});

	it("enforces 5-layer decomposition per feature", () => {
		expect(TASK_GENERATION_PROMPT).toContain("5-LAYER DEKOMPOSISI TEKNIS");
		expect(TASK_GENERATION_PROMPT).toContain("Layer Data & Storage");
		expect(TASK_GENERATION_PROMPT).toContain("Layer Domain & Business Logic");
		expect(TASK_GENERATION_PROMPT).toContain("Layer API & Network Contract");
		expect(TASK_GENERATION_PROMPT).toContain("Layer UI Dedicated Screen");
		expect(TASK_GENERATION_PROMPT).toContain("Layer UI States & Interaction");
	});

	it("strictly forbids merging UI and backend into a single task", () => {
		expect(TASK_GENERATION_PROMPT).toContain("DILARANG menggabungkan backend dan UI ke dalam satu task");
		expect(TASK_GENERATION_PROMPT).not.toContain("Jika satu deliverable kecil memang mencakup UI + handler-nya, biarkan tetap satu task");
	});

	it("mandates 1:1 mapping to PRD Section 5.3 Pages & Screens and 4 UI states", () => {
		expect(TASK_GENERATION_PROMPT).toContain("1:1 MAPPING TERHADAP PAGES & SCREENS");
		expect(TASK_GENERATION_PROMPT).toContain("4 STATE WAJIB");
		expect(TASK_GENERATION_PROMPT).toContain("Loading State");
		expect(TASK_GENERATION_PROMPT).toContain("Empty State");
		expect(TASK_GENERATION_PROMPT).toContain("Error State");
		expect(TASK_GENERATION_PROMPT).toContain("Success State");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/prompts-task.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `src/lib/prompts-task.ts`**

In `src/lib/prompts-task.ts`, update `TASK_GENERATION_PROMPT` to incorporate:
- Mandatory Phase 0 feature group: `"Inisialisasi & Fondasi Infrastruktur"` with tasks for Scaffolding, DB/Migrations, Base Shell/Routing, and Testing Harness.
- Strict 5-layer breakdown per functional feature group.
- Removal of the single-task loophole.
- Mandatory 1:1 mapping of PRD 5.3 screens into `surfaces`.
- Mandatory 4-state subtask breakdown (Loading skeleton, Empty view with CTA, Error toast/banner with retry, Success view).
- Subtask detail requirements: specific module/file paths, input validation constraints, exact HTTP response codes (`200`, `201`, `400`, `404`, `422`), and failure handling.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/prompts-task.test.ts`
Expected: PASS.

- [ ] **Step 5: Run existing task tests**

Run: `pnpm exec vitest run src/lib/services/task-generation.test.ts src/lib/services/task-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/prompts-task.ts src/lib/prompts-task.test.ts
git commit -m "feat(prompt): enforce 5-layer breakdown, Phase 0 scaffolding, and 4 UI states in task prompt"
```

---

### Task 3: Implement Pure Navbar Top-Up Visibility Helper & Tests

**Files:**
- Create: `src/components/layout/navbar-topup-helper.ts`
- Test: `src/components/layout/navbar-topup-helper.test.ts`

**Interfaces:**
- Consumes: user session, plan string, `topUpEligible` boolean
- Produces: `canShowNavbarTopUp(input: NavbarTopUpInput): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/components/layout/navbar-topup-helper.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { canShowNavbarTopUp } from "./navbar-topup-helper";

describe("canShowNavbarTopUp", () => {
	it("returns false when user is not authenticated", () => {
		expect(
			canShowNavbarTopUp({
				user: null,
				plan: "pro",
				topUpEligible: true,
			}),
		).toBe(false);
	});

	it("returns false for free plan users", () => {
		expect(
			canShowNavbarTopUp({
				user: { id: "user-1" },
				plan: "free",
				topUpEligible: false,
			}),
		).toBe(false);
		expect(
			canShowNavbarTopUp({
				user: { id: "user-1" },
				plan: "free",
				topUpEligible: true,
			}),
		).toBe(false);
	});

	it("returns false when topUpEligible is false or undefined", () => {
		expect(
			canShowNavbarTopUp({
				user: { id: "user-1" },
				plan: "pro",
				topUpEligible: false,
			}),
		).toBe(false);
		expect(
			canShowNavbarTopUp({
				user: { id: "user-1" },
				plan: "pro",
				topUpEligible: undefined,
			}),
		).toBe(false);
	});

	it("returns true for paid active subscribers who are topUpEligible", () => {
		expect(
			canShowNavbarTopUp({
				user: { id: "user-1" },
				plan: "pro",
				topUpEligible: true,
			}),
		).toBe(true);
		expect(
			canShowNavbarTopUp({
				user: { id: "user-2" },
				plan: "hengker",
				topUpEligible: true,
			}),
		).toBe(true);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/layout/navbar-topup-helper.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/components/layout/navbar-topup-helper.ts`**

```ts
export interface NavbarTopUpInput {
	user: unknown;
	plan?: string | null;
	topUpEligible?: boolean;
}

export function canShowNavbarTopUp(input: NavbarTopUpInput): boolean {
	if (!input.user) return false;
	if (!input.plan || input.plan === "free") return false;
	return Boolean(input.topUpEligible);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/layout/navbar-topup-helper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/navbar-topup-helper.ts src/components/layout/navbar-topup-helper.test.ts
git commit -m "feat(billing): add pure navbar top-up visibility helper"
```

---

### Task 4: Create Top-Up Modal Component & Tests

**Files:**
- Create: `src/components/billing/top-up-modal.tsx`
- Test: `src/components/billing/top-up-modal.test.tsx`

**Interfaces:**
- Consumes: `@radix-ui/react-dialog`, `TOPUP_SKU` from `@/lib/constants`, `useUserPlan()` from `@/hooks/use-user-plan`, `POST /api/payments/create`
- Produces: `TopUpModal` component:
  - Props: `open: boolean`, `onOpenChange: (open: boolean) => void`
  - Content: Header, current credit balance, `TOPUP_SKU` package (15 credits / Rp 20.000), additive explanation, buy button with loading and error state, Midtrans Snap redirect.

- [ ] **Step 1: Write the failing test**

Create `src/components/billing/top-up-modal.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TopUpModal } from "./top-up-modal";

const mockUseUserPlan = vi.fn();
vi.mock("@/hooks/use-user-plan", () => ({
	useUserPlan: () => mockUseUserPlan(),
}));

describe("TopUpModal", () => {
	beforeEach(() => {
		mockUseUserPlan.mockReturnValue({
			data: {
				credits: 5,
				creditsUsed: 25,
				remaining: 5,
				currentPeriodEnd: "2026-10-01T00:00:00.000Z",
			},
		});
		vi.restoreAllMocks();
	});

	it("renders dialog when open is true with package and price details", () => {
		render(<TopUpModal open={true} onOpenChange={vi.fn()} />);
		expect(screen.getByText("Isi Ulang Kredit")).toBeDefined();
		expect(screen.getByText(/15 Kredit/)).toBeDefined();
		expect(screen.getByText(/20\.000/)).toBeDefined();
		expect(screen.getByRole("button", { name: /Beli 15 Kredit/i })).toBeDefined();
	});

	it("submits checkout to /api/payments/create and handles response", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ redirect_url: "https://app.sandbox.midtrans.com/snap/v2/vtweb/mock" }),
		});
		global.fetch = fetchMock;

		render(<TopUpModal open={true} onOpenChange={vi.fn()} />);
		const buyBtn = screen.getByRole("button", { name: /Beli 15 Kredit/i });
		fireEvent.click(buyBtn);

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(
				"/api/payments/create",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ planId: "topup-15" }),
				}),
			);
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/billing/top-up-modal.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/components/billing/top-up-modal.tsx`**

Implement `TopUpModal` using `@radix-ui/react-dialog`:
- Radix Dialog primitives (`DialogRoot`, `DialogPortal`, `DialogOverlay`, `DialogContent`, `DialogTitle`, `DialogDescription`).
- Display current balance and expiry date.
- Display `TOPUP_SKU` package card (15 kredit, Rp 20.000, penjelasan aditif).
- Action button triggering `POST /api/payments/create` with `{ planId: TOPUP_SKU.id }`.
- Error banner when API fails with user-friendly Indonesian copy.
- Clean styling aligned with `anti-ai-slop.md` (hairline borders, neutral palette, no neon glow).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/billing/top-up-modal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/billing/top-up-modal.tsx src/components/billing/top-up-modal.test.tsx
git commit -m "feat(billing): create TopUpModal dialog component"
```

---

### Task 5: Integrate Top-Up Trigger Button into Navbar

**Files:**
- Modify: `src/components/layout/navbar.tsx`
- Test: `src/components/layout/navbar-integration.test.tsx` (create)

**Interfaces:**
- Consumes: `canShowNavbarTopUp`, `TopUpModal`, `useUserPlan`, `ThemeToggle`
- Produces: Integrated top-up trigger button in `navbar.tsx` beside `<ThemeToggle />` on desktop and mobile viewports.

- [ ] **Step 1: Write the failing test**

Create `src/components/layout/navbar-integration.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { canShowNavbarTopUp } from "./navbar-topup-helper";

describe("Navbar TopUp Integration Contract", () => {
	it("correctly identifies when to mount Top Up button in navbar", () => {
		expect(canShowNavbarTopUp({ user: { id: "u1" }, plan: "pro", topUpEligible: true })).toBe(true);
		expect(canShowNavbarTopUp({ user: { id: "u1" }, plan: "free", topUpEligible: false })).toBe(false);
	});
});
```

- [ ] **Step 2: Update `src/components/layout/navbar.tsx`**

1. Import `TopUpModal` from `@/components/billing/top-up-modal`.
2. Import `canShowNavbarTopUp` from `@/components/layout/navbar-topup-helper`.
3. Read `planData` from `useUserPlan()`.
4. Add state `const [isTopUpOpen, setIsTopUpOpen] = useState(false);`.
5. In desktop navbar (beside `<ThemeToggle />`):
   ```tsx
   {canShowNavbarTopUp({ user, plan: planData?.plan, topUpEligible: planData?.topUpEligible }) && (
     <button
       type="button"
       onClick={() => setIsTopUpOpen(true)}
       className="flex h-8 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20"
     >
       <CreditCard size={13} aria-hidden />
       <span>Top Up</span>
     </button>
   )}
   <ThemeToggle />
   ```
6. In mobile menu (beside `<ThemeToggle />`), add the same trigger button.
7. Render `<TopUpModal open={isTopUpOpen} onOpenChange={setIsTopUpOpen} />` at the end of Navbar.

- [ ] **Step 3: Run tests and typecheck**

Run:
```bash
pnpm exec vitest run src/components/layout/navbar-topup-helper.test.ts src/components/layout/navbar-integration.test.tsx src/components/billing/top-up-modal.test.tsx
pnpm exec tsc --noEmit
```
Expected: PASS with 0 errors.

- [ ] **Step 4: Run touched-files Biome check**

Run: `pnpm exec biome check src/components/layout/navbar.tsx src/components/layout/navbar-topup-helper.ts src/components/billing/top-up-modal.tsx`
Expected: Clean, no diagnostics.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/navbar.tsx src/components/layout/navbar-integration.test.tsx
git commit -m "feat(navbar): integrate top-up button beside theme toggle and mount TopUpModal"
```

---

### Task 6: Full Verification, Bypass Scan & Production Build

**Files:**
- Verify: Full codebase

- [ ] **Step 1: Run the full test suite**

Run: `pnpm exec vitest run --maxWorkers=1`
Expected: 118+ test files, 1,060+ tests passing.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Biome check touched files**

Run:
```bash
pnpm exec biome check src/lib/prompt-depth.ts src/lib/prompt-depth.test.ts src/lib/prompts-task.ts src/lib/prompts-task.test.ts src/components/layout/navbar.tsx src/components/layout/navbar-topup-helper.ts src/components/layout/navbar-topup-helper.test.ts src/components/layout/navbar-integration.test.tsx src/components/billing/top-up-modal.tsx src/components/billing/top-up-modal.test.tsx
```
Expected: 0 errors.

- [ ] **Step 4: Type bypass scan**

Run:
```bash
git diff origin/main..HEAD -- 'src/' | Select-String -Pattern "as never|as any|\bas any\b|: any|@ts-ignore|@ts-expect-error|as unknown as"
```
Expected: No output.

- [ ] **Step 5: Production build**

Run: `pnpm build`
Expected: Build succeeds for client and SSR environments.

- [ ] **Step 6: Update progress ledger**

Record completed tasks in `.superpowers/sdd/2026-09-23-codebase-checkpoint/progress.md`.
