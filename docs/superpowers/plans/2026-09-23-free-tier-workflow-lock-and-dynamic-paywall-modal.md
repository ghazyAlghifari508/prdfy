# Free Tier Full-Workflow Lock & Dynamic Paywall/Top-Up Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strictly prevent free-tier users from accessing or executing downstream workflows (AC, Task, Kanban) by redirecting URL tampering attempts to `/prd/$id`, transforming "Generate AC" into an "Upgrade" trigger that opens an in-place modal, and restructuring `CreditExhaustedModal` to dynamically toggle between a top-up package view and a subscription pricing view.

**Architecture:**
1. **Server Route Gates (Anti-URL Tampering):**
   - Add `hasFullWorkflow(plan)` checks to `loadAc` (`/ac/$id`), `loadTask` (`/task/$id`), and `loadKanban` (`/kanban/$id`).
   - If a free user visits these routes directly, the server loader redirects them to `/prd/$id?paywall=ac` (or respective stage).
   - In `POST /api/projects/$id/step`, reject step advancement to `ac` or `task` for free users with HTTP 403 `UPGRADE_REQUIRED`.
2. **UI Workflow Paywall & Trigger:**
   - On `/prd/$id` (Navbar and bottom banner in `prd-detail.tsx`), replace external `/pricing` links with an in-place modal trigger for free users.
   - `useUIStore` manages `paywallModal` state so any surface can open the modal in paywall/upgrade mode.
3. **Dynamic View-Switching Modal (`CreditExhaustedModal`):**
   - Provide an in-place view switcher (`view: "topup" | "subscription"`).
   - If user is on `free` tier or opening for feature paywall: default view is `"subscription"`.
   - If user is on an active paid plan with exhausted credits: default view is `"topup"` with packages (15, 40, 90 credits), plus an upsell banner to switch to `"subscription"`.
   - In `"subscription"` view, active subscribers see a "Kembali ke Pilihan Top Up" button to switch back.

**Tech Stack:** TanStack Start, TanStack Router, React 19, Radix UI Dialog, Tailwind CSS 4, Drizzle ORM, Midtrans Snap, Vitest, Biome.

**Spec / Directives:**
- `AGENTS.md` (no assumptions, no type bypasses, no hardcoding, anti-ai-slop, honest completion)
- `prdfy-context.md` (Free tier is PRD-only; Pro/Hengker have full workflow)

## Global Constraints

- Zero Type Bypasses: No `as any`, `as never`, `@ts-ignore`, or `as unknown as`.
- No Hardcoding: Use `hasFullWorkflow(plan)` from `@/lib/credits` and `TOPUP_PACKAGES` from `@/lib/constants`.
- Anti-AI-Slop & UI Standards: Clean developer-console tokens, hairline 1px borders, no neon glows, Indonesian copy with English technical terms.
- Tests: Test-Driven Development (TDD) — write failing test first, verify failure, implement minimal code, verify green.

---

### Task 1: Protect Project Step Transition API Against Free Tier

**Files:**
- Modify: `src/routes/api/projects/$id/step.ts`
- Test: `src/routes/api/projects/-step-workflow.test.ts` (create)

**Interfaces:**
- Consumes: `hasFullWorkflow(plan: Plan): boolean` from `@/lib/credits`
- Produces: HTTP 403 `UPGRADE_REQUIRED` when a free user requests `step: "ac"` or `step: "task"`

- [ ] **Step 1: Write the failing test**

Create `src/routes/api/projects/-step-workflow.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { hasFullWorkflow } from "@/lib/credits";

describe("Workflow step permission gate", () => {
	it("denies full workflow for free tier", () => {
		expect(hasFullWorkflow("free")).toBe(false);
	});

	it("allows full workflow for pro and hengker tiers", () => {
		expect(hasFullWorkflow("pro")).toBe(true);
		expect(hasFullWorkflow("hengker")).toBe(true);
	});
});
```

- [ ] **Step 2: Update `src/routes/api/projects/$id/step.ts`**

In `src/routes/api/projects/$id/step.ts`, before advancing step:
```ts
if (step === "ac" || step === "task") {
	const { getUserPlanAndQuota } = await import("@/lib/session");
	const { hasFullWorkflow } = await import("@/lib/credits");
	const { plan } = await getUserPlanAndQuota();
	if (!hasFullWorkflow(plan)) {
		return Response.json(
			{
				error: "Tahap ini hanya tersedia di paket Pro dan Hengker.",
				code: "UPGRADE_REQUIRED",
			},
			{ status: 403 },
		);
	}
}
```

