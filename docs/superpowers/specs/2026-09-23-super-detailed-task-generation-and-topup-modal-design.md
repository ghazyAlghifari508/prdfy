# Super-Detailed Task Generation Protocol & Navbar Top-Up Modal — Design Spec

**Date:** 2026-09-23  
**Status:** In Review — awaiting user review  
**Scope:**
1. **Super-Detailed Task Generation Protocol:** Enhancing PRDFY's task generation engine (`src/lib/prompts-task.ts`, `src/lib/prompt-depth.ts`) to produce microscopic, 5-layer engineering task trees with mandatory Phase 0 infrastructure scaffolding, 1:1 mapping to PRD Section 5.3 Pages & Screens, mandatory 4 UI states per screen, zero scope reduction/merging, and 100% strict adherence to Acceptance Criteria (zero invented features).
2. **Navbar Credit Top-Up Modal:** Providing a dedicated, accessible credit top-up modal and navbar trigger button beside the dark/light mode toggle for active subscribers (`plan !== "free"`, `topUpEligible === true`), leveraging the existing Midtrans payment backend and `TOPUP_SKU`.

**Tech Stack:** TanStack Start, React 19, Radix UI Dialog, Tailwind CSS 4, Drizzle ORM, Better Auth, Midtrans Snap, Vitest, Biome, TypeScript strict. **No new runtime dependencies.**

---

## 1. Goal & Success Criteria

### Part A: Super-Detailed Task Generation
- **Problem:** Currently, when generating task trees for complex or enterprise products (such as OpenTelemetry distributed observability), the LLM aggregates implementation deliverables into only ~16 coarse-grained cards. This compression happens because the prompt allows merging frontend and backend, omits scaffolding, and doesn't explicitly enforce breaking down each Acceptance Criterion across architectural layers. When handed off to an autonomous AI agent, coarse-grained tasks induce satisficing, missing UI pages, and abandoned edge cases.
- **Goal:** Transform task generation into an exhaustive, multi-tier engineering blueprint where every feature is broken down into modular, independently testable deliverables across 5 technical layers (Data/Storage, Service Logic, API/Network Boundary, Dedicated Screen Layout, and UI States/Interaction), preceded by Phase 0 Project Scaffolding, while strictly bounded by Acceptance Criteria (0% invented features, 0% dropped requirements).
- **Success Criteria:**
  - Tasks generated for standard to enterprise products scale proportionally to 30–50+ granular, high-utility cards with 100+ subtask steps.
  - Phase 0 (Infrastructure, Environment, Database Connection, Router Shell, Test Harness) is present in every generated tree.
  - Every surface listed in PRD Section 5.3 (*Pages & Screens*) has at least one dedicated UI task with mandatory coverage for Loading Shimmer, Empty State, Error Recovery, and Active Interaction.
  - 100% of Acceptance Criteria IDs are covered; server validation rejects any invented AC ID or unlisted surface name.

### Part B: Navbar Credit Top-Up Modal
- **Problem:** Subscribed users whose credits run out in the middle of a billing period currently have no direct top-up trigger in the main navigation. The existing top-up card is mounted on `/pricing` or inside the credit-exhausted modal when an action is blocked. Users who want to top up proactively must either navigate to pricing or wait until an operation fails.
- **Goal:** Expose an elegant, high-contrast Top-Up trigger button in the main Navbar right beside `<ThemeToggle />`, opening a focused Top-Up Dialog Modal that initiates Midtrans Snap checkout for the existing `topup-15` SKU (15 credits / Rp 20.000).
- **Success Criteria:**
  - The trigger button renders beside the dark/light mode toggle on desktop (and inside the mobile header/sheet) only when the user is logged in, has an active paid plan, and `topUpEligible === true`.
  - Clicking the trigger opens a modal dialog explaining credit additionality, price, and current quota.
  - Clicking "Top Up Sekarang" calls `POST /api/payments/create` with `{ planId: "topup-15" }` and redirects to Midtrans Snap or opens the payment gateway.
  - Dialog handles loading, errors, and cancellation cleanly with no regressions in existing payment reconciliation.

