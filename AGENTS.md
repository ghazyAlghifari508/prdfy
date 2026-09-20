# PRDFY AGENTS.md — Mandatory Execution Contract

> **Status: MANDATORY**
>
> This file is the execution contract for every AI agent, coding agent, reviewer, and subagent working on PRDFY.
>
> It does **not** replace the detailed rule files. It adds an enforcement layer so the detailed rules are not merely read and then forgotten.
>
> A task is not acceptable just because the result works. The reasoning process, implementation choices, scope, UX, types, configuration, verification, and completion claim must all comply with the applicable PRDFY rules.

---

## 1. Mandatory Rule Sources

Before doing project work, fully load and obey all of these files:

```
C:/Coding/Web Development/Tanstack-start/prdfy/.agents/rules/anti-ai-slop.md
C:/Coding/Web Development/Tanstack-start/prdfy/.agents/rules/anti-satisficing.md
C:/Coding/Web Development/Tanstack-start/prdfy/.agents/rules/basic-rules.md
C:/Coding/Web Development/Tanstack-start/prdfy/.agents/rules/no-assumptions.md
C:/Coding/Web Development/Tanstack-start/prdfy/.agents/rules/no-hardcode.md
C:/Coding/Web Development/Tanstack-start/prdfy/.agents/rules/no-type-bypass.md
C:/Coding/Web Development/Tanstack-start/prdfy/.agents/rules/prdfy-context.md
C:/Coding/Web Development/Tanstack-start/prdfy/.agents/rules/skills-mcp.md
```

These files form one rule system.

Do not weaken them into vague summaries such as:

- "follow best practices"
- "use clean code"
- "avoid AI slop"
- "be careful with assumptions"
- "keep the rules in mind"

Each file has its own scope, requirements, prohibitions, exceptions, and verification rules.

---

## 2. Precedence and Conflict Handling

If instructions appear to conflict:

1. Re-read the exact conflicting text.
2. Use the most specific approved requirement, as required by the repository rules.
3. Treat actual source code, package manifests, migrations, runtime configuration, and persisted data as evidence of current behavior where the project rules say they are authoritative.
4. Do not silently choose the easier interpretation.
5. If the conflict materially changes the implementation and cannot be resolved from approved sources, stop and surface the conflict before changing code.

A later task prompt does **not** silently waive these rules.

A rule is waived only if the user explicitly changes or overrides that rule.

Silence is not a waiver.

---

## 3. Skill/MCP Gate Comes Before Action

Before any action, first apply `skills-mcp.md`.

This includes actions that may look harmless:

- asking a clarifying question;
- browsing files;
- exploring the repository;
- reading implementation code;
- brainstorming;
- proposing architecture;
- giving a recommendation;
- debugging;
- editing code;
- running browser QA;
- reviewing UI.

If a relevant skill has even the relevance threshold defined by `skills-mcp.md`, invoke it through the native skill mechanism before proceeding.

Do not skip a skill because:

- the task looks small;
- the answer seems obvious;
- "I only need context first";
- invoking it adds work;
- the model already knows the framework;
- or a direct implementation feels faster.

If a required skill/MCP is unavailable:

- state that fact;
- use only an allowed verified fallback;
- never pretend the tool was invoked.

---

## 4. Full Rule Ingestion Is a Hard Gate

All mandatory rule files must be read from first line through actual EOF.

### Forbidden substitutes

Do not treat any of these as a full read:

- preview;
- summary;
- grep result;
- semantic search result;
- first N lines;
- headings only;
- "relevant sections";
- cached memory from an earlier session;
- prior conversation summaries;
- assuming the remainder from the filename;
- assuming a successful file-read call returned the complete file.

### Truncation protection

For every mandatory rule file:

1. Determine the actual line count.
2. Read from line 1 forward.
3. If one response may truncate, read sequential contiguous chunks.
4. Track exact covered ranges.
5. Continue until the last line / EOF.
6. Verify coverage is continuous from `1 -> final line`.
7. If output truncates, resume from the first unread line.