- [ ] **Step 3: Run tests and typecheck**

Run:
```bash
pnpm exec vitest run src/routes/api/projects/-step-workflow.test.ts
pnpm exec tsc --noEmit
```
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/projects/$id/step.ts src/routes/api/projects/-step-workflow.test.ts
git commit -m "feat(api): gate project step advancement to Pro and Hengker plans"
```

---

### Task 2: Protect Downstream Route Loaders Against URL Tampering

**Files:**
- Modify: `src/routes/ac/$id.tsx`
- Modify: `src/routes/task/$id.tsx`
- Modify: `src/routes/kanban/$id.tsx`
- Modify: `src/routes/prd/$id.tsx` (add `paywall?: string` to `validateSearch`)
- Test: `src/routes/ac/-ac-loader.test.ts` (create)

**Interfaces:**
- Consumes: `hasFullWorkflow` from `@/lib/credits`
- Produces: Server-side redirect for free-tier users attempting to access `/ac/$id`, `/task/$id`, or `/kanban/$id` to `/prd/$id?paywall=<stage>`

- [ ] **Step 1: Write the failing test**

Create `src/routes/ac/-ac-loader.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { hasFullWorkflow } from "@/lib/credits";

export function decideWorkflowRouteAccess(plan: "free" | "pro" | "hengker"): {
	allow: boolean;
	redirectTo?: string;
} {
	if (!hasFullWorkflow(plan)) {
		return { allow: false, redirectTo: "/prd/$id" };
	}
	return { allow: true };
}

describe("decideWorkflowRouteAccess", () => {
	it("blocks free users and redirects to PRD", () => {
		expect(decideWorkflowRouteAccess("free")).toEqual({
			allow: false,
			redirectTo: "/prd/$id",
		});
	});

	it("allows pro and hengker users", () => {
		expect(decideWorkflowRouteAccess("pro")).toEqual({ allow: true });
		expect(decideWorkflowRouteAccess("hengker")).toEqual({ allow: true });
	});
});
```

- [ ] **Step 2: Update route loaders**

1. In `src/routes/prd/$id.tsx`:
Add `paywall?: string` to `validateSearch`:
```ts
if (typeof search.paywall === "string") result.paywall = search.paywall;
```

2. In `src/routes/ac/$id.tsx`:
In `loadAc`:
```ts
const { hasFullWorkflow } = await import("@/lib/credits");
if (!hasFullWorkflow(plan)) {
	throw redirect({
		to: "/prd/$id",
		params: { id },
		search: { paywall: "ac" },
	});
}
```

3. In `src/routes/task/$id.tsx`:
In `loadTask`:
```ts
const { getUserPlanAndQuota } = await import("@/lib/session");
const { hasFullWorkflow } = await import("@/lib/credits");
const { plan } = await getUserPlanAndQuota();
if (!hasFullWorkflow(plan)) {
	throw redirect({
		to: "/prd/$id",
		params: { id },
		search: { paywall: "task" },
	});
}
```

4. In `src/routes/kanban/$id.tsx`:
In `loadKanban`:
```ts
const { getUserPlanAndQuota } = await import("@/lib/session");
const { hasFullWorkflow } = await import("@/lib/credits");
const { plan } = await getUserPlanAndQuota();
if (!hasFullWorkflow(plan)) {
	throw redirect({
		to: "/prd/$id",
		params: { id },
		search: { paywall: "kanban" },
	});
}
```

- [ ] **Step 3: Run route generation, tests and typecheck**

Run:
```bash
pnpm generate-routes
pnpm exec vitest run src/routes/ac/-ac-loader.test.ts
pnpm exec tsc --noEmit
```
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/ac/$id.tsx src/routes/task/$id.tsx src/routes/kanban/$id.tsx src/routes/prd/$id.tsx src/routeTree.gen.ts src/routes/ac/-ac-loader.test.ts
git commit -m "feat(routes): redirect free users away from AC/Task/Kanban to PRD with paywall"
```

---

### Task 3: Add Paywall Modal State to UI Store & Connect PRD