---

## 2. Global Constraints & Rule Adherence (`AGENTS.md`)

- **Strict AC Bounding:** Tasks MUST strictly cover existing Acceptance Criteria. DONT invent arbitrary features, external services, or unrequested database tables.
- **Zero Type Bypasses:** No `any`, `as never`, `@ts-ignore`, or `as unknown as` anywhere in implementation or tests.
- **No Hardcoding:** Pricing, SKU identifiers, quota caps, and rate limits MUST use existing constants (`TOPUP_SKU` in `src/lib/constants.ts`).
- **Anti-AI-Slop & UI Standards (`anti-ai-slop.md`):**
  - Hairline 1px borders (`border-[#d3d3d3]` / `border-graphite`).
  - No 3D heavy drop shadows, neon gradients, or nested pill buttons.
  - Monochromatic SVG icons (Lucide React) sized 16px.
  - User-facing copy in clear, professional Bahasa Indonesia with English technical terms.
- **Audit Immobility:** No mutations to financial accounting tables (`credit_operations`, `credit_ledger_entries`).

---

## 3. Part A: Super-Detailed Task Generation Architecture

### 3.1 Structural Phase & Layer Taxonomy
Task generation prompt in `src/lib/prompts-task.ts` is restructured to mandate two structural tiers:

#### Tier 1: Phase 0 — Inisialisasi & Fondasi Infrastruktur (Mandatory Foundation)
Every generated project MUST begin with a dedicated feature group: `"Inisialisasi & Fondasi Infrastruktur"` consisting of:
1. **Scaffolding Repositori & Konfigurasi Environtment:** Setup package layout, folder structure matching PRD Section 6.3, and `.env.example` / `.env.local` containing all necessary variable placeholders.
2. **Koneksi Database, Klien Query & Migration Runner:** Inisialisasi pool connection database, DDL migration setup, dan healthcheck ping.
3. **Application Shell, Base Router & Error Boundaries:** Setup layout global (Header, Sidebar, Navigation), provider theme/query, dan root error recovery boundary.
4. **Testing Harness & Mocking Baseline:** Setup test runner (Vitest/Jest/Go test) dan contract test fixture helpers.

#### Tier 2: 5-Layer Engineering Breakdown (Per Fitur AC)
For every functional feature group defined in the Acceptance Criteria, the LLM is forbidden from creating combined "fullstack" tasks. Each feature must be decomposed across:
1. **Layer Data & Storage:**
   - DDL migration/schema, field types, primary/foreign keys, indices, and database constraints.
2. **Layer Domain & Business Logic:**
   - Pure service functions, calculation formulas, validation rules, state-machine transitions, and domain error typing.
3. **Layer API & Network Contract:**
   - HTTP/REST or gRPC endpoints, route handlers, request validation (Zod/structs), response schemas, HTTP status codes (`200`, `201`, `400`, `404`, `422`), authentication & rate-limiting middleware.
4. **Layer Dedicated Screen Layout (PRD Section 5.3):**
   - Halaman khusus yang terdaftar di PRD Section 5.3, sub-routing, breadcrumbs, dan grid layout.
5. **Layer UI States & Interactive Controls (Anti-Lazy UI):**
   - Komponen interaktif (form, modal, table, drawer), tombol aksi, dan **4 state wajib**:
     - *Loading State*: Skeleton shimmer layout matching content geometry.
     - *Empty State*: Tampilan kosong dengan instruksi jelas dan tombol aksi (CTA).
     - *Error State*: Banner/toast error kontekstual dengan tombol coba lagi (*Retry*).
     - *Success State*: Visualisasi data penuh, feedback notifikasi sukses, dan auto-sync.
6. **Layer Unit & Integration Testing:**
   - Unit tests covering deterministic business logic and contract mocks.