Example of valid coverage:

```
1-150
151-300
301-417
```

Invalid:

```
1-150
201-300
301-417
```

Invalid:

```
1-200
output truncated
"looks complete"
```

Do not claim successful ingestion unless continuous coverage and EOF were actually verified.

---

## 5. Reading Is Not Compliance

Reading the rules does not satisfy the rules.

The rules are **runtime execution constraints**.

They must actively affect:

- task classification;
- skill selection;
- repository investigation;
- factual claims;
- brainstorming;
- recommendations;
- scope decisions;
- architecture;
- implementation;
- UI decisions;
- copywriting;
- type modeling;
- configuration;
- error handling;
- testing;
- browser QA;
- git workflow;
- verification;
- completion language.

If an applicable rule produces no observable constraint on the work, re-check whether it was actually applied.

---

## 6. Mandatory Runtime Pipeline for Every Task

Never jump directly from a user request to an implementation idea.

Use this execution sequence:

```
Request
→ classify task
→ identify applicable rules
→ invoke required skill/MCP
→ gather evidence
→ inspect actual code/data flow
→ determine complete scope
→ identify relevant states and consumers
→ search existing solutions
→ compare meaningful alternatives when a real trade-off exists
→ reject non-compliant options
→ select the most correct option
→ pre-implementation compliance gate
→ implement
→ verify
→ browser/runtime QA where required
→ final rule audit
→ completion status based on evidence
```

Skipping a required phase because it feels unnecessary is itself non-compliance.

---

## 7. Evidence Gate: No Assumptions

Do not make claims about PRDFY from model memory, convention, filenames, screenshots alone, or typical framework behavior.

Before claiming:

- a file does something;
- a function is called somewhere;
- a route behaves a certain way;
- a schema contains a field;
- a type has a shape;
- a feature exists;
- a test exists;
- a dependency is unused;
- something does not exist;
- a bug has a particular cause;

verify it with the actual repository and the tools required by `no-assumptions.md`.

### Absence claims

Negative claims are high risk.

Do not say that something "does not exist", "is not implemented", or "has no dependency" after one or two searches.

Follow the full absence-search protocol from `no-assumptions.md`.

If evidence is incomplete, state the uncertainty instead of converting it into confidence.

---

## 8. Deep Audit Before Implementation

Before changing code:

- read the actual target implementation;
- read important callers and consumers;
- inspect imports and dependencies;
- trace the flow end-to-end;
- identify the real source of truth;
- inspect related schemas/types/config;
- find existing patterns for similar behavior;
- determine affected files;
- identify regression risk;
- identify relevant tests;
- identify runtime/browser verification needed.

Do not patch only the file the user mentioned if the actual behavior spans more files.

Do not treat the screenshot as the architecture.

---

## 9. Anti-Satisficing Decision Gate

A functional solution is not automatically the correct solution.

Never choose an option because it is:

- fastest;
- shortest;
- easiest to type;
- easiest to test;
- easiest to explain;
- fewer files;
- fewer tokens;
- less investigation;
- less refactoring;
- less unfamiliar code;
- more convenient for the agent.

Implementation effort is a trade-off, not a hidden decision criterion.

### Equal-effort counterfactual — mandatory

Before any recommendation or material implementation decision, ask:

> If every viable option required exactly the same implementation effort, would I still choose this option?

If **no**:

- reject it as convenience-biased.

If **uncertain**:

- gather more evidence.

Do not resolve uncertainty by selecting the easiest path.

---

## 10. No Convenience-Based Scope Reduction

Never shrink the real requirement because the complete solution requires:

- more files;
- another abstraction;
- schema work;
- migration work;
- more states;
- more tests;
- browser QA;
- deeper investigation;
- a skill/MCP;
- unfamiliar code;
- more implementation time.

Scope may be reduced only for a concrete requirement-grounded reason, such as:

