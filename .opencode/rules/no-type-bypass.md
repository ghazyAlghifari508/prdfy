# PRDFY - No Type-Safety Bypass Rules

## Core Principle

**NEVER use a type assertion, suppression comment, or loose type to make
`pnpm typecheck` or `pnpm exec tsc --noEmit` pass when the real fix is to model the types correctly.**

Typecheck with zero errors is not a goal in itself. It is verification that types
are sound. Silencing the compiler fakes the gate, hides schema/provider/API
drift until runtime, and makes the codebase harder to maintain.

**NEVER choose the fast/loose path because a phase gate is watching.** A correct
phase models real types; it does not merely compile while lying to the compiler.

---

## Rule 1: Forbidden Type Bypass Patterns

The following are **FORBIDDEN** anywhere in application code and tests, except
explicit file exemptions in Rule 3:

| Forbidden pattern | Why it's wrong | You must instead |
|---|---|---|
| `as never` / `as unknown as never` | Casts a runtime value to bottom type | Model the real type |
| `as any`, `: any`, `as unknown as any` | Drops all checking | Real type or narrowing |
| `as unknown as SomeType` | Bypasses structural checking | Fix source mismatch |
| unrelated `as string` / `as Response` | Hides a real mismatch | Union/generic/narrowing |
| `@ts-ignore`, `@ts-expect-error` | Suppresses the cause | Fix API/type mismatch |
| lint suppression for type defects | Hides defects | Model the actual contract |
| `as unknown as Record<string, unknown>` then field access | Fabricates error/provider/DB shape | Project-owned typed type |
| `(values({...}) as never)` | Hides every schema field mismatch | `$inferInsert` and schema |

---

## Rule 2: Fix The Real Type - Correct Patterns

### 2.1 Drizzle row/schema types

Use Drizzle inference so insert/select are checked against the actual schema:

```typescript
import { projects } from '@/db/schema'

type NewProject = typeof projects.$inferInsert

const project: NewProject = {
  name: 'My Project',
  userId,
  step: 'prd',
  status: 'active',
}
```

For JSON columns, declare the real shape via `$type()` in schema rather than
casting editor instructions, metadata, or subtasks at insertion time.

### 2.2 API and provider contracts

Type server route request/response schemas and use Zod parsing for unknown payloads.
Provider adapters should return project-owned typed results; routes should not
cast raw 9router, OpenAI, Resend, or Midtrans payloads.

### 2.3 Third-party library APIs

If an SDK type does not accept an argument, check the CURRENT API via Context7 or
official docs. If the library type is genuinely broken, keep a cast minimal,
single-level, and commented under Rule 4 - never use `as never`.

### 2.4 Errors with status/code

Define one project-owned typed error instead of fabricating fields on casts:

```typescript
class AppError extends Error {
  constructor(
    message: string,
    readonly status = 500,
    readonly code = 'INTERNAL_ERROR',
    readonly retryable = false,
  ) {
    super(message)
  }
}
```

### 2.5 Unknown payloads

Parse/validate `JSON.parse`, AI output, webhook bodies (Midtrans), SSE
chunks, and provider responses with Zod or targeted type
guards. Do not convert `unknown` into a broad fake record.

---

## Rule 3: Allowed Narrow Exceptions Only

These are permitted only when justified, and each occurrence must carry an inline
comment explaining the boundary:

1. Generated/infra files may be exempt from application scanning when the
   generator requires it, but they are not exempt from sanity checks.
2. Test files may use a minimal cast when mocking a strict third-party SDK, but
   prefer typed `vi.fn()` responses and contract fixtures first.
3. A documented legacy lint suppression may remain only for the exact legacy case;
   it may not silence new `noExplicitAny` or schema defects.

Everything outside these bullets stays forbidden.

---

## Rule 4: When A Cast Is Genuinely Unavoidable - Standard Form

If a typed SDK boundary genuinely cannot type-check, verify current docs first and
use the narrowest single-level shape:

```typescript
// cast boundary: third-party provider stream lacks the runtime body type
const body = value as ArrayBufferView
```

Rules for every permitted cast:

1. Prefer narrowing/is-a-check first: `Buffer.isBuffer(x)`, `'content' in row`,
   or `Array.isArray(value)`.
2. Prefer `satisfies` or typed variable annotations before `as`.
3. Cast a narrow local value, never a whole function argument, DB insert,
   provider payload, or state object.
4. Add a comment starting with `// cast boundary:` and name the boundary.
5. If you find yourself writing `as unknown as X`, redesign instead.

---

## Rule 5: Gate Verification - Compiler Honesty Is Checked

`pnpm exec tsc --noEmit` alone is not proof. Every phase gate must also run a bypass scan
against actual application roots:

```bash
rg -n "as never|as any|\bas any\b|: any|@ts-ignore|@ts-expect-error|as unknown as" src
```

Expected result for new application code is **no output**, outside explicitly
documented generated files or narrow test/external-boundary cases.

Self-review before claiming completion:

- [ ] Every type in changed files is modeled; no value flows through `any`/`never`
  or an unexplained `unknown` bypass.
- [ ] Drizzle inserts/selects use `$inferInsert`/`$inferSelect` or typed schema
  values.
- [ ] API errors, generation steps, provider responses, webhooks, and
  metadata have real typed contracts.
- [ ] No suppression comments were introduced.
- [ ] `pnpm exec tsc --noEmit` passes because types are correct, verified by the bypass
  scan and relevant tests.

---

## Anti-Patterns

| Anti-Pattern | Why It's Wrong | Correct Behavior |
|---|---|---|
| `as never` to silence a job/provider mismatch | Hides runtime contract defect | Model typed adapter result |
| `values({...} as never)` on Drizzle insert | Blinds schema changes | Schema inference |
| Cast raw webhook/provider object to `Record` | Fabricates trust | Zod parse + typed DTO |
| `@ts-ignore` to ship quickly | Hides dependency/API drift | Verify current API and fix |
| Broad cast around server function args | Can hide invalid input | Typed schema validator |
| Lint suppression for newly introduced `any` | Adds untrusted type hole | Model real input |

---

## Summary

1. Typecheck is a safety rail, not a checkbox.
2. `as never`/`as any`/`as unknown as X`/`@ts-ignore`/`@ts-expect-error` are
   forbidden except narrow documented boundaries.
3. Fix the real type using Drizzle inference, typed API/provider contracts,
   project errors, and runtime parsing.
4. Every phase gate scans for bypasses, not just typecheck output.
5. Speed comes from sound types, not silencing the check that catches defects.