### 3.2 1:1 Mapping to PRD Section 5.3 (*Pages & Screens*)
- The generator prompt will explicitly extract and require:
  - Every screen name in PRD Section 5.3 must appear in the `surfaces` field of at least one dedicated UI task.
  - Prohibit merging multiple distinct screens into a single generic task.
  - Prohibit inventing screen names not present in the PRD.

### 3.3 Prompt & Directive Updates
1. **`src/lib/prompts-task.ts`:**
   - Rewrite `TASK_GENERATION_PROMPT` to enforce the Phase 0 requirement, the 5-layer decomposition rules, explicit elimination of the "combine UI + handler if small" loophole, and mandatory 4-state subtask breakdown.
2. **`src/lib/prompt-depth.ts`:**
   - Update `TASK` depth directive to state that for projects of all sizes, deliverables must never be compressed into surface-level cards; granular component and failure-state breakdown is mandatory.

---

## 4. Part B: Navbar Top-Up Modal Architecture

### 4.1 Trigger Placement in Navbar (`src/components/layout/navbar.tsx`)
- Placed immediately adjacent to `<ThemeToggle />` on desktop and in mobile navigation.
- Accessible label: `Top Up Kredit`.
- Visual style: High-utility pill button with a credit coin / spark icon, subtle border `border-white/10`, hover highlight `hover:bg-white/10`, and text `text-xs font-semibold text-snow`.
- **Visibility Guard:**
  ```ts
  const { data: planData } = useUserPlan();
  const canShowTopUp = Boolean(
    user &&
    planData?.plan !== "free" &&
    planData?.topUpEligible
  );
  ```

### 4.2 Top-Up Modal Component (`src/components/billing/top-up-modal.tsx`)
- Radix UI Dialog component (`@radix-ui/react-dialog`) with keyboard focus management and Escape to close.
- **Content:**
  - Title: *"Isi Ulang Kredit"* with description: *"Tambahkan kuota kredit instan untuk akun aktif kamu tanpa mengubah periode langganan."*
  - Current Balance Info: Menampilkan sisa kredit saat ini dan tanggal akhir periode berjalan.
  - Package Details Card:
    - Paket: **15 Kredit PRDFY**
    - Harga: **Rp 20.000** (Rp 1.333 / kredit)
    - Keterangan: *Kredit bersifat aditif (ditambahkan ke saldo berjalan), tidak memperpanjang masa aktif, dan hangus bersama di akhir periode langganan.*
  - Action Button: *"Beli 15 Kredit — Rp 20.000"*.
  - Execution Flow:
    1. Clicking calls `fetch("/api/payments/create", { method: "POST", body: JSON.stringify({ planId: "topup-15" }) })`.
    2. Shows spinner / disabled button while pending.
    3. On success, redirects to `redirect_url` (Midtrans Snap checkout).
    4. On error, displays safe Indonesian error message inside the modal.

---

## 5. Verification & Testing Strategy

1. **Task Generation Tests:**
   - `src/lib/prompts-task.test.ts`: Verify that `TASK_GENERATION_PROMPT` includes Phase 0 scaffolding rules, 5-layer decomposition rules, 4-state UI mandates, and strictly forbids merging distinct screens.
   - `src/lib/prompt-depth.test.ts`: Verify that `depthDirective("task")` mandates uncompressed structural depth.
   - `src/lib/services/task-generation.test.ts`: Verify that prompt assembly properly combines PRD context, AC markdown, and layered directives.
2. **Top-Up Navbar & Modal Tests:**
   - `src/components/billing/top-up-modal.test.tsx`: Verify dialog rendering, package price display, checkout submission, error states, and accessibility attributes.
   - `src/components/layout/navbar.test.tsx`: Verify top-up button visibility based on user authentication, plan tier (`free` vs `pro`), and `topUpEligible`.
3. **Regression Tests:**
   - Run `pnpm exec vitest run` across all test files.
   - Run `pnpm exec tsc --noEmit` and `pnpm exec biome check` on all touched files.
   - Full production build: `pnpm build`.