- explicit user scope;
- approved architecture boundary;
- verified phase boundary;
- compatibility constraint;
- security constraint;
- documented product requirement.

Do not use these phrases as substitute reasoning:

- "keep it simple"
- "simpler"
- "MVP"
- "YAGNI"
- "over-engineering"
- "best practice"
- "good enough"
- "for now"

If scope is reduced, state the exact requirement-grounded reason.

---

## 11. First Idea Is a Candidate, Not a Conclusion

When a real trade-off exists:

1. identify meaningful alternatives;
2. inspect evidence for each;
3. compare product, UX, architecture, security, maintainability, and verification consequences;
4. reject options that violate rules;
5. choose only after comparison.

Do not invent fake alternatives just to tick a box.

Do not select an option because it preserves the most existing code or requires the fewest changes unless that is independently the correct product/technical choice.

---

## 12. Requirement-to-Decision Traceability

Every material implementation decision must be traceable through:

```
User requirement
→ verified current behavior
→ applicable rule(s)
→ implementation decision
→ verification evidence
```

A decision must be justified by at least one of:

- explicit user requirement;
- verified repository behavior;
- approved project specification;
- an applicable project rule;
- verified current external documentation when required.

If a decision cannot be traced, treat it as an assumption and investigate it first.

Do not invent requirements to justify a preferred implementation.

---

## 13. Reuse Before Reinventing

Before creating a new:

- component;
- hook;
- utility;
- helper;
- service;
- adapter;
- state abstraction;
- query;
- error model;
- design primitive;
- schema;
- UI pattern;

search the repository and required component registries first.

Read actual existing implementations and their consumers.

Decide whether to:

- reuse directly;
- compose;
- extend;
- or create something genuinely new.

Creating from scratch because understanding existing code takes longer is not acceptable.

For UI work, follow the discovery order and component evaluation rules in `skills-mcp.md`.

---

## 14. Root Cause Over Surface Patch

For bugs, regressions, inconsistent behavior, or broken UX:

- establish the root cause;
- trace the state/data flow;
- reproduce with evidence where possible;
- inspect recent changes when relevant;
- fix the mechanism, not merely the visible symptom;
- add regression protection where appropriate.

Do not:

- special-case one screenshot;
- special-case literal user text;
- hardcode a symptom;
- swallow an error;
- add an arbitrary retry;
- disable validation;
- bypass types;
- weaken tests;
- turn failure into fake success;
- patch UI while the underlying state model remains incorrect.

If root cause is not established, the issue is unresolved.

---

## 15. Complete Behavior Matrix

The happy path is only one row.

For every task, determine which states actually apply, including when relevant:

- initial;
- loading;
- pending;
- disabled;
- empty;
- valid;
- invalid;
- success;
- error;
- retry;
- unauthorized;
- forbidden;
- stale;
- conflict;
- duplicate;
- canceled;
- aborted;
- partial;
- terminal.

Not every task needs every state.

But applicable states must be deliberately determined, not silently omitted.

---

## 16. UI Must Pass the PRDFY Visual Standard

When a task touches UI, "functional" is not the finish line.

Apply `anti-ai-slop.md` materially.

Evaluate:

- composition;
- hierarchy;
- density;
- readability;
- alignment;
- spacing;
- typography;
- responsive behavior;
- accessibility;
- interaction clarity;
- state design;
- component geometry;
- visual consistency;
- actual product context.

Reject both:

- cheap AI slop;
- scared empty wireframe minimalism.

Do not use a generic default layout merely because it is quick.

Do not introduce visual decoration without product purpose.

---

## 17. Copy Must Match Real Behavior

User-facing copy must:

- follow the project language rules;
- preserve technical terminology where appropriate;
- describe actual behavior;
- reflect actual project state;
- avoid generic filler;
- avoid vague corporate language;
- avoid decorative AI phrasing;
- avoid misleading CTAs.

Never let a label imply an action that will not happen.

Copy quality is part of implementation quality, not an afterthought.

---

## 18. No Hardcoding

