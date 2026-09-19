# PRDFY - Skills, MCP & Plugins Rules (MANDATORY)

> **Source of truth:** `AGENTS.md` + `docs/` + `.opencode/rules/*` (locked stack and scope).
> This rule defines which skills, MCPs, and plugins are relevant to
> PRDFY, when to invoke them, and how to keep the boundary. Do not
> hardcode providers, models, credit policy, or credentials; do not bypass a
> skill gate.

---

## 1. Mandatory Skill Principles

1. **Invoke a skill BEFORE any action** - including asking a clarifying
   question, exploring the codebase, and reading files. If a skill is
   relevant, or there is even a 1% chance it is relevant, it MUST be
   invoked.
2. **Process skills first, implementation skills after** - `brainstorming` ->
   `writing-plans` -> `dispatching-parallel-agents`/`executing-plans` -> then
   the domain/UI implementation skill.
3. **Do not rationalize skipping** - thoughts like "this is simple", "I need
   context first", or "let me explore first" mean STOP and check the skill
   list first.
4. **One phase = one spec + one plan + one review gate** - write the spec per
   feature owner, review if needed, make a plan, execute, then verify.
5. **Follow phase order** - do not use a skill to enable a future phase's
   feature early.

---

## 2. UI Component Discovery and Reuse

1. Before building a custom UI component, you must search and evaluate
   ready-made solutions that already exist.
2. Discovery order:
   - components already present in the repository;
   - `shadcn/ui` and its official registry;
   - `21st.dev`;
   - HeroUI;
   - Magic UI;
   - other relevant registries that have been verified.
3. Use `shadcn-component-discovery` before building a table, form, modal,
   sidebar, dashboard control, tabs, carousel, chart, animation, or standard
   UI pattern.
4. A chosen component must be evaluated against:
   - React 19, TanStack Start, TypeScript strict, and Tailwind CSS 4
     compatibility;
   - accessibility, semantic HTML, keyboard navigation, and focus management;
   - SSR or client-only behavior that fits the route consumer;
   - dependency, license, bundle impact, maintenance, and security;
   - customizability using `DESIGN.md` tokens and visual language.
5. After choosing a component, take only the component or primitive that is
   needed. Do not copy a full landing page, dashboard, layout, or page
   template when the requirement only needs one component.
6. Modify the component through props, composition, variants, tokens, and
   the necessary styling. Preserve the accessibility behavior of the
   original primitive.
7. Build a custom component only if discovery yields no sufficiently fitting
   solution, or the domain behavior is genuinely unique. The reason for a
   custom implementation must be recorded in the plan or task documentation.
8. `DESIGN.md` only defines color, typography/font, spacing, radius, border,
   shadow, layout language, motion, and visual tone as a reference. Component
   examples or instructions inside it are not automatic requirements.
9. Do not choose a component just because it looks nice. Reuse must produce
   UI that fits the requirement, not add features or layout that were not
   asked for.

---

## 3. Mandatory/Relevant Skills for PRDFY

