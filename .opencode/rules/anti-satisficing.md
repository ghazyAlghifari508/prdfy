# Anti-Satisficing Rules

> **MANDATORY WORK-ETHIC DIRECTIVE FOR ALL AI AGENTS AND DEVELOPERS**
>
> Satisficing is stopping at the first solution that merely looks fulfilled,
> when a more correct solution exists and only requires more effort. This is
> not a failure to read the facts correctly; it is a failure to try. The
> agent already knows, or should know, a better path, but still picks the
> shortcut because it is easier, faster, or lower-risk for the agent itself.
>
> Boundary between rule files (do not mix them up):
>
> - `no-assumptions.md` guards **what you know** (do not guess
> files, versions, APIs, or provider behavior).
> - This file guards **what you decide and how far you are willing to go on
> it** (scope, effort, and honesty about work status).
> - `anti-ai-slop.md` guards the **specific UI visual standard**;
> this file only flags "generic-default UI because it is the easiest
> option" as one symptom of satisficing, without duplicating that file's
> checklist.

## Core Principle

A functional implementation is not a finished implementation, and a finished
implementation is not necessarily one that was genuinely attempted with real
effort. A good-faith but satisficing agent still ships a product that feels
"half done" - not because it misread the codebase, but because it chose the
smaller, faster, or safer-for-itself option without ever telling the user.

For every task, the agent must go through this full cycle without cutting
corners midway:

```text
Understand
  -> Determine the complete scope that is actually required
  -> Search for existing solutions before creating new ones
  -> Compare options honestly, including the option that takes more effort
  -> Implement the most correct solution, not the easiest one
  -> Close out behavior, state, and edge cases completely
  -> Audit the remaining unfinished work
  -> Claim status only with real evidence
```

---

## Rule 1: "Recommended" Means Correct, Never Convenient

This is the most commonly broken rule by agents, and the user cannot see it
happen, so it must be internalized.

When giving a recommendation - through a "(Recommended)" label, option
ordering, phrasing like "my suggestion", "simpler option", "best practice",
or "let's just do this for now" - the choice must be based on what is most
correct for the requirement, product, maintainability, and user. Not based on
what is fastest to complete, fewest tokens, easiest to pass a test, or least
extra work for the agent.

Mandatory rules:

1. Before labeling an option "Recommended", ask yourself first: "If option A
 and option B take the same amount of effort, would I still pick A?" If
 the answer is no, what is being picked is not the best option, it is the
 laziest one - do not label it "Recommended".
2. If two options have a trade-off that is not yet clearly resolved in favor
 of one being more correct, that is not a reason to default to the easier
 one. That is a reason to read more context, or to tell the user honestly
 that this is still unresolved - not to package "I just took the simple
 one" as a neutral suggestion.