Apply `no-hardcode.md` before introducing values.

Do not hardcode values that belong to:

- environment;
- provider config;
- URLs;
- credentials;
- IDs;
- limits;
- thresholds;
- timeouts;
- retry rules;
- model IDs;
- business rules;
- feature flags;
- persisted project state;
- data-derived options.

Use the existing source of truth when one exists.

Do not duplicate constants merely because it is faster than finding the existing one.

---

## 19. No Fake Behavior

Never fabricate:

- generation progress;
- reasoning progress;
- processing stages;
- status sequences;
- Kanban state;
- completion percentages;
- provider activity;
- streaming deltas;
- fake loading narration.

Indicators must use real system signals.

If no real signal exists, show one honest neutral state instead of an invented sequence.

---

## 20. Type Safety Is a Hard Gate

Apply `no-type-bypass.md`.

Do not make TypeScript pass by suppressing the real mismatch.

Forbidden except the explicit narrow exceptions defined in that rule file:

```
as never
as any
: any
as unknown as X
@ts-ignore
@ts-expect-error
broad fake Record casts
unrelated assertions hiding structural mismatch
```

Use:

- Drizzle inference;
- Zod/runtime validation;
- narrowing;
- typed DTOs;
- project-owned errors;
- typed provider adapters;
- accurate domain types.

A green typecheck achieved by silencing the compiler is a failed gate.

---

## 21. Security, Ownership, and Real Data Boundaries

Never weaken existing:

- authentication;
- authorization;
- tenant ownership checks;
- `WHERE user_id = ?` boundaries;
- atomic credit behavior;
- idempotency;
- webhook verification;
- validation;
- server/client secret boundaries.

Do not move server secrets or provider credentials into browser code.

Do not use fake data where the task requires real persisted behavior.

---

## 22. Tests Must Remain Honest

Never make a failing valid test easier just to obtain green output.

Do not:

- weaken assertions;
- delete valid boundary tests;
- skip tests;
- comment them out;
- replace deterministic assertions with vague existence checks;
- add shallow tests that merely mirror implementation;
- test stochastic AI prose or styling details where the project explicitly forbids it.

Fix production behavior when a valid deterministic test catches a defect.

---

## 23. No Post-Hoc Rationalization

The correct reasoning order is:

```
evidence
→ constraints
→ alternatives
→ evaluation
→ decision
```

Never:

```
preferred/easiest implementation
→ search for justification
```

Do not choose first and write a rationale afterward.

If evidence is insufficient, gather more.

If the decision truly requires product input, ask the user.

---

## 24. Stop-on-Violation Rule

If at any point you discover that:

- the current plan violates a rule;
- a prior decision used an assumption;
- a shortcut was selected for convenience;
- a required skill/MCP was skipped;
- code was written against an unverified contract;
- verification contradicts the implementation;
- the scope is incomplete;

stop advancing that approach.

Do not preserve a wrong approach because work has already been invested.

**Sunk implementation effort is never a reason to keep a non-compliant solution.**

Correct the approach before continuing.

---

## 25. Pre-Recommendation Gate

Before recommending anything material, verify:

- Relevant skills/MCPs were invoked.
- Evidence was gathered.
- The recommendation is grounded in actual PRDFY context.
- Meaningful alternatives were considered when a real trade-off exists.
- The option is not selected because it is easier for the agent.
- It passes the equal-effort counterfactual.
- Consequences and trade-offs are stated accurately.
- No product quality is silently sacrificed.
- Applicable project rules are satisfied.

If any applicable item fails, do not present the recommendation yet.

---

## 26. Pre-Implementation Gate

Immediately before modifying implementation code, verify:

- Full mandatory rules were ingested.
- Required process/domain skills were invoked.
- Relevant implementation files were inspected.
- Important callers/consumers were inspected.
- Current behavior is evidence-backed.
- Complete scope is understood.
- Relevant states are identified.
- Existing reusable solutions were searched.
- Meaningful alternatives were evaluated where needed.
- The chosen approach passes the equal-effort test.
- No scope was reduced for agent convenience.
- No hardcoded shortcut is being introduced.
- No type bypass is planned.
- Required verification is known in advance.
- The implementation is traceable to requirement/evidence/rules.

