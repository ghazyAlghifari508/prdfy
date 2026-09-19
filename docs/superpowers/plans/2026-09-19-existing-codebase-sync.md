# Existing Codebase Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure existing-codebase workflow where an external AI agent runs the PrdFy CLI locally, the CLI syncs a filtered repository snapshot, and PrdFy uses the resulting analysis for contextual Ask, PRD, AC, and Task generation without changing the existing greenfield flow.

**Architecture:** Add a persisted `existing_codebase` project mode and project-owned sync/session/snapshot/analysis records. The browser creates a short-lived project-scoped sync credential and polls server status; the external agent installs/runs `prdfy codebase sync`, while the CLI performs local filtering, hashing, chunked upload, and status reporting. The server validates and stores the snapshot, runs analysis through the existing AI orchestration boundary, and passes a validated generation context into later pipeline stages.

**Tech Stack:** TanStack Start, TanStack Router, React 19, Drizzle ORM/PostgreSQL, Better Auth, existing `/api/v1` API-key boundary, Commander CLI, Node filesystem APIs, Vitest, Playwright, Biome.

**Spec:** `docs/superpowers/specs/2026-09-19-existing-codebase-sync-design.md`

## Global Constraints

- Preserve the existing greenfield flow and default existing projects to `greenfield`.
- The server never executes an external AI coding agent.
- The CLI must never modify application source code, create commits, or push changes.
- `.prdfyignore` supplements built-in CLI exclusions; it cannot override secret/unsafe-path protection.
- Sync credentials are project-scoped, hashed at rest, expiring, revocable, rate-limited, and excluded from logs/errors.
- Every sync API request validates scope, project ownership, session binding, payload size, path safety, and idempotency.
- Sync and analysis do not consume PRD/AC/Task credits; existing generate/revision credit semantics remain unchanged.
- Sync status is based on persisted real events; do not fabricate percentage progress.
- No raw secret values may appear in tests, logs, prompt output, or fixtures.
- Server-only database/auth modules remain dynamically imported where the existing route pattern requires it.
- All new business limits live in a constants/config module or CLI constants, not scattered magic literals.
- Verify each task with focused tests before moving to the next task.

## Locked MVP Decisions

- Sync status uses browser polling at `2000ms`; no sync SSE endpoint is added in MVP.
- A sync session expires after `30 minutes`; completed/failed/expired credentials are rejected.
- The CLI command is `prdfy codebase sync --project-id <id> --sync-token <token>`.
- The prompt instructs the agent to install `@ghazynabiel/prdfy` globally only when `prdfy --version` is unavailable, then verify version `2.0.0` or newer.
- Maximum snapshot size is `50 MiB`, maximum included file size is `1 MiB`, and maximum upload chunk size is `256 KiB`; these values are constants and are enforced by both CLI and server.
- Raw filtered source content is retained for the lifetime of the project so analysis can be regenerated from the selected snapshot; project deletion removes it transactionally. No independent long-term retention job is added in MVP.
- `.prdfyignore` is local and is never automatically committed or pushed.
- The first successful snapshot becomes the active generation context. A later snapshot does not silently rewrite existing PRD/AC/Task output; new generation requests use the latest user-selected ready snapshot.
- Snapshot identity is linked to generated output through a project-owned generation-context record instead of changing existing AC/task version semantics.
- Manifest and source chunks are uploaded as JSON with base64-encoded text content only; binary files are excluded rather than uploaded.

---

## File Map

### Web application