3. Do not use language like "keep it simple", "YAGNI", "over-engineering",
 "MVP scope only", or "best practice" to justify cutting scope when the
 real reason is that the cut makes the agent's job lighter. If the
 argument is genuinely valid and not about effort, state the argument
 explicitly (for example "this is out of scope because the spec states
 X"), not hidden behind a recommendation label.
4. A "Recommended" label must not be used to push the user toward a minimum
 scope without them knowing. If the correct scope is larger than what the
 user might expect, still present it as its own option; do not bury it
 under a recommendation.
5. This applies outside the `question` tool as well: in commit messages, in
 PR summaries, in explaining why an approach was chosen, and in phrases
 like "I'll just build X" without being asked. The same self-serving
 pattern must be prevented at every one of those points, not only at
 formal recommendation moments.

### Self-Check Before Giving a Recommendation or Design Decision

Answer honestly before submitting to the user:

- [ ] Did I pick this because it is the most correct, or because it is the
  easiest for me?
- [ ] If both options took the same effort, would my choice change?
- [ ] Am I using the words "simple", "best practice", or "enough" to hide
  the fact that this is a shortcut?
- [ ] Does the user understand the consequence of following my
  "Recommended" option?
- [ ] If I were the user, would I read this recommendation as an expert
  calling the right shot, or as a lazy one?

---

## Rule 2: Never Stop at the First Acceptable Solution

Before executing, the agent must:

1. understand the requirement, acceptance criteria, boundary, phase owner,
 and consumer;
2. identify at least one real alternative when the decision carries a
 trade-off;
3. explain why the chosen option is the most correct for this context, not
 why other options "feel heavier";
4. reject shortcuts that only reduce effort without reducing behavior,
 safety, consistency, or verifiability.

Do not pick an approach only because:

- it has the fewest lines of code;
- it is the fastest to type;
- it is the easiest to make pass the existing test;
- it only touches the file the user mentioned first;
- it makes one screenshot or one test go green without addressing the root
cause.

Small does not mean sufficient. Choose the smallest solution that still
covers the entire contract, not the smallest solution that lets the agent
get away with not finishing the contract.

---

## Rule 3: Reuse Before Reinventing, Because Reinventing Is Often the Lazy Path

Creating a new component, helper, adapter, or schema can feel easier than
finding and adopting something that already exists, because searching
requires the effort of reading and adapting. That is still satisficing when
an existing solution actually fits.

Before creating something new:

1. search for similar names, symbols, paths, and usage patterns;
2. read the actual implementation and its consumers, not just file names;
3. decide between using it directly, composing it, or genuinely needing
 something new, with a concrete reason;
4. if a new abstraction is built, it must have a clear reuse need, not
 because "writing from scratch is easier than learning what already
 exists".

This applies to UI components, hooks, utilities, provider adapters, error
envelopes, ownership queries, state transitions, and design tokens. (The
technical mechanics of reading and verifying codebase context is the domain
of `no-assumptions.md`, not this file.)

---

## Rule 4: Happy Path Is One Row, Not the Whole Job

Stopping at a single success path is the most common and most easily
disguised-as-"done" form of satisficing. Every change must be built against a
behavior matrix appropriate to its domain, at minimum this:


| State/condition                         | Required behavior                                                          |
| --------------------------------------- | -------------------------------------------------------------------------- |
| Initial/empty                           | User understands the condition and the next action                         |
| Loading/pending                         | Progress is visible and layout does not jump                               |
| Disabled                                | Action cannot be triggered while invalid/pending/unauthorized              |
| Valid input                             | Succeeds per the contract                                                  |
| Missing/invalid input                   | Clear, actionable feedback at the correct boundary                         |
| Unauthorized/session expired            | Rejected without leaking the resource, routed safely                       |
| Network/server/provider/storage failure | Error classified, state not corrupted, retry per contract                  |
| Cancel/abort/duplicate/stale/conflict   | Side effects stop consistently, no duplication, no overwriting newer state |
| Success/terminal                        | Outcome and next action clearly visible                                    |


Adapt further per domain:

- **Auth flow:** initial/loading, invalid/canceled/expired OAuth callback,
provider timeout, DB/session creation failure, duplicate callback,
partial-session prevention, safe/unsafe redirect, logout failure, private
route without session, disabled button, duplicate submit.
- **Form/action:** pending state, retry, cancel, field error, server error,
data preservation after error, success feedback, redirect behavior.
- **API/mutation:** ownership, malformed input, oversized payload, error
envelope, transaction rollback, idempotency, stale/conflict, provider
retry exhaustion, consistency after reload.
- **Generation/pipeline:** options session, PRD stream, section revision patch,
AC generation, task tree generation, credit burn, rate limit, timeout, SSE abort/reconnect,
fallback model retry, malformed patch block, version history immutability.
- **Task/Kanban:** drag-and-drop state, optimistic update, error rollback,
polling reconciliation, subtask JSON tree consistency.
- **Billing/payment:** Snap token, amount/item match, webhook signature verification,
atomic credit increment, duplicate webhook idempotency, blocked action resumption.

Not every row is relevant for every task. Mark which ones apply and explain
which ones do not; do not silently skip the matrix. This is about the scope
of the job, not about fact-checking (for fact-checking, see
`no-assumptions.md`).

---

## Rule 5: Root Cause, Not the Cheaper Patch

Patching a symptom is almost always easier than fixing the root cause, which
makes patching the default bias that must be actively prevented.

Do not patch with:

- adding a timeout with no evidence;
- adding a `try/catch` that just swallows the error;
- turning an error into a success or an endless loading state;
- weakening an assertion so a test goes green;
- adding a retry for an error that is actually non-retryable;
- special-casing a filename, user text, model ID, route, or specific
provider response just to make one fixture pass;
- hardcoding a fallback, disabling validation/auth/typecheck, or deleting
the test that caught the problem.

If the root cause has not been found, the status is unresolved, not "done
but there might still be a bug". (The technical mechanics of reproducing and
tracing a root cause are defined in `no-assumptions.md`; this
file prevents the agent from choosing to patch because the root-cause fix
costs more effort.)

---

## Rule 6: Generic-Default UI Is a Satisficing Symptom

A default layout that is "functional enough" (a plain card stack, a form
with no hierarchy, a standard button with no states, a panel that just got
slapped on) is often chosen not because it is the best design decision, but
because it is the fastest to produce. That is exactly the form of
satisficing the user complained about.

When a task touches UI, check first:

- Did I pick this because it is genuinely the most correct, or because it is
the easiest?
- Will I call this "production-ready" or only "functional"?

The full visual standard (hierarchy, spacing, states, responsive behavior,
accessibility, and redesigning existing surfaces from zero) is the domain of
`anti-ai-slop.md`, not repeated here. This file only covers the part
that is easiest to self-rationalize away: "this is fine as-is" as an excuse
not to redesign.

---

## Rule 7: No Unfinished Work, No Fake Completion

Before claiming any status, scan the change and the surrounding area:

