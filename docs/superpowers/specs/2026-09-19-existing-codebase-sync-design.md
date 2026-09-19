# Existing Codebase Sync Design

**Status:** Draft for review  
**Scope:** MVP for codebase-aware PRD, Acceptance Criteria, and Task generation

## Goal

Allow a PrdFy user to start a project from an existing local codebase without uploading a ZIP. An external AI coding agent runs locally, invokes the PrdFy CLI, and the CLI sends a filtered, project-scoped codebase snapshot to PrdFy for server-side analysis. The existing greenfield flow remains unchanged.

## Product Model

PrdFy supports two project modes:

```text
greenfield
  Home → prompt → Ask → PRD → AC → Task → Kanban

existing_codebase
  Home → feature prompt → sync session → AI-agent prompt
  → CLI sync → codebase analysis review → contextual Ask
  → PRD → AC → Task → Kanban
```

The AI coding agent is never executed by the PrdFy server. The agent runs on the user's machine and is instructed to invoke the local CLI. The CLI is the deterministic boundary for filesystem access, filtering, hashing, transport, and sync status. PrdFy owns snapshot storage, analysis, and generation context.

## MVP Scope

### Included

- A `Codebase existing` mode on the Home project composer.
- A project mode persisted at creation time.
- A project-scoped sync session created after the project is created.
- A generated modal prompt for Claude Code, Cursor, Windsurf, Copilot, or another external AI agent.
- CLI installation/version check instructions in the prompt.
- CLI command for syncing the local repository.
- `.prdfyignore` creation/review instructions in the prompt.
- Built-in CLI protection for secrets and unsafe paths.
- Repository manifest and filtered source-context upload.
- Initial snapshot persistence and snapshot metadata.
- Real sync status updates through polling or server events; no fabricated progress.
- Server-side codebase analysis after a successful snapshot.
- Analysis review before contextual questions.
- Codebase context passed to Ask options, PRD, AC, and Task generation.
- Retry/recovery for expired sessions, interrupted uploads, and failed analysis.
- Unit, integration, CLI, and browser-level verification for the new flow.

### Explicitly excluded from MVP

- ZIP upload.
- GitHub/GitLab/Bitbucket integration.
- Server-side execution of an AI coding agent.
- Automatic source-code edits, commits, or pull requests.
- Continuous background sync.
- Multi-repository projects.
- Full source-code mirror as a general-purpose repository backup.
- Automatic task completion based only on uploaded source files.
- Automatic regeneration after every sync.

## User Flow

### 1. Home

The existing Home composer gains a mode selector:

```text
Produk baru | Codebase existing
```

In `greenfield` mode, the current behavior is preserved.

In `existing_codebase` mode, the same feature prompt is required. The prompt describes the feature the user wants to plan, not the repository itself. Creating the project sends the selected mode with the prompt to the existing project creation boundary.

### 2. Project and sync session creation

The server creates the project first, then creates a short-lived sync session for that project. The sync session contains a one-time or narrowly bounded credential used only by the CLI for this project.

The browser receives a prompt payload containing:

- project identifier;
- API base URL;
- sync session credential;
- CLI minimum version;
- the official sync command syntax;
- expiration timestamp.

The raw credential is never persisted in the repository, `.prdfyignore`, generated rules, or source files. The browser may display it inside the copyable prompt because the user intentionally transfers it to the local agent, but the session must expire and be revocable.

### 3. AI-agent prompt

The generated prompt instructs the external agent to:

1. Confirm it is running from the repository root.
2. Report the path, active branch, and working-tree state.
3. Check whether the required PrdFy CLI is installed.
4. Install the official CLI package if it is missing, then verify the version.
5. Create or review `.prdfyignore`.
6. Show exclusion rules and wait for user confirmation before syncing.
7. Run the official codebase sync command using the project-scoped credential.
8. Avoid changing application source code, creating commits, or pushing changes.
9. Report the actual CLI result and never claim success without a successful CLI response.

The prompt is guidance for the external agent. It is not a security boundary. The CLI and server independently enforce filtering, authentication, authorization, and validation.

### 4. `.prdfyignore`

`.prdfyignore` is a user-visible repository-level ignore file. The agent may create it if absent and must preserve existing rules. It can exclude repository-specific code, such as private internal modules or customer fixtures.

The CLI always applies built-in exclusions in addition to `.prdfyignore`. User rules cannot override built-in protection for secrets and unsafe paths.

Built-in exclusions include:

```text
.git/
.env
.env.*
*.pem
*.key
*.p12
*.pfx
credentials/
secrets/
node_modules/
dist/
build/
coverage/
database dumps and local database files
backup files
binary files
```