| Skill                                 | When Mandatory/Relevant                                 | PRDFY Example                                                                          |
| ------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `brainstorming`                       | Before designing/spec'ing a new feature or subsystem    | Ask flow, PRD streaming, AC generation, task tree, Kanban, Billing                     |
| `writing-plans`                       | After an architectural design/spec is approved          | Plan migration, chat service, pipeline orchestration, billing top-up                   |
| `executing-plans`                     | When executing a plan in batches with checkpoints       | Executing several feature tasks in sequence                                            |
| `subagent-driven-development`         | When executing a plan task-by-task with review          | DB, auth, chat streaming, or Kanban tasks that can be reviewed separately             |
| `systematic-debugging`                | Before fixing a bug or unexpected behavior              | Stream interruption, section patch merge failure, polling sync, credit deduction error |
| `verification-before-completion`      | Before claiming Done                                    | Typecheck/lint/test/build + browser/security evidence                                  |
| `full-output-enforcement`             | When a deliverable asks for complete output             | Do not replace files, lists, or audit results with a placeholder/truncation            |
| `dispatching-parallel-agents`         | When 2+ independent tasks share no state                | Parallel docs audit with static rule audit; not for file conflicts                     |
| `using-git-worktrees`                 | Before executing a plan that needs isolation            | Major feature branch when the workflow calls for a worktree                            |
| `finishing-a-development-branch`      | When a branch is done and needs an integration decision | Inspect status/diff, then merge/PR only when asked                                     |
| `test-driven-development`             | Before implementing new behavior or a bugfix            | Step transition, credit deduction, atomic burn, section update patch merge             |
| `context7-mcp`                        | When using a library/framework/SDK/cloud API            | TanStack Start, Router, Better Auth, Drizzle, AI SDK, Midtrans, Resend                 |
| `tanstack-start-best-practices`       | TanStack Start SSR, server functions, runtime           | Route loading, selective SSR, server functions, dynamic DB imports                     |
| `tanstack-router-best-practices`      | File route, loader, search, navigation                  | `/`, `/ask/$id`, `/prd/$id`, `/ac/$id`, `/task/$id`, `/kanban/$id`                     |
| `tanstack-query-best-practices`       | Server state/cache/mutation                             | Project list, Kanban polling synchronization, version history                          |
| `better-auth-authentication`          | Google + GitHub OAuth/session flow                      | Login, callback, logout, protected route loader                                        |
| `better-auth-security-best-practices` | Auth hardening                                          | Cookie, CSRF, trusted origins, expiry, rate limit                                      |
| `drizzle`                             | Drizzle schema/query/migration/type                     | PostgreSQL 17 schema, tenant isolation (`WHERE user_id = ?`), atomic credit burn       |
| `tailwind-4-docs`                     | Tailwind CSS 4 tokens/utilities                         | Clean design system tokens and responsive UI                                           |
| `ui-design-system`                    | shadcn/ui, Radix, accessibility                         | PrdViewer, TableOfContents, KanbanBoard, ChatPanel, Dialog                             |
| `shadcn-component-discovery`          | Before a custom table/form/modal/popover/tabs           | Search the component registry before building a custom control                         |
| `vercel-react-best-practices`         | React rendering/performance work                        | Streaming chat panel, typewriter animation, large Kanban canvas                        |
| `webapp-testing`                      | E2E, responsive, console, browser flow                  | End-to-end user generation journey, Kanban drag-and-drop                               |
| `playwright-best-practices`           | Writing/debugging Playwright                            | Accessibility, API/browser, no arbitrary sleep, trace cleanup                          |
| `web-design-guidelines`               | Reviewing UI against interface/accessibility guidelines | Audit a UI route/component against an explicit file or pattern                         |
| `frontend-design`                     | Designing new UI or reshaping visuals                   | Deciding visual direction, type, layout, motion, and self-critique before implementing |
| `antislop`                            | Anti-AI-slop core filter: 38 rules, Delivery Gate report| Apply core filter across UI, text, and code to eliminate cheap AI tells                |
| `antislop-ui`                         | UI/visual filter without generic AI slop                | Layout, color, components, decoration, motion, structure for PRDFY surfaces             |
| `antislop-copywriting`                | Anti-AI writing, copy, headlines, CTAs, tone            | Indonesian UI copy, PRD templates, marketing copy without fluff or fake statistics     |
| `antislop-human`                      | Human accessibility and contrast validation             | Color contrast checking, keyboard traps, focus visible, interactive state clarity      |
| `antislop-layoutmobile`               | Responsive layout & mobile adaptation                   | Seamless reflow across 320px to 1440px without horizontal scroll, mobile tap targets   |
| `antislop-code`                       | Code comments cleanup and hygiene                       | Eliminate generic AI comments, box banners, and clutter without touching actual code   |
| `ai-sdk`                              | Vercel AI SDK v7 streaming, tool calling, structures    | `streamText`, SSE streaming chunks, model fallback chains                             |
| `9router`                             | 9router gateway/provider adapter                        | Model discovery, OpenAI-compatible request, key handling, retry/error classification   |
| `integrate-midtrans-payments`         | Billing/Midtrans operation                              | Snap token creation, signature verification, webhook handler, settlement idempotency   |
| `document-pdf`                        | PDF generation/parsing and export                       | PRD export to PDF and bundle archive creation                                          |

Skills listed above as installed have been verified via `npx skills list -g`
and the local `SKILL.md` file. A skill that has not been verified must not be
treated as available. A global install from the CLI may print a warning that
PromptScript does not support global install; the evidence that matters for
OpenCode is the skill path and OpenCode's status in the install output.

---

## 4. Connected MCPs and Their Limits

| MCP                  | When                                                              | PRDFY Example                                                               |
| -------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `context7`           | Before using a version-sensitive library/framework/SDK/cloud API  | Query TanStack Start, TanStack Router, Drizzle, Better Auth, AI SDK, Midtrans|
| `chrome-devtools`    | Debugging UI, progress, streaming, console/network, screenshot    | Check responsive dashboard, chat streaming, typewriter, console error       |
| `sequentialthinking` | Complex debugging, architecture, multi-step planning              | Deep analysis before choosing architecture or refactoring pipeline          |

Connection status at the time this rule was audited: `context7`, `chrome-devtools`,
and `sequentialthinking` are available as harness tools. Provider-specific MCP
resources and resource templates are empty, so there is no evidence of a
connected Midtrans or 9router MCP.

---

## 5. Non-MCP Provider/API and Tooling