**Files:**
- Modify: `src/store/index.ts`
- Modify: `src/components/prd/prd-detail.tsx`
- Test: `src/store/ui-store.test.ts` (create or extend)

**Interfaces:**
- Consumes: `useUIStore`
- Produces: `isPaywallOpen: boolean`, `paywallStage?: string`, `openPaywallModal(stage?: string): void`, `closePaywallModal(): void`

- [ ] **Step 1: Write the failing test**

Create `src/store/ui-store.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { useUIStore } from "./index";

describe("useUIStore paywall modal actions", () => {
	it("opens and closes paywall modal with stage", () => {
		useUIStore.getState().openPaywallModal("ac");
		expect(useUIStore.getState().isPaywallOpen).toBe(true);
		expect(useUIStore.getState().paywallStage).toBe("ac");

		useUIStore.getState().closePaywallModal();
		expect(useUIStore.getState().isPaywallOpen).toBe(false);
	});
});
```

- [ ] **Step 2: Update `src/store/index.ts`**

Add paywall state & actions to `UIState`:
```ts
interface UIState {
	// ... existing
	isPaywallOpen: boolean;
	paywallStage: string | null;
	openPaywallModal: (stage?: string) => void;
	closePaywallModal: () => void;
}
```

Implement in `useUIStore`:
```ts
isPaywallOpen: false,
paywallStage: null,
openPaywallModal: (stage = "ac") => set({ isPaywallOpen: true, paywallStage: stage }),
closePaywallModal: () => set({ isPaywallOpen: false, paywallStage: null }),
```

- [ ] **Step 3: Update `src/components/prd/prd-detail.tsx`**

1. Listen to `search.paywall`: if `paywall === "ac"`, call `openPaywallModal("ac")`.
2. Connect `openPaywallModal` to bottom banner "Upgrade ke Pro" button.
3. Wire `CreditExhaustedModal` to open when `creditsExhausted?.stage === "prd" || isPaywallOpen`.

- [ ] **Step 4: Run tests and typecheck**

Run:
```bash
pnpm exec vitest run src/store/ui-store.test.ts
pnpm exec tsc --noEmit
```
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/store/index.ts src/store/ui-store.test.ts src/components/prd/prd-detail.tsx
git commit -m "feat(ui): add centralized paywall modal state and connect PRD paywall triggers"
```

---

### Task 4: Transform CreditExhaustedModal into Dynamic TopUp / Subscription Switcher

**Files:**
- Modify: `src/components/chat/credit-exhausted-modal.tsx`
- Test: `src/components/chat/credit-exhausted-modal.test.tsx`

**Interfaces:**
- Consumes: `useUserPlan`, `TOPUP_PACKAGES`, `PricingComponent`
- Produces: Modal with state `view: "topup" | "subscription"`
  - For free users or paywall mode: defaults to `"subscription"` view.
  - For paid users with credit exhaustion: defaults to `"topup"` view with package selector + upsell banner to `"subscription"`.
  - In `"subscription"` view: contains back button to `"topup"` if user is `topUpEligible`.

- [ ] **Step 1: Write the failing test**

In `src/components/chat/credit-exhausted-modal.test.tsx`:
Add tests:
```tsx
it("renders subscription view directly for free plan users", () => {
	mockUseUserPlan.mockReturnValue({
		data: { plan: "free", topUpEligible: false },
	});
	render(
		<CreditExhaustedModal
			isOpen={true}
			onClose={vi.fn()}
			errorMessage="Kredit habis"
			projectId="p1"
			stage="prd"
			currentPlan="free"
		/>
	);
	expect(screen.getByText("Berlangganan Pro")).toBeDefined();
});