The CLI must also reject likely credentials by content/pattern where practical. It must report the path and reason for exclusion without printing the secret value.

The first MVP does not automatically commit `.prdfyignore`. The agent must not commit or push it. The user can decide separately whether to keep or commit the file.

### 5. CLI sync

The CLI reads the repository from the current working directory, normalizes relative paths, applies built-in rules and `.prdfyignore`, and sends a snapshot to the sync API.

The sync payload contains:

- repository-relative manifest entries;
- normalized path;
- file size;
- detected language where available;
- content hash;
- safe source content for included files;
- branch and commit metadata when available;
- CLI version;
- exclusion summary;
- sync session identifier.

The CLI must not send absolute local paths, files outside the repository root, symlink targets outside the root, or excluded file contents.

The initial MVP may send the filtered snapshot in bounded chunks. The transport must be resumable at the logical sync level: retrying the same session must not create duplicate snapshots or corrupt a partial snapshot.

### 6. Analysis

After the server accepts the snapshot, it creates a codebase analysis from the feature prompt and snapshot context. Analysis output includes:

- detected framework and language;
- package manager and major dependencies;
- database and authentication context when detected;
- repository/module map;
- relevant files and modules;
- potential impact areas;
- known limitations and uncertain detections;
- analysis snapshot identifier.

The analysis is advisory. The UI must communicate uncertainty and allow the user to review before generation.

### 7. Review and Ask

The user sees the analysis review page before entering Ask. The page provides:

- detected environment;
- repository map;
- excluded-file summary without sensitive contents;
- potential impact areas;
- sync timestamp and snapshot identifier;
- retry sync action;
- retry analysis action;
- continue action.

The existing Ask UI is reused with existing-codebase context. Questions may refer to detected architecture, current authentication, persistence, modules, and impact areas. The generated answers and feature prompt must be durably associated with the project before later generation so a refresh does not lose the flow.

### 8. PRD, AC, and Task

The generated context for every stage includes:

```text
feature request
user answers
codebase analysis
relevant module/file paths
known constraints
source snapshot identifier
```

The model must be instructed not to invent file paths, framework behavior, or architecture details that are not present in the analysis. Uncertain findings must be labeled as assumptions or verification items.

PRD output should include a codebase-aware technical scope and impacted areas. AC output should validate behavior against the existing application boundaries. Task output should identify relevant modules/files when the analysis supports that level of precision.

Existing credit semantics remain unchanged: one credit per generate action, revisions remain free, and the sync/analysis operation itself does not consume a PRD/AC/Task credit unless the existing product rules are explicitly changed later.

## Sync State Machine

The server persists only valid transitions:

```text
waiting_for_cli
  → connected
  → scanning
  → filtering
  → uploading
  → uploaded
  → analyzing
  → ready

Any active state → failed
waiting_for_cli → expired
failed → retrying → scanning or uploading
```

Terminal states are `ready`, `failed`, and `expired`. A retry creates a new attempt under the same project and does not mutate a completed snapshot. The UI displays actual state and timestamps. If the server has no measurable percentage, it displays an indeterminate status rather than a fabricated percentage.

## Data Model

The implementation should add project-owned records with explicit foreign keys and indexes. Exact table names and column types will be finalized in the implementation plan against the existing Drizzle conventions.

### Project fields

The project needs a mode that distinguishes `greenfield` from `existing_codebase`. Existing projects must retain their current behavior through a safe default.

### Sync session

Stores:

- session ID;
- project ID and owner ID;
- credential hash, never the raw credential;
- status;
- expiration and consumed timestamps;
- CLI minimum version;
- current attempt metadata;
- created and updated timestamps.

### Snapshot

Stores:

- snapshot ID;
- project and sync session IDs;
- repository metadata that is safe to retain;
- branch and commit metadata;
- manifest and source-context storage references;
- file counts and excluded counts;
- content/storage size;
- snapshot status;
- created timestamp.

### Analysis

Stores:

- analysis ID;
- project and snapshot IDs;
- structured analysis output validated at the boundary;
- analysis status and error information;
- created and updated timestamps.

Generated PRD/AC/Task records must be traceable to the analysis/snapshot used for generation. If changing existing version tables is too disruptive for MVP, a separate generation-context relation may be used rather than silently changing existing semantics.

Project deletion must remove or explicitly retain every project-owned sync/session/snapshot/analysis record according to the final retention policy. The deletion operation must remain ownership-checked and transactional.

## API Contract

