# PRDFY Rule Ingestion Prompt

This turn is RULE-INGESTION ONLY.

DO NOT implement, modify, debug, refactor, create, delete, commit, push, or plan any product task in this turn.

The actual task will be provided by me in my NEXT prompt.

Your only job in this turn is to fully load, understand, and activate the PRDFY project rules below so they become binding constraints for the next task and the rest of this working session.

## RULE FILES

```
"C:/Coding/Web Development/Tanstack-start/prdfy/.agents/rules/anti-ai-slop.md"
"C:/Coding/Web Development/Tanstack-start/prdfy/.agents/rules/anti-satisficing.md"
"C:/Coding/Web Development/Tanstack-start/prdfy/.agents/rules/basic-rules.md"
"C:/Coding/Web Development/Tanstack-start/prdfy/.agents/rules/no-assumptions.md"
"C:/Coding/Web Development/Tanstack-start/prdfy/.agents/rules/no-hardcode.md"
"C:/Coding/Web Development/Tanstack-start/prdfy/.agents/rules/no-type-bypass.md"
"C:/Coding/Web Development/Tanstack-start/prdfy/.agents/rules/prdfy-context.md"
"C:/Coding/Web Development/Tanstack-start/prdfy/.agents/rules/skills-mcp.md"
```

---

## 0. OBEY THE SKILL GATE BEFORE READING

Before performing ANY action, including reading these files, comply with the project's skill/MCP rules.

Use the native skill mechanism/tool required by the repository.

Do not skip the skill gate because:

- this turn has no implementation task,
- you "only need to read files",
- the task looks simple,
- or you think skills can be loaded later.

Do not pretend a skill or MCP was invoked if it was not actually invoked.

---

## 1. READ ALL 8 FILES COMPLETELY

You MUST read every listed rule file from its first line through its actual EOF.

This is a FULL READ, not reconnaissance.

Forbidden substitutes for a full read:

- grep/search matches only
- file previews
- summaries
- first N lines only
- headings only
- snippets
- semantic search
- reading only sections that look relevant
- assuming the rest based on the filename
- assuming the rest based on similar rules
- relying on memory from an earlier session
- treating a successful read-tool call as proof that the entire file was returned

Every part of every file matters, including:

- headings
- body text
- tables
- examples
- code blocks
- exceptions
- warnings
- checklists
- footnotes
- final directives
- repeated constraints

Do not intentionally skip any character-bearing line.

---

## 2. PROTECT AGAINST TOOL OUTPUT TRUNCATION

A tool returning output successfully does NOT prove the whole file was shown.

For EACH rule file:

1. Determine its actual total line count using the filesystem/tooling.
2. Read from line 1 forward.
3. If the complete file cannot be returned safely in one read, read it sequentially in contiguous chunks.
4. Track the exact line ranges already consumed.
5. Continue until the final line / EOF.
6. Verify that coverage is continuous:

```
1 -> final line
```

with:

- no gaps,
- no skipped middle ranges,
- no missing tail,
- and no assumption that truncated output equals EOF.

Example:

Valid:

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
tool output truncated
"looks complete"
```

If output truncation occurs, explicitly continue reading from the first unread line.

Do not use a giant `cat`/single command and assume that because the process read the file, the model also received every line.

---

## 3. VERIFY FILE COVERAGE BEFORE CLAIMING SUCCESS

For every file, internally verify:

- actual total line count
- first line was read
- last line was read
- every intermediate range was covered
- EOF was reached
- no tool truncation left unread content

Do not claim "fully read" unless all of those are true.

If even ONE file cannot be fully read:

- do not pretend ingestion succeeded,
- identify the exact file,
- identify the unread range/problem,
- and stop.

---

## 4. UNDERSTAND THE RULES AS A SYSTEM

Reading is not enough.

After full ingestion, build a working constraint model of the rules.

Understand the distinction and interaction between at least:

- PRDFY product/domain context
- repository architecture and locked stack
- evidence / no-assumption requirements
- investigation requirements
- brainstorming/planning requirements
- skills / MCP / plugin gates
- anti-satisficing requirements
- root-cause requirements
- reuse-before-reinventing requirements
- UI and anti-AI-slop constraints
- copywriting constraints
- responsive/accessibility requirements
- hardcoding/configuration boundaries
- real-signal vs fake-behavior rules
- TypeScript/type-safety restrictions
- database/security/tenant boundaries
- test philosophy
- verification requirements
- completion evidence
- git/commit/push requirements

Do not flatten these into generic advice.

Understand:

- what each rule REQUIRES,
- what each rule FORBIDS,
- its exceptions,
- its verification requirements,
- when it applies,
- and how it interacts with the other rules.

Where the files define boundaries between rules, preserve those boundaries instead of merging them into a vague "best practices" concept.

---

## 5. DO NOT SILENTLY RESOLVE CONFLICTS

If two instructions appear to conflict:

- reread the exact relevant wording,
- follow the precedence/evidence rules defined by the repository,
- inspect the authoritative source when the rules require it,
- and do not silently choose whichever interpretation is easier.

Do not invent your own precedence hierarchy if the project already defines one.

---

## 6. ACTIVATE THE RULES FOR THE NEXT PROMPT

After ingestion, treat these rules as ACTIVE constraints for my next task.

When I send the actual task in the next prompt:

DO NOT merely remember that the rule files exist.

You must APPLY them during:

- task classification
- skill selection
- investigation
- brainstorming
- planning
- architecture decisions
- implementation
- UI decisions
- copywriting
- code changes
- debugging
- testing
- browser QA
- verification
- git workflow
- completion reporting

The rules must affect your actual decisions.

For example, if the next task involves UI:  
the anti-AI-slop rules must materially affect the design.

If it involves TypeScript:  
the no-type-bypass rules must materially constrain the implementation.

If it involves a library/API:  
the applicable current-doc/context rules must be followed.

If it involves a bug:  
the root cause must be investigated rather than patching the visible symptom.

If it involves an existing pattern/component:  
reuse/discovery requirements must be followed before reinventing it.

These are examples, not a replacement for the actual rule files.

---

## 7. DO NOT START THE FUTURE TASK YET

There is intentionally NO product task in this prompt.

Do not:

- inspect random feature code in anticipation,
- guess what I will ask next,
- make proactive edits,
- create a plan for an imaginary task,
- start a worktree,
- commit anything,
- push anything,
- or implement anything.

Wait for my next prompt.

---

## 8. RULES MUST SURVIVE THE WORKFLOW

Do not treat rule ingestion as a checkbox that expires after your next message.

Keep these rules active throughout the task lifecycle.

If context is compacted, reset, handed to another subagent, moved into another execution phase, or there is any reasonable risk that the full constraints are no longer available:

RE-READ the required rule files before continuing.

Subagents must not receive a weaker version of the requirements.

Do not replace the actual rules with an oversimplified summary when delegating work.

---

## 9. FINAL RESPONSE FOR THIS TURN

After completing the ingestion, do NOT give me a long summary of the rule contents.

Return only a concise readiness receipt containing:

- confirmation that all 8 files were read through EOF,
- confirmation that complete continuous line coverage was verified,
- confirmation that the rules were understood as active execution constraints rather than reference material,
- confirmation that no implementation/task work was started,
- confirmation that you are waiting for my next prompt.

Include each filename with its verified total line count so the full-read claim is auditable.

Do not fabricate this receipt.

If full ingestion failed, report the failure instead of saying you are ready.