- `TODO`, `FIXME`, `TBD`, `XXX`, "implement later" comments;
- placeholder copy, lorem ipsum, dummy data, fake URLs, mocks that can reach
a production path;
- empty functions, `return null`/`[]`/`{}` hiding unfinished behavior;
- `throw new Error('not implemented')` or a branch that never got finished;
- disabled/skipped tests, commented-out code, new lint suppressions;
- hardcoded secrets, IDs, URLs, limits, credentials, or workarounds;
- silent catches, ignored promises, swallowed errors, unhandled rejections;
- UI states with no error/loading/empty/disabled/terminal behavior;
- routes/actions with no authorization/ownership check;
- generated artifacts, debug logs, temp files, or screenshots out of scope.

A placeholder intentionally left for a future phase must be stated
explicitly to the user as out-of-scope, not quietly left looking like
finished work. Work that is 80% done dressed up as 100% is the most
dangerous form of satisficing, because the user cannot tell the difference
on their own.

---

## Rule 8: Do Not Skip Verification Because It Feels Tedious or "Should Pass"

Running the relevant command is not itself an epistemic problem. *Which
command* is required is defined in `no-assumptions.md` (Rule 12) and `AGENTS.md`. What is governed here is only this: do not skip or
shortchange verification because:

- you feel "it definitely passes, no need to run it";
- the command is slow or tedious;
- you ran one happy-path test and felt that was enough;
- you are afraid the command will reveal something that means going back to
rework.

If a command cannot run (environment, credential, or dependency missing),
report it as a concrete blocker. Do not substitute it with a partial success
claim that has no real evidence.

---

## Rule 9: Completion Language Must Match Effort and Evidence

The status used must match what was actually done and actually proven,
including effort that was genuinely not spent (for example scope quietly
cut):

- `Implemented` = code written, not yet verified.
- `Verified` = the relevant command/flow actually ran and its output was
checked.
- `Complete` = requirement, behavior matrix, and relevant verification all
finished.
- `Partial` = part of the scope is done, the remaining gap is stated
explicitly.
- `Blocked` = needs environment, credential, dependency, or a decision that
does not exist yet.

Do not use "done", "finished", "safe", "production-ready", or "all good" for
work that only cleared the surface because the easiest option was chosen,
not the most correct one.

### Completion Audit

Before claiming `Complete`, answer this explicitly, not just internally:

- [ ] Is all the scope the user/requirement actually needs covered, or is
  the rest stated honestly as Partial/gap?
- [ ] Was a shortcut taken because it was easier, and was it surfaced to the
  user rather than dressed up as "the best technical decision"?
- [ ] Is the relevant behavior matrix covered, not just the happy path?
- [ ] Was reuse checked before building a new abstraction?
- [ ] Are there no placeholders, TODOs, dummy data, or silent errors?
- [ ] Was relevant verification actually run, not skipped because "it should
  pass"?
- [ ] Does the status claim match real evidence, not what is most pleasant
  for the user to read?

An unfinished item is reported as a gap, not hidden behind the word "done".

---

## Anti-Patterns


| Anti-Pattern                                            | Why It Is Satisficing                                                                           | Correct Behavior                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Labeling the easiest-for-the-agent option "Recommended" | The recommendation becomes a tool for reducing the agent's own effort, not for helping the user | Recommend based on what is correct for the product, not the agent's effort |
| Stopping at the first happy path                        | The remaining states are not a bonus, they are part of the scope                                | Build and verify the full behavior matrix                                  |
| Creating a new component/helper when one already exists | Searching and adopting costs more effort than writing from zero                                 | Search and reuse first before building new                                 |
| Patching a symptom instead of the root cause            | Root cause almost always costs more effort                                                      | Chase the root cause, add a regression test for the failure class          |
| Default layout because "it's fine"                      | Fast to produce is more tempting than properly designed                                         | Check against `anti-ai-slop.md` before declaring this "fine"               |
| Leaving TODO/placeholder/fake data                      | 80% dressed up as 100%                                                                          | Finish it or explicitly mark it out-of-scope                               |
| Skipping verification because "it should pass"          | Saving your own time at the cost of evidence                                                    | Run relevant verification, report a gap if it truly cannot run             |
| Writing "done" right after writing code                 | Easy to claim, hard to prove                                                                    | Use a status that matches the real effort and evidence                     |
| "Keep it simple/YAGNI" with no product argument         | Best-practice language used to hide a shortcut                                                  | Give the concrete reason, not a label that sounds neutral                  |


---

## Final Directive

**Do not pick the easy path when you know the correct one costs more. Your
recommendation must reflect what is most correct for the product and the
user, not what makes your own job the smallest. If two options cost the same
amount of effort, that is the real test of whether you picked the correct
one or were just looking for the lightest one for yourself.**

The required standard:

```text
pick the most correct option, not the easiest one
+ cover the full scope, not just the happy path
+ reuse before building new
+ fix the root cause, not the symptom
+ design the UI, do not just make it "functional enough"
+ actually run verification, do not skip it because you are optimistic
+ claim a status that matches real evidence and real effort
= acceptable completion
```