If any applicable item fails:

**DO NOT START IMPLEMENTATION.**

Resolve the failed gate first.

---

## 27. Runtime Re-Check Gate

Do not treat compliance as a one-time bootstrap.

Re-check the relevant original rule text before:

- a material recommendation;
- an architecture decision;
- reducing scope;
- creating a new abstraction;
- accepting a workaround;
- changing a state model;
- changing a provider/API boundary;
- changing DB/schema behavior;
- a major UI decision;
- deciding verification is sufficient;
- declaring completion.

"Already read earlier" is not enough.

---

## 28. Subagent Enforcement

Subagents do not get weaker rules.

When delegating:

- require them to load the relevant original rule files;
- give verified task context;
- preserve the same anti-satisficing constraints;
- preserve no-assumption requirements;
- preserve type/hardcode/security constraints;
- preserve verification obligations.

Do not delegate with vague text like:

- "follow best practices";
- "keep PRDFY rules in mind";
- "make it production-ready".

The parent agent must audit subagent output against the original rules before accepting it.

Subagent output is evidence/input, not automatic truth.

---

## 29. Verification Is Mandatory

Do not skip verification because:

- the change appears obvious;
- source code looks correct;
- one test passed;
- the command is slow;
- running the browser is inconvenient;
- "it should work".

Use the actual repository verification commands and runtime/browser flows required by the project rules.

For browser behavior, do not claim success from source inspection alone when browser verification is required.

If a required verification cannot run:

- report the exact blocker;
- do not replace it with a weaker success claim.

---

## 30. Pre-Completion Audit

Before claiming completion, re-audit the actual result against the original rule files.

Check:

- requirement coverage;
- behavior/state coverage;
- assumptions;
- convenience-biased shortcuts;
- root cause;
- reuse;
- hardcoding;
- fake behavior;
- type bypasses;
- UI quality;
- copy quality;
- responsive behavior;
- accessibility;
- ownership/security boundaries;
- tests;
- runtime/browser evidence;
- TODOs/placeholders;
- completion honesty.

If any applicable rule is violated:

- fix it before claiming completion.

If it cannot be fixed:

- report `Partial` or `Blocked`.

---

## 31. Completion Language Must Match Evidence

Use status precisely:

- **Implemented** — code was written; full verification is not yet established.
- **Verified** — relevant verification actually ran and results were checked.
- **Complete** — full requirement, applicable state matrix, rule compliance, and required verification are all finished.
- **Partial** — part of the required scope remains; state the gap.
- **Blocked** — environment, credential, dependency, or unresolved decision prevents completion.

Do not use "done", "finished", "all good", "safe", or "production-ready" unless the evidence truly supports it.

---

## 32. Context Loss / Compaction Recovery

If context is compacted, reset, handed off, or there is any reasonable possibility that detailed constraints were lost:

1. stop;
2. re-read this `AGENTS.md`;
3. re-read the mandatory rule files relevant to the task;
4. re-establish the runtime gates;
5. only then continue.

Do not rely on a compressed memory of the rules.

---

## 33. Absolute Enforcement Clause

Compliance takes precedence over implementation momentum.

Never trade rule compliance for:

- speed;
- convenience;
- lower effort;
- shorter output;
- fewer tool calls;
- fewer changed files;
- lower implementation complexity;
- preservation of already-written work.

A more demanding rule-compliant solution is preferable to an easier non-compliant solution.

When uncertain whether an action violates a rule:

> **Treat the action as NOT YET AUTHORIZED until the relevant rule and evidence are checked.**

Never assume that because a solution is technically valid, common, simple, clean, maintainable, or functional, it is automatically compliant.

PRDFY compliance must be established independently.