The implementation will extend the existing CLI-facing `/api/v1` boundary rather than adding ad-hoc fetch calls from command modules.

The contract must provide operations for:

- creating or accepting a sync attempt;
- reporting sync state;
- uploading manifest metadata;
- uploading bounded source-context chunks;
- completing a snapshot atomically;
- reading sync status from the browser;
- requesting or recording analysis;
- retrying a failed attempt.

Every request must enforce:

- Bearer authentication;
- dedicated sync scope;
- project ownership through the authenticated API-key owner;
- session/project binding;
- request size limits;
- content and path validation;
- rate limits;
- idempotency for retries.

New sync scopes must be narrower than the existing wildcard/admin behavior. A sync credential must not automatically grant task mutation or unrelated project access.

## Authentication and Credential Policy

The current long-lived automatic API-key flow must not be reused as the only authorization mechanism for initial codebase upload. The sync flow uses a project-scoped, expiring credential whose server-side representation is hashed.

Required properties:

- cryptographically random;
- project-scoped;
- user-scoped through the project;
- time-limited;
- revocable;
- one active session credential per attempt unless retry policy explicitly allows reuse;
- never returned after initial prompt generation;
- rejected after session completion or expiry;
- rate limited;
- excluded from logs and error bodies.

The existing API-key mechanism remains available for ordinary CLI project/task commands. Sync authorization is a separate capability and must not broaden existing auto-key scopes.

## Failure and Recovery

The system must provide explicit recovery for:

- CLI not installed;
- CLI version below minimum;
- invalid or expired sync credential;
- wrong repository root;
- unreadable file;
- secret detection;
- repository too large;
- network interruption;
- partial upload;
- duplicate retry;
- analysis timeout or model failure;
- browser refresh or navigation during sync;
- user opening the project on another device.

The browser can reload sync status from the server. The CLI can retry safe requests using the same attempt/idempotency identity. A failed snapshot is not exposed as ready analysis context.

## Privacy and Retention

The MVP must document that included source context is sent to and stored by PrdFy for project analysis. The implementation must define:

- which snapshot data is retained;
- how a user deletes a snapshot/project;
- whether raw source content is retained after analysis;
- whether analysis can be regenerated from an existing snapshot;
- maximum snapshot size;
- server-side logs that must never include source content or credentials.

If raw source retention is not required for MVP, the preferred design is to retain only the minimum source context needed for regeneration and analysis, with explicit deletion support. This decision must be finalized before storage implementation.

## Testing Strategy

### CLI unit tests

- built-in exclusion rules;
- `.prdfyignore` parsing;
- secret detection without secret-value output;
- path normalization and traversal rejection;
- symlink escape rejection;
- deterministic manifest hashing;
- changed and excluded file counts;
- chunk/request formation;
- retry and idempotency behavior;
- human and JSON output;
- no source mutation.

### Server tests

- sync credential creation, hashing, expiry, and revocation;
- scope and project ownership enforcement;
- valid and invalid state transitions;
- payload and path validation;
- size and rate limits;
- idempotent retries;
- snapshot completion atomicity;
- project deletion cleanup;
- analysis input validation;
- generation context selection.

### Integration and E2E tests

- CLI-to-test-server sync;
- initial sync with `.prdfyignore`;
- retry after interrupted upload;
- expired session recovery;
- Home existing-codebase mode through analysis review;
- contextual Ask through PRD generation;
- greenfield regression flow;
- responsive sync modal and analysis review;
- no credential or excluded source content in request logs/response errors.

## Compatibility and Non-Goals

- Existing greenfield projects default to `greenfield` and do not enter sync flow.
- Existing CLI commands remain compatible.
- Existing PRD/AC/Task credit rules remain unchanged.
- The CLI must continue to work on supported modern Node versions and Windows, macOS, and Linux path conventions.
- No source code is edited by the sync command.
- No implementation completion is inferred solely from a sync snapshot.

## Required Decisions Before Implementation Plan

The following must be answered in the implementation plan or explicitly selected as MVP defaults:

1. Whether raw included source content is retained after analysis or minimized/deleted.
2. Exact maximum snapshot size, per-file size, and request chunk size.
3. Whether sync status uses polling or a server event stream in the first release.
4. Exact CLI command and credential flags.
5. Minimum supported CLI and Node versions.
6. Whether `.prdfyignore` is created only as an uncommitted local file or also offered for commit.
7. How generation context is linked to existing PRD/AC/Task version records without breaking current AC/task behavior.

These are implementation constraints, not reasons to bypass the design. The implementation plan must turn each item into a concrete, tested choice before code changes begin.
