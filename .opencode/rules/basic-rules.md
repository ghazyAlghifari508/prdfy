# AGENTS.md

Boot instructions for AI agents working on **PRDFY**.

## Read first

- `AGENTS.md` -> repository-wide product, architecture, phase, and safety rules
- `.opencode/rules/prdfy-context.md` -> product definition, architecture, and locked stack
- `.opencode/rules/no-assumptions.md` -> strict fact verification and zero assumptions
- `.opencode/rules/no-hardcode.md` -> configuration, provider, and constants discipline
- `.opencode/rules/no-type-bypass.md` -> strict type safety (`as never`, `as any`, and `@ts-ignore` are forbidden)
- `.opencode/rules/anti-ai-slop.md` -> PRDFY design constraints and UI standards
- `.opencode/rules/anti-satisficing.md` -> completeness, quality, and verification discipline; never stop at the first acceptable implementation
- `docs/` and `TODO.md` -> behavior, scope, acceptance, test plan, and architecture specs

If documents disagree, use the most specific approved requirement and document the decision before changing code. Once implementation exists, actual source, package manifests, migrations, and runtime configuration are evidence of current behavior.

---

## What makes PRDFY special

PRDFY is an AI-powered product development workspace that turns product ideas
into complete, professional PRDs (8 sections), acceptance criteria (AC), task trees,
and interactive Kanban boards. Four non-negotiables:

1. **Real generation pipeline:** Question flow, PRD generation, AC breakdown,
   task tree generation, and Kanban tracking must come from real system signals,
   proper SSE streams, and persisted records. Never fake progress, typewriter deltas,
   or provider output.
2. **Safe, atomic credit and data flow:** 1 credit = 1 generate action (revisions
   are free and unlimited). Credit burning must be atomic (`WHERE creditsUsed < credits`).
   Database queries strictly enforce tenant isolation (`WHERE user_id = ?`).
3. **100% type-safe and robust:** Zero type-safety bypasses (`as never`, `as any`,
   `@ts-ignore`) are allowed. Strict Drizzle schema types, typed server routes,
   and Zod validation protect every trust boundary.
4. **Restrained developer-grade aesthetic:** PRD document, sections, markdown,
   Mermaid diagrams, and Kanban boards lead the hierarchy. The UI follows the clean,
   content-first, high-utility design contract without cheap AI slop.

---

## Rules — god-tier

- **THE UNBREAKABLE BAR (NEVER LOWER THE TEST STANDARD):** When a test fails,
  fix the production code and elevate the logic. NEVER soften assertions (for
  example, replacing specific equality with loose `.toBeDefined()`), never delete
  or comment out valid boundary tests, and never write shallow pass-through tests
  just to get a cheap green check. If a test caught a break, fix the root cause.
- **NEVER TEST AI PROSE, RAW MEDIA CONTENT, CLASSNAMES, OR STOCHASTIC OUTPUT:**
  Unit and TDD tests MUST NOT assert generated copy, exact prompt responses,
  exact markdown wording, exact className strings, Tailwind utility lists, HTML tag
  structures, palette hues, fonts, layout structure, card counts, section
  sequences, or generated source snapshots. Tests assert deterministic mechanical
  invariants only:
  1. JSON Schemas and Zod validation;
  2. state-machine and structure conformance, data types, and required keys;
  3. type narrowing, ownership (`WHERE user_id = ?`), and contract error handling;
  4. hard deterministic boundaries such as step monotonic progression (`projects.step`),
     credit deduction, route topology, state transitions, output verification,
     security, compilation, and idempotency.
  Rendered aesthetic quality and copy appeal belong to human evaluation and live
  browser reviews.
- **Domain before file type:** Organize by feature or domain first (`src/components/prd`,
  `src/components/ac`, `src/components/task`, `src/components/kanban`, `src/components/chat`,
  `src/lib/services`). Never create generic catch-all directories such as `hooks/`, `utils/`,
  `helpers/`, or `misc/` without a documented boundary.