| Tool                      | For What                               | Rule                                                                                                            |
| ------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| PostgreSQL / Drizzle      | Relational database system of record   | Use Drizzle ORM client inside server handlers; tenant queries must filter `WHERE user_id = ?`                   |
| Better Auth               | OAuth and session provider             | Use server-side Better Auth primitives; secrets stay server-only                                                |
| 9router                   | OpenAI-compatible AI gateway/API       | Use the `9router` / `ai-sdk` integration; model discovery/configuration is server-side, do not hardcode model ID |
| Midtrans                  | Payment API/webhook provider           | Use `integrate-midtrans-payments`; signature, amount, currency, ordering, and idempotency are mandatory         |
| Resend                    | Transactional email service            | Keep API keys server-only; handle webhook events with signature verification                                    |
| Additional provider skill | Provider replacement or new capability | Proposal + architecture/phase approval first                                                                    |

Install rule: a skill already approved and verified in section 2 may be used.
Do not install a new dependency, MCP, plugin, or provider integration without
a proposal and user approval when it is not already present. Do not install a
future phase's feature dependency early. Installing an agent skill is not the
same as installing an application runtime dependency.

---

## 6. Plugins

| Plugin        | Status                             | For                                                         |
| ------------- | ---------------------------------- | ----------------------------------------------------------- |
| `superpowers` | Available, mandatory when relevant | Brainstorming, planning, execution, debugging, verification |
| `find-skills` | Available                          | Searching for a skill genuinely needed, then proposing it   |

Do not act as if a plugin is available when it has not been verified by the
harness.

---

## 7. Example PRDFY Combinations per Feature / Flow

- **Flow 01 Landing & Auth:** `better-auth-authentication` + `better-auth-security-best-practices` ->
  OAuth login (Google/GitHub), session creation, safe redirect, and protected route check.
- **Flow 02 Guided Question Flow (Ask):** `tanstack-router-best-practices` +
  `tanstack-query-best-practices` + TDD -> interactive questions, options generation, prompt compilation.
- **Flow 03 PRD Generation & Streaming:** `ai-sdk` + `9router` + `context7` ->
  SSE streaming (`started` -> `thinking` -> `delta` -> `done`), typewriter reveal for reasoning models,
  atomic credit burn (`consumeCredit`).
- **Flow 04 PRD Revision (Chat Panel):** `systematic-debugging` + TDD ->
  `:::UPDATE_SECTION[Name]:::` patch protocol, live client patching, regex merge, unlimited free revisions.
- **Flow 05 AC Generation:** `tanstack-query-best-practices` + `ai-sdk` + TDD ->
  step monotonic advancement (`step = 'ac'`), acceptance criteria markdown generation, 1 credit burn.
- **Flow 06 Task Breakdown & Kanban Board:** `shadcn-component-discovery` -> evaluate ready-made
  components from the repository, shadcn/ui, 21st.dev, HeroUI, or Magic UI -> `ui-design-system` +
  `webapp-testing` -> flat task table with JSON subtask tree, drag-and-drop, 10s polling reconciliation.
- **Flow 07 Billing & Midtrans:** `integrate-midtrans-payments` + security/TDD ->
  Snap token creation, SHA512 signature verification, atomic credit top-up, settlement idempotency.
- **Flow 08 Export & Sharing:** `document-pdf` + `context7` ->
  markdown/PDF export, JSZip bundle, public read-only share token (`/prd/share/$token`).
- **Flow 09 Hardening & Hard Mode:** `better-auth-security-best-practices` +
  `vercel-react-best-practices` + `webapp-testing` +
  `verification-before-completion` -> tenant security, performance, CI verification.

---

## 8. Prohibited

- FORBIDDEN to hardcode an API endpoint, model ID, credit limit, retry policy,
  provider key, Midtrans rule, or deployment URL inside a component/route.
- FORBIDDEN to call the database, 9router API key, Midtrans server key, or
  Better Auth secret directly from the browser.
- FORBIDDEN to fake generation progress, fake reasoning typewriter deltas, or
  fake Kanban task states.
- FORBIDDEN `shadow-xl`, neon, emoji, gradient slop, or UI that violates
  `DESIGN.md` / `anti-ai-slop.md`.
- FORBIDDEN to run a long-lived server without a readiness check and process cleanup.
- FORBIDDEN to bypass a test, authorization (`WHERE user_id = ?`), schema validation,
  or idempotency check just because a feature appears to work on the happy path.

---

## 9. How to Use These Rules

1. Before working on a feature, read `AGENTS.md`, `docs/`, `prdfy-context.md`,
   and the relevant rules.
2. Classify a spike/bounded/architectural task via `brainstorming` before
   asking a question or changing code, when that skill is relevant.
3. For architectural work, write/review the spec then use `writing-plans`;
   for bounded work, follow the approval gate per the process skill.
4. When a library/framework/API is needed, invoke `context7` or read the
   current official docs before writing code.
5. When touching a DB/provider/generation/payment boundary, add security,
   ownership, failure, retry, and idempotency verification.
6. Before building a custom component, record the discovery result and the
   reason a ready-made solution was insufficient, when there genuinely was
   no fitting candidate.
7. Before claiming completion, use `verification-before-completion` and
   state the command evidence that actually produced output.