- Modify `src/db/schema.ts`: add project mode support and project-owned sync/session/snapshot/analysis/context records.
- Create `drizzle/<generated-existing-codebase-migration>.sql`: migration generated from the reviewed schema change.
- Modify `src/lib/constants.ts`: sync state, size, expiry, polling, and version constants.
- Create `src/lib/codebase-sync.ts`: server-side credential hashing, state transition, validation, and context access helpers.
- Create `src/lib/codebase-analysis.ts`: validated analysis input/output and analysis orchestration wrapper.
- Create `src/lib/codebase-generation-context.ts`: load snapshot analysis/context for Ask, PRD, AC, and Task prompts.
- Modify `src/routes/api/projects/index.ts`: accept `greenfield`/`existing_codebase` and create a sync session for existing-codebase projects.
- Modify `src/routes/api/projects/$id.ts`: delete sync child records transactionally.
- Create `src/routes/api/codebase/$projectId/session.ts`: browser-owned session/prompt payload and retry/revoke actions.
- Create `src/routes/api/codebase/$projectId/status.ts`: authenticated status endpoint for browser polling.
- Create `src/routes/api/v1/projects/$id/codebase/sync.ts`: CLI sync session initialization and metadata.
- Create `src/routes/api/v1/projects/$id/codebase/manifest.ts`: manifest chunk upload.
- Create `src/routes/api/v1/projects/$id/codebase/files.ts`: bounded source-context chunk upload.
- Create `src/routes/api/v1/projects/$id/codebase/complete.ts`: idempotent atomic snapshot completion.
- Create `src/routes/api/v1/projects/$id/codebase/analysis.ts`: analysis status/request/read boundary.
- Modify `src/components/layout/chat-input.tsx`: mode selector and existing-codebase project creation payload.
- Create `src/components/codebase/sync-agent-modal.tsx`: copyable external-agent prompt and session state.
- Create `src/components/codebase/sync-status.tsx`: real persisted sync status with retry/error states.
- Create `src/components/codebase/codebase-review.tsx`: detected environment, repository map, exclusions, impact areas, and continue action.
- Create `src/routes/codebase/$id.tsx`: sync/status/review route for existing-codebase projects.
- Modify `src/app/ask/ask-flow.tsx`: load durable existing-codebase analysis context and persist answer handoff.
- Modify `src/routes/api/ask/options.ts`: include validated codebase context for existing-codebase questions.
- Modify `src/routes/api/chat.ts`: include snapshot-bound generation context in PRD generation/revision boundaries without charging revisions.
- Modify `src/routes/api/ac/generate.ts`: include snapshot-bound context in AC generation.
- Modify `src/routes/api/task/generate.ts`: include snapshot-bound context in Task generation.
- Modify `src/routes/api/settings/api-keys/auto.ts` and/or add sync credential helpers: keep ordinary auto-CLI scopes separate from sync scopes.
- Add focused tests beside sync helpers/routes and regression tests for existing greenfield behavior.

### CLI

- Modify `packages/cli/src/index.ts`: register `codebase sync` command and update help text.
- Modify `packages/cli/src/lib/config.ts`: support safe per-command/session configuration without storing sync credentials as permanent global config.
- Modify `packages/cli/src/lib/api-client.ts`: add structured requests, timeout/abort, bounded JSON/chunk upload, retryable errors, and response validation.
- Create `packages/cli/src/lib/ignore.ts`: parse `.prdfyignore` and apply built-in exclusions.
- Create `packages/cli/src/lib/repository.ts`: locate repository root, normalize paths, inspect git metadata, and reject unsafe symlinks/path traversal.
- Create `packages/cli/src/lib/manifest.ts`: deterministic file metadata, hashing, size/type detection, and chunk planning.
- Create `packages/cli/src/lib/sync-client.ts`: session handshake, manifest/file chunk upload, status reporting, completion, retry, and idempotency.
- Create `packages/cli/src/commands/codebase.ts`: `prdfy codebase sync --project-id ... --sync-token ...` human and JSON output.
- Create `packages/cli/src/commands/codebase.test.ts`: command-level tests with mocked repository and API client.
- Create tests for `ignore.ts`, `repository.ts`, `manifest.ts`, and `sync-client.ts`.
- Modify `packages/cli/package.json`: add only dependencies required by the implementation and explicit supported Node engine if selected.

### Verification and documentation

- Add/update `e2e/` tests for existing-codebase flow and greenfield regression.
- Modify `README.md` or CLI documentation with installation, `.prdfyignore`, sync command, privacy, and failure recovery instructions.
- Keep the approved design spec unchanged unless a user-approved design decision changes.

---