- **Structured test suites:** Unit tests sit in `tests/` or alongside feature files
  (`*.test.ts`, `*.test.tsx`), API/security tests at their API boundary, and end-to-end
  user journeys in `e2e/`. Follow the repository's actual Vitest and Playwright scripts.
- **No `any`, `as never`, or `@ts-ignore`:** `any` and `never` casting disables
  the type-checker. Use `unknown` with narrowing, Drizzle `$inferInsert` / `$inferSelect`,
  typed DTOs, or schema validation. Fix actual root causes.
- **Self-explanatory code over comments:** Code must be obvious through clear
  names and modular structure. Never write multi-line block comments or banner
  dividers (`// ---`). Authored comments delete by default; keep only strictly
  necessary single-line invariant explanations.
- **Solid as hell:** Nothing ships without typecheck, lint, format, affected
  tests, and required build checks passing together. Run the repository's `pnpm`
  verification commands locally before handoff.
- **Small and surgical:** One concern per change. A 50-line fix beats a 500-line
  refactor.
- **FAIL LOUD AND NEVER HIDE STATE:** Validate untrusted input at server
  boundaries and fail closed on auth, ownership, credit deduction, rate limiting,
  provider output, and state transition failures.
- **Always unslop:** Follow `.opencode/rules/anti-ai-slop.md` across code, prompt
  strings, docs, and UI copy. Cut AI filler words, puffery, and passive voice.
- **Native tool calling only:** When executing actions or tools, always invoke the
  native tool calling schema provided by the platform. Never emit simulated XML,
  markdown, or pseudo-code tags such as `<skill>` or `<invoke>` into the message
  body instead of executing the tool directly.

---

## Where code lives

- `src/routes/` — TanStack Router file-based UI routes and server API route handlers (`/api/*`, `/api/v1/*`)
- `src/components/` — Feature-grouped UI components:
  - `prd/` — PRD viewer, version history, table of contents, diff viewer, Mermaid rendering
  - `ac/` — Acceptance criteria viewer and detail
  - `task/` — Task tree, implementation options, whiteboard canvas, zoom controls
  - `kanban/` — Kanban board, columns, cards, feature groups
  - `chat/` — Streaming chat panel, chat bubbles, typing indicators, modals
  - `ask/` — Guided question flow
  - `settings/` — Profile, account, API keys, notifications, feedback
  - `auth/` — Login form, onboarding form
  - `layout/` — App layout, navbar, footer, hero, flow step navigation
  - `ui/` — Base design system primitives (shadcn / Radix)
  - `admin/` — Admin dashboard and metric cards
  - `codebase/` — Codebase review and sync modals
- `src/db/` — Drizzle ORM schema (`schema.ts`), PostgreSQL connection client, and migrations
- `src/lib/` — Auth (Better Auth), constants, session, rate-limiting, credit gate, model configuration, prompts
- `src/lib/services/` — Business logic and orchestration (`ai-orchestrator`, `chat-service`, `prd-service`, `ac-service`, `task-service`, `payment-service`)
- `src/store/` — Zustand in-memory state stores (`useAuthStore`, `useChatStore`, `useUIStore`)
- `src/types/` — Shared domain types (`database.ts`)
- `src/hooks/` — Specialized hooks (`use-kanban-polling`, `use-canvas-zoom`, `use-panel-resize`, `use-user-plan`)
- `e2e/` — Playwright end-to-end test suites
- `docs/` — Specifications, architecture, plans, and technical documentation

This is target organization, not permission to assume these paths already exist.
Map the actual repository before modifying it.

---

## Commands

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm format
pnpm check
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

Run exact scripts from `package.json` once it exists. `pnpm dev` is a long-lived
managed service. Migration, browser smoke, provider sandbox, and test verification
commands must be read from package manifests and active documentation rather than invented.