it("renders topup view first for paid subscribers and allows switching to subscription view", () => {
	mockUseUserPlan.mockReturnValue({
		data: { plan: "pro", topUpEligible: true, credits: 30, remaining: 0 },
	});
	render(
		<CreditExhaustedModal
			isOpen={true}
			onClose={vi.fn()}
			errorMessage="Kredit habis"
			projectId="p1"
			stage="prd"
			currentPlan="pro"
		/>
	);
	expect(screen.getByText("Isi Ulang Kredit Instan")).toBeDefined();
	const switchBtn = screen.getByText(/Lihat Paket Langganan/i);
	fireEvent.click(switchBtn);
	expect(screen.getByText("Berlangganan Pro")).toBeDefined();
});
```

- [ ] **Step 2: Update `src/components/chat/credit-exhausted-modal.tsx`**

1. Define `view: "topup" | "subscription"`.
2. Determine default view:
   `const isPaidTopUp = plan !== "free" && planData?.topUpEligible && !title.toLowerCase().includes("pro");`
   `const [view, setView] = useState<"topup" | "subscription">(() => isPaidTopUp ? "topup" : "subscription");`
3. In `"topup"` view:
   - Render package selector with radio cards (`TOPUP_PACKAGES`: 15, 40, 90 credits).
   - Display upsell banner:
     ```tsx
     <button
       type="button"
       onClick={() => setView("subscription")}
       className="w-full text-left rounded-xl border border-graphite bg-charcoal/60 p-3.5 hover:border-fog/40 hover:bg-white/[0.03] transition flex items-center justify-between"
     >
       <div>
         <span className="text-xs font-semibold text-snow">Mau kuota lebih banyak & fitur lengkap?</span>
         <p className="text-[11px] text-fog mt-0.5">Mulai Rp 49.000/bulan untuk 30 kredit, full AC, Task & Kanban.</p>
       </div>
       <span className="flex items-center gap-1 font-mono text-xs text-snow font-medium">
         Lihat Paket Langganan -&gt;
       </span>
     </button>
     ```
   - Buy button with `POST /api/payments/create` for selected package.
4. In `"subscription"` view:
   - If `isPaidTopUp`, render back button: `"<- Kembali ke Pilihan Top Up"`.
   - Render `PricingComponent` in compact mode.

- [ ] **Step 3: Run tests and typecheck**

Run:
```bash
pnpm exec vitest run src/components/chat/credit-exhausted-modal.test.tsx
pnpm exec tsc --noEmit
```
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/credit-exhausted-modal.tsx src/components/chat/credit-exhausted-modal.test.tsx
git commit -m "feat(billing): support dynamic top-up and subscription view switching in CreditExhaustedModal"
```

---

### Task 5: Update Navbar Action Button for Free Users & Verification

**Files:**
- Modify: `src/components/layout/navbar.tsx`
- Test: `src/components/layout/navbar-integration.test.tsx`

**Interfaces:**
- Consumes: `useUIStore.openPaywallModal`, `isFree`
- Produces: Navbar button that triggers `openPaywallModal("ac")` instead of navigating to `/pricing` when on `/prd/$id` as a free user.

- [ ] **Step 1: Update `src/components/layout/navbar.tsx`**

In `src/components/layout/navbar.tsx`:
When `routeStep === "prd"` and `isFree`:
Replace `<Link to="/pricing">` with:
```tsx
<button
	type="button"
	onClick={() => useUIStore.getState().openPaywallModal("ac")}
	className="btn-primary flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-[510] transition-all hover:brightness-105 active:scale-[0.98]"
>
	<Lock size={12} className="text-amber-400" />
	<span className="whitespace-nowrap">Upgrade ke Pro</span>
	<ArrowRight size={12} />
</button>
```

- [ ] **Step 2: Run verification**

Run:
```bash
pnpm exec vitest run src/components/layout/navbar-integration.test.tsx
pnpm exec tsc --noEmit
pnpm exec biome check src/components/layout/navbar.tsx
```
Expected: PASS with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/navbar.tsx src/components/layout/navbar-integration.test.tsx
git commit -m "feat(navbar): trigger paywall modal when free user clicks Upgrade on PRD step"
```

---

### Task 6: Full Verification, Bypass Scan & Production Build

**Files:**
- Verify: Full codebase

- [ ] **Step 1: Full test suite**

Run: `pnpm exec vitest run --maxWorkers=2`
Expected: 120+ test files, 1070+ tests passing.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Biome check touched files**

Run: `pnpm exec biome check src/`
Expected: Clean on touched files.

- [ ] **Step 4: Type bypass scan**

Run:
```bash
git diff origin/main..HEAD -- 'src/' ':!src/routeTree.gen.ts' | Select-String -Pattern "as never|as any|\bas any\b|: any|@ts-ignore|@ts-expect-error|as unknown as"
```
Expected: No output.

- [ ] **Step 5: Production build**

Run: `pnpm build`
Expected: Build succeeds.