## Task 1: Lock constants, types, and migration shape

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/lib/codebase-sync.ts`
- Create: `src/lib/codebase-analysis.ts`
- Create: `src/lib/codebase-generation-context.ts`
- Modify: `src/lib/constants.ts`
- Test: `src/lib/codebase-sync.test.ts`
- Test: `src/lib/codebase-analysis.test.ts`

**Interfaces:**
- Produces `ExistingCodebaseProjectMode = "greenfield" | "existing_codebase"`.
- Produces sync statuses: `waiting_for_cli | connected | scanning | filtering | uploading | uploaded | analyzing | ready | failed | expired`.
- Produces typed DTOs for `SyncPromptPayload`, `SyncStatusResponse`, `ManifestEntry`, `SnapshotContext`, and validated `CodebaseAnalysis`.
- Produces constants for session expiry, polling interval, max snapshot bytes, max file bytes, max chunk bytes, and CLI minimum version.

- [ ] **Step 1: Write failing tests for state transitions and boundary constants.**

Test that valid transitions are accepted, terminal states cannot transition, and invalid transitions are rejected with a typed error. Test that the analysis schema rejects missing project/snapshot identity and accepts an uncertain finding with an explicit uncertainty field.

- [ ] **Step 2: Run focused tests to verify they fail.**

Run: `pnpm vitest run src/lib/codebase-sync.test.ts src/lib/codebase-analysis.test.ts`

Expected: FAIL because the new types, constants, and helpers do not exist yet.

- [ ] **Step 3: Add typed constants and pure validation/state helpers.**

Keep helpers database-agnostic where possible. Use Zod for payload/analysis boundary validation and a typed transition map for statuses. Do not add database access to pure transition tests.

- [ ] **Step 4: Run focused tests.**

Run: `pnpm vitest run src/lib/codebase-sync.test.ts src/lib/codebase-analysis.test.ts`

Expected: PASS.

- [ ] **Step 5: Generate and inspect the Drizzle migration.**

Run: `pnpm drizzle-kit generate`

Review the generated SQL before proceeding. Confirm every new project-owned table has foreign keys/indexes and that the migration does not silently alter unrelated subscription columns.

- [ ] **Step 6: Commit the foundation.**

```bash
git add src/db/schema.ts src/lib/constants.ts src/lib/codebase-sync.ts src/lib/codebase-analysis.ts src/lib/codebase-generation-context.ts src/lib/codebase-sync.test.ts src/lib/codebase-analysis.test.ts drizzle
git commit -m "feat: define existing codebase sync foundation"
```

## Task 2: Implement CLI repository filtering and manifest generation

**Files:**
- Create: `packages/cli/src/lib/ignore.ts`
- Create: `packages/cli/src/lib/repository.ts`
- Create: `packages/cli/src/lib/manifest.ts`
- Test: `packages/cli/src/lib/ignore.test.ts`
- Test: `packages/cli/src/lib/repository.test.ts`
- Test: `packages/cli/src/lib/manifest.test.ts`

**Interfaces:**
- `readPrdfyIgnore(root: string): Promise<IgnoreRules>` reads existing rules without mutating the repository.
- `scanRepository(root: string, rules: IgnoreRules): Promise<RepositoryScan>` returns safe relative files and exclusion reasons.
- `buildManifest(scan: RepositoryScan): Promise<RepositoryManifest>` returns deterministic entries with normalized path, size, hash, language, and content eligibility.

- [ ] **Step 1: Write failing tests using synthetic temporary repositories.**

Cover `.env`, `.env.local`, keys/certificates, `.git`, dependency/build directories, binary files, `.prdfyignore` custom exclusions, path normalization, unreadable files, symlink targets outside root, and secret detection without asserting or logging raw secret values.

- [ ] **Step 2: Run CLI-focused tests to verify failure.**

Run: `pnpm vitest run packages/cli/src/lib/ignore.test.ts packages/cli/src/lib/repository.test.ts packages/cli/src/lib/manifest.test.ts`

Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Implement built-in and `.prdfyignore` filtering.**

Use platform-safe path APIs, convert output paths to repository-relative `/` separators, reject `..` escapes, do not follow symlinks outside root, and return exclusion metadata without file contents.

- [ ] **Step 4: Implement deterministic manifest and content eligibility.**

Hash file bytes, sort entries by normalized path, enforce configured file/snapshot limits, classify text/binary, and keep source content loading separate from directory traversal.

- [ ] **Step 5: Run tests and build the CLI.**

Run: `pnpm vitest run packages/cli/src/lib/ignore.test.ts packages/cli/src/lib/repository.test.ts packages/cli/src/lib/manifest.test.ts`; then `pnpm --dir packages/cli build`

Expected: PASS and TypeScript build succeeds.

- [ ] **Step 6: Commit the scanner.**

```bash
git add packages/cli/src/lib/ignore.ts packages/cli/src/lib/repository.ts packages/cli/src/lib/manifest.ts packages/cli/src/lib/*.test.ts
git commit -m "feat: add safe codebase manifest scanning"
```

## Task 3: Build CLI sync transport and command against the typed contract

**Files:**
- Modify: `packages/cli/src/lib/api-client.ts`
- Create: `packages/cli/src/lib/sync-client.ts`
- Create: `packages/cli/src/commands/codebase.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/lib/config.ts`
- Test: `packages/cli/src/lib/api-client.test.ts`
- Test: `packages/cli/src/lib/sync-client.test.ts`
- Test: `packages/cli/src/commands/codebase.test.ts`

**Interfaces:**
- `syncCodebase(options: { projectId: string; syncToken: string; root?: string; output?: "human" | "json" }): Promise<SyncResult>`.
- `createSyncClient(options: { apiUrl: string; syncToken: string; timeoutMs: number }): SyncClient`.
- API client errors expose status, retryability, and server error code without raw credential/body leakage.

- [ ] **Step 1: Write failing transport/command tests.**

Test auth headers, bounded chunk payloads, request timeout/abort, retryable network/5xx errors, non-retryable 4xx errors, idempotency key reuse, JSON output shape, human summary, and refusal to continue when the manifest contains blocked content.

- [ ] **Step 2: Run focused tests to verify failure.**

Run: `pnpm vitest run packages/cli/src/lib/api-client.test.ts packages/cli/src/lib/sync-client.test.ts packages/cli/src/commands/codebase.test.ts`

Expected: FAIL because the transport and command are not implemented.

- [ ] **Step 3: Extend API transport without breaking existing commands.**

Retain `apiGet`/`apiPost` behavior for existing commands while adding a generic internal request path that supports timeout, abort, structured errors, and bounded JSON/chunk requests. Do not store the sync token in global config.

- [ ] **Step 4: Implement session handshake, manifest upload, text file chunks, completion, and retry.**

Use the endpoint and payload types defined in Task 1. Each retry carries the same session/attempt/chunk identity. The CLI emits actual persisted status updates and never invents percentages. The test suite uses mocked responses until the server endpoints are implemented in Tasks 4 and 5.

- [ ] **Step 5: Register `prdfy codebase sync`.**

Support required `--project-id` and `--sync-token`, optional repository root and output mode, clear install/version/auth errors, and exit nonzero on incomplete sync. Do not call `process.exit` from pure helpers.

- [ ] **Step 6: Run CLI tests/build.**

Run: `pnpm vitest run packages/cli/src/lib/api-client.test.ts packages/cli/src/lib/sync-client.test.ts packages/cli/src/commands/codebase.test.ts`; then `pnpm --dir packages/cli build`

Expected: PASS and CLI build succeeds.

- [ ] **Step 7: Commit the CLI transport.**

```bash
git add packages/cli/src/index.ts packages/cli/src/lib packages/cli/src/commands/codebase.ts packages/cli/src/commands/codebase.test.ts
git commit -m "feat: add codebase sync CLI command"
```

## Task 4: Add sync credential/session API and lifecycle

**Files:**
- Create: `src/routes/api/codebase/$projectId/session.ts`
- Create: `src/routes/api/codebase/$projectId/status.ts`
- Create: `src/routes/api/v1/projects/$id/codebase/sync.ts`
- Modify: `src/lib/codebase-sync.ts`
- Test: route/helper tests under `src/routes/api/**` and `src/lib/**`

**Interfaces:**
- Browser session endpoint returns `SyncPromptPayload` and never returns a stored raw credential after initial creation.
- CLI session endpoint authenticates the short-lived token and returns the bound attempt/snapshot IDs.
- Status endpoint returns status, timestamps, counts, safe error code/message, and analysis ID when available.

- [ ] **Step 1: Write failing tests for credential/session security.**

Cover user ownership, project mode, expiration, hash-only persistence, one-time/retry semantics, revocation, wrong project binding, missing scope, rate limiting, and safe error responses.

- [ ] **Step 2: Run focused tests and verify failure.**

Run: `pnpm vitest run src/lib/codebase-sync.test.ts`

Expected: FAIL for unimplemented handlers/helpers.

- [ ] **Step 3: Implement browser session creation and revoke/retry semantics.**

Generate cryptographically random raw credentials, store only hashes, create an attempt record, expose the prompt payload once, and make expiration/revocation explicit.

- [ ] **Step 4: Implement CLI session handshake and status reads.**

Bind every request to user/project/session, use dedicated sync capability checks, and ensure safe status errors do not echo tokens or source data.

- [ ] **Step 5: Run focused route/security tests.**

Run: `pnpm vitest run src/lib/codebase-sync.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit session lifecycle.**

```bash
git add src/routes/api/codebase src/routes/api/v1/projects src/lib/codebase-sync.ts src/lib/*.test.ts
git commit -m "feat: add project-scoped codebase sync sessions"
```

## Task 5: Add manifest/file upload and atomic snapshot completion

**Files:**
- Create: `src/routes/api/v1/projects/$id/codebase/manifest.ts`
- Create: `src/routes/api/v1/projects/$id/codebase/files.ts`
- Create: `src/routes/api/v1/projects/$id/codebase/complete.ts`
- Modify: `src/lib/codebase-sync.ts`
- Test: API route/helper tests for manifest, file chunks, completion

**Interfaces:**
- Manifest and file endpoints accept bounded, validated chunks tied to a session attempt and idempotency key.
- Completion atomically verifies expected counts/hashes and transitions the snapshot to `uploaded`.
- Failed/partial snapshots cannot be used by analysis or generation context.

- [ ] **Step 1: Write failing tests for payload and idempotency rules.**

Cover oversized payloads, invalid paths, duplicate chunks, mismatched hashes, excluded files, wrong session, missing chunks, completion replay, and project ownership.

- [ ] **Step 2: Run focused tests to verify failure.**

Run: `pnpm vitest run src/lib/codebase-sync.test.ts`

Expected: FAIL for missing handlers/validation.

- [ ] **Step 3: Implement manifest and bounded source-context storage.**

Persist normalized metadata and source content according to the retention decision in this plan. Use server constants for all limits and avoid loading the entire request body into unrestricted memory.

- [ ] **Step 4: Implement atomic completion and safe status events.**

Verify uploaded data against manifest identity, mark the snapshot uploaded once, and transition the sync attempt to `uploaded` only after completion succeeds.

- [ ] **Step 5: Run focused tests.**

Run: `pnpm vitest run src/lib/codebase-sync.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit snapshot transport.**

```bash
git add src/routes/api/v1/projects src/lib/codebase-sync.ts src/lib/*.test.ts drizzle
git commit -m "feat: persist filtered codebase snapshots"
```

## Task 6: Add server-side codebase analysis and polling UI

**Files:**
- Create: `src/routes/api/v1/projects/$id/codebase/analysis.ts`
- Create: `src/routes/codebase/$id.tsx`
- Create: `src/components/codebase/sync-agent-modal.tsx`
- Create: `src/components/codebase/sync-status.tsx`
- Create: `src/components/codebase/codebase-review.tsx`
- Modify: `src/routes/api/codebase/$projectId/status.ts`
- Test: component and analysis route tests

**Interfaces:**
- `requestCodebaseAnalysis(projectId: string, snapshotId: string): Promise<CodebaseAnalysis>` validates the snapshot and stores schema-validated output.
- `SyncStatusResponse` drives polling and retry UI.
- The modal consumes `SyncPromptPayload` and provides copy/close/retry actions without exposing credential outside the textarea copy action.

- [ ] **Step 1: Write failing tests for analysis validation and UI states.**

Cover uploaded-only analysis, invalid model JSON, analysis failure, ready review, expired session, retry, refresh persistence, and greenfield route non-entry.

- [ ] **Step 2: Run focused tests to verify failure.**

Run: `pnpm vitest run src/lib/codebase-analysis.test.ts`

Expected: FAIL for missing orchestration/UI helpers.

- [ ] **Step 3: Implement analysis service using existing AI fallback/orchestration patterns.**

Use the feature prompt and snapshot context. Validate model output before persistence. Label uncertainty rather than inventing architecture or paths.

- [ ] **Step 4: Implement polling and modal/status/review screens.**

Poll persisted status using a constant interval. Display actual state, timestamps, counts, and safe errors. Use indeterminate loading when no measured progress exists.

- [ ] **Step 5: Run focused tests and application typecheck.**

Run: `pnpm vitest run src/lib/codebase-analysis.test.ts`; then `pnpm check`

Expected: PASS with no new lint/type errors.

- [ ] **Step 6: Commit analysis and UI.**

```bash
git add src/routes/codebase src/routes/api/codebase src/routes/api/v1/projects src/components/codebase src/lib/codebase-analysis.ts src/lib/*.test.ts
git commit -m "feat: add codebase analysis review flow"
```

## Task 7: Integrate existing-codebase mode into Home and project lifecycle

**Files:**
- Modify: `src/components/layout/chat-input.tsx`
- Modify: `src/routes/api/projects/index.ts`
- Modify: `src/routes/api/projects/$id.ts`
- Modify: `src/routes/ask/$id.tsx`
- Test: Home/project route tests and greenfield regression tests

**Interfaces:**
- Project creation accepts validated mode and returns project identity without weakening existing authentication/credit checks.
- Existing-codebase creation routes to sync; greenfield creation routes to `/ask/$id` exactly as before.

- [ ] **Step 1: Write failing tests for both creation modes.**

Cover mode validation, default greenfield behavior, existing-codebase session creation, unauthorized creation, credit precheck behavior, and project deletion cleanup.

- [ ] **Step 2: Run focused tests to verify failure.**

Run: `pnpm vitest run src/routes src/components/layout`

Expected: FAIL for the new mode and routing behavior.

- [ ] **Step 3: Add Home mode selector and project payload.**

Preserve existing prompt validation, language/platform handoff, session behavior, and credit checks. Add only the existing-codebase branch after the project response.

- [ ] **Step 4: Add project mode/session creation and transactional deletion cleanup.**

Ensure all sync child records are deleted only after ownership is verified and within the existing transaction.

- [ ] **Step 5: Run focused tests/check.**

Run: `pnpm vitest run src/routes src/components/layout`; then `pnpm check`

Expected: PASS and greenfield behavior remains unchanged.

- [ ] **Step 6: Commit Home/lifecycle integration.**

```bash
git add src/components/layout/chat-input.tsx src/routes/api/projects src/routes/ask src/routes/**/*.test.*
git commit -m "feat: add existing codebase project mode"
```

## Task 8: Persist Ask handoff and inject context into PRD, AC, and Task

**Files:**
- Modify: `src/app/ask/ask-flow.tsx`
- Modify: `src/routes/api/ask/options.ts`
- Modify: `src/routes/api/chat.ts`
- Modify: `src/routes/api/ac/generate.ts`
- Modify: `src/routes/api/task/generate.ts`
- Modify: `src/lib/codebase-generation-context.ts`
- Test: Ask, PRD, AC, Task context tests and greenfield regression tests

**Interfaces:**
- `getProjectGenerationContext(projectId: string): Promise<GenerationContext | null>` returns null for greenfield projects and a snapshot-bound context for ready existing-codebase projects.
- Each generator consumes the same validated context builder rather than duplicating snapshot queries or formatting.

- [ ] **Step 1: Write failing tests for context selection and prompt injection.**

Cover greenfield null context, existing-codebase ready context, missing/failed analysis rejection, snapshot identity propagation, prompt size limiting, uncertain analysis labeling, and no extra credit consumption for sync/revision.

- [ ] **Step 2: Run focused tests to verify failure.**

Run: `pnpm vitest run src/lib/codebase-generation-context.test.ts src/lib/services`

Expected: FAIL for missing context builder/integration.

- [ ] **Step 3: Persist Ask answers/compiled prompt server-side for existing-codebase projects.**

Keep existing sessionStorage for UI continuity where useful, but save the authoritative handoff/context before PRD generation so refresh and multi-device access do not lose answers.

- [ ] **Step 4: Inject bounded, snapshot-bound context into Ask/PRD/AC/Task.**

Use one formatting boundary. Never pass arbitrary unbounded source content into every prompt. Include relevant paths and constraints, mark uncertainty, and preserve revision patch protocol.

- [ ] **Step 5: Run focused tests/check.**

Run: `pnpm vitest run src/lib/codebase-generation-context.test.ts src/lib/services`; then `pnpm check`

Expected: PASS with greenfield prompt behavior unchanged.

- [ ] **Step 6: Commit pipeline integration.**

```bash
git add src/app/ask src/routes/api/ask src/routes/api/chat.ts src/routes/api/ac src/routes/api/task src/lib/codebase-generation-context.ts src/lib/*.test.ts
git commit -m "feat: ground generation in existing codebase context"
```

## Task 9: Add end-to-end integration, privacy documentation, and hardening

**Files:**
- Create/modify: `e2e/existing-codebase-sync.spec.ts`
- Modify: `README.md`
- Modify: `packages/cli/src/commands/codebase.test.ts`
- Modify: relevant server/API tests
- Modify: `.env.example` only if a new configurable server setting is required

- [ ] **Step 1: Write E2E scenarios.**

Cover existing-codebase Home mode, sync modal, persisted status, analysis review, contextual Ask, PRD entry, session expiry, retry, and greenfield regression. Use test fixtures with neutral placeholder source content and fake credentials that cannot be valid production secrets.

- [ ] **Step 2: Run E2E tests and record environment blockers.**

Run: `pnpm exec playwright test e2e/existing-codebase-sync.spec.ts`

Expected: PASS when the local app/database/test AI setup is available; otherwise record the concrete environment blocker without weakening tests.

- [ ] **Step 3: Document CLI installation, sync, `.prdfyignore`, privacy, retention, and recovery.**

Document the actual command and flags implemented by the CLI, not draft placeholders. Explain that sync sends included source context to PrdFy and that `.prdfyignore` supplements built-in protection.

- [ ] **Step 4: Run complete verification.**

Run:

```bash
pnpm check
pnpm vitest run
pnpm exec playwright test
pnpm build
pnpm --dir packages/cli build
```

Expected: all available checks pass. Any unavailable external service or database must be reported with the exact command/output and not hidden.

- [ ] **Step 5: Perform security review.**

Verify no raw sync credential, source content, or secret value appears in logs, error responses, generated prompt outside intended payload, test fixtures, or committed files. Verify project ownership on every browser and CLI route, and verify project deletion removes project-owned sync data.

- [ ] **Step 6: Commit hardening/documentation.**

```bash
git add e2e README.md packages/cli src drizzle .env.example
git commit -m "test: harden existing codebase sync flow"
```

## Verification Checklist

- [ ] Greenfield project creation and generation remain behaviorally compatible.
- [ ] Existing-codebase project receives a unique expiring sync session.
- [ ] Prompt includes CLI check/install, `.prdfyignore` review, and official sync command.
- [ ] CLI never sends built-in excluded files or content-detected secrets.
- [ ] CLI never sends absolute paths or external symlink targets.
- [ ] Sync retries are idempotent and partial snapshots cannot reach analysis.
- [ ] Browser refresh restores persisted sync state.
- [ ] Analysis is only generated from a completed snapshot.
- [ ] Ask/PRD/AC/Task use the same snapshot-bound context builder.
- [ ] Sync/analysis do not consume generation credits.
- [ ] Project deletion cleans project-owned sync records transactionally.
- [ ] CLI and server tests cover security, limits, failures, and path behavior.
- [ ] `pnpm check`, `pnpm vitest run`, Playwright, app build, and CLI build results are recorded.
