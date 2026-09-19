# PRDFY - Core Engineering Standards & Basic Rules

> **Boot instructions and engineering invariants for AI agents working on PRDFY.**
>
> Mandatory companion rules:
> - `.opencode/rules/prdfy-context.md` -> Product definition, architecture, and tech stack
> - `.opencode/rules/no-assumptions.md` -> Fact verification, zero assumptions, skills/MCP registry
> - `.opencode/rules/no-hardcode.md` -> Configuration, secrets, real indicators, wrappers
> - `.opencode/rules/no-type-bypass.md` -> Strict type safety (`as never`, `as any`, `@ts-ignore` are forbidden)
> - `.opencode/rules/anti-satisficing.md` -> Completeness, quality, and verification discipline
> - `.opencode/rules/anti-ai-slop.md` -> UI visual standards, component discovery, and design constraints

---

## 1. Golden Engineering Rules

### 1.1 The Unbreakable Bar (Never Lower the Test Standard)
When a test fails, fix the production code and elevate the logic.
- **NEVER** soften assertions (for example, replacing specific equality checks with loose `.toBeDefined()`).
- **NEVER** delete or comment out valid boundary tests.
- **NEVER** write shallow pass-through tests just to get a cheap green check.
- If a test caught a break, find and fix the root cause.

### 1.2 Never Test AI Prose, ClassNames, or Stochastic Output
Unit and TDD tests MUST NOT assert generated AI copy, exact prompt responses, exact className strings, Tailwind utility lists, HTML tag structures, or generated text snapshots.
Tests assert deterministic mechanical invariants only:
1. JSON Schemas and Zod validation at trust boundaries;
2. State-machine transitions and structure conformance, data types, and required keys;
3. Step monotonic progression (`question` -> `prd` -> `ac` -> `task`);
4. Atomic credit consumption and balance limits;
5. Type narrowing, ownership checks (`WHERE user_id = ?`), and error handling;
6. Hard deterministic boundaries such as route topology, idempotency, security, and compilation.

Rendered aesthetic quality and copy appeal belong to human evaluation and live browser reviews.

### 1.3 Fail Loud and Never Hide State
Validate untrusted input at server boundaries and fail closed on:
- Authentication & session validity;
- Project ownership checks;
- Credit deduction and plan permissions;
- Rate limits;
- External provider output (AI model stream / Midtrans webhook).

Never silently swallow errors or return fake success when a critical operation fails.

### 1.4 Self-Explanatory Code over Comments
Code must be obvious through clear names and modular structure.
- Never write multi-line block comments or decorative banner dividers (`// ---`).
- Authored comments should be minimal; keep only strictly necessary single-line invariant explanations (e.g. `// cast boundary: ...` or rationale for non-obvious workarounds).
- Never describe changes to the user through code comments.

### 1.5 Small and Surgical
One concern per change. A 50-line focused fix beats a 500-line wide refactor. Do not touch unrelated files or refactor code that is outside the scope of the active task.

### 1.6 Native Tool Calling Only
When executing actions or tools, always invoke the native tool calling schema provided by the platform. Never emit simulated XML, markdown, or pseudo-code tags such as `<skill>` or `<invoke>` into the message body instead of executing the tool directly.

---

## 2. PRDFY Architectural Invariants

Every change in PRDFY must respect these non-negotiable architectural invariants:

1. **Step Monotonicity:** `projects.step` only advances in one direction:
   `question` -> `prd` -> `ac` -> `task`. It never goes backward.
2. **Append-Only Versioning:** PRD and AC versions are immutable records (`prd_versions`, `ac_versions`). Never mutate an existing version row; always insert a new version record.
3. **Credit Gate Atomicity:** 1 credit = 1 generate action (PRD, AC, Task). Revisions via chat are free and unlimited. Credit burning must be atomic using `WHERE creditsUsed < credits` to prevent race conditions.
4. **Server-Only Dynamic Imports:** Dependencies like `db`, `auth`, and `pg` MUST be dynamically imported inside route handlers (`const { db } = await import("@/db")`), NEVER imported at the module top level. This keeps server-only dependencies out of the client bundle.
5. **Tenant Isolation (No RLS):** PRDFY uses application-level tenant isolation. Every query touching user or project data MUST explicitly filter by `user_id` / ownership.
6. **Revision Patch Protocol:** Revisions use `:::UPDATE_SECTION[Name]::: ... :::END_UPDATE:::` blocks merged server-side into current content, NEVER rewriting the entire 8-section document.
7. **Bahasa Indonesia Copy:** All user-facing UI copy, prompts, instructions, and error messages must be in clean Bahasa Indonesia without unnaturally translating standard technical terms.

---

## 3. Verification Commands

Before claiming any task is complete, run the project's standard verification suite:

```bash
# Type-check
pnpm typecheck

# Lint and format check
pnpm lint

# Unit tests
pnpm test

# Build smoke test
pnpm build
```

Nothing ships without typecheck, lint, and relevant tests passing together.
