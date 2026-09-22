# Existing Codebase Sync — UX Rework Design

Supersedes the prompt/ignore/preparation portions of
`2026-09-19-existing-codebase-sync-design.md`. Transport, snapshot,
completion, analysis, and generation-context design remain unchanged.

## Problem

The sync flow reads like an AI handed a long list of technical steps. Three
concrete root causes were verified in the repository, not inferred.

### 1. Prompt generator diverged from the approved flow design

`src/components/codebase/sync-agent-modal.tsx` renders a robotic four-step
checklist ("Langkah 1 — Cek CLI … Langkah 4 — Pastikan kamu berada di root
repositori"). The approved flow document `existing-codebase-flow.html` already
specifies an objective-oriented prompt:

> Hubungkan codebase ini ke project PrdFy saya. Gunakan PrdFy CLI untuk
> menganalisis struktur repository, mendeteksi stack, dan melakukan sync
> codebase. Jangan mengubah file aplikasi. Abaikan secrets, dependencies,
> build output, dan file binary.

The implementation drifted from the design. `Langkah 1` and `Langkah 2` also
emit the same `npm i -g @ghazynabiel/prdfy` command twice.

### 2. The prompt carries logic the CLI already owns

Minimum-version enforcement already runs in two places: the CLI handshake
(`packages/cli/src/lib/sync-client.ts`, `CLI_UPDATE_REQUIRED`) and the server
(`src/lib/codebase-sync.ts`, `requireSupportedCliVersion`). A prompt step
telling the agent to compare versions duplicates a gate it cannot enforce and
that already fails closed.

### 3. `.prdfyignore` is never created

`readPrdfyIgnore` returns empty patterns on `ENOENT` and never writes.
`ignore.test.ts` asserts that "missing … without creating it". No template
constant exists anywhere in the repository. Users are told to "tinjau file
`.prdfyignore`" for a file that usually does not exist.

### Secondary findings

- **No repository-root detection.** `--root` falls back to `process.cwd()`. An
  agent launched from a subdirectory scans the wrong tree with no warning.
- **Negation patterns fail silently.** `readPrdfyIgnore` drops `!pattern` with
  no user-visible feedback.
- **Prompt generator lives in dead code.** `SyncAgentModal` has zero
  non-test references; the live screen `screen-connect.tsx` imports
  `buildAgentPrompt` out of the unused modal component.
- **Status checklist labels do not match their signals.** In
  `sync-status.tsx`, items 2 and 3 ("Package manifest dan framework dibaca",
  "Secrets dan generated files dikecualikan") are driven by `fileCount` /
  `excludedCount`, which reach the client only at completion. The client never
  observes scan or manifest stages, so two items sit permanently in a
  pending-looking state and then flip together.

## Constraints

- Upload transport, manifest DTOs, chunking, completion verification,
  idempotency, and the sync session lifecycle do not change.
- No absolute local paths in any upload payload.
- One source of truth for the `.prdfyignore` template.
- The CLI owns preparation; the prompt only requests synchronization.
- No hardcoded ignore lists or paths in UI copy.

## Design

### 1. Prompt generator

Relocate `buildAgentPrompt` from the dead modal component into
`src/lib/codebase-sync.ts`, beside `buildSyncCommand` and the
`SyncPromptPayload` type it consumes. This is the same category of
payload-to-string helper, keeps one source of truth, and removes the wrong
dependency edge (a live screen importing from an unused component).

`SyncAgentModal` keeps a one-line re-export so its existing accessibility tests
are not deleted. Removing the dead component is a separate change and is out of
scope here.

New prompt shape:

```text
Sinkronkan codebase repositori ini ke project PrdFy.

Project ID: <projectId>
Server: <apiBaseUrl>
Sync Token: <syncToken>
Berlaku sampai: <expiresAt>

Dari dalam root repositori, jalankan:

prdfy codebase sync --project-id <projectId> --sync-token <syncToken>

PrdFy CLI belum terpasang? npm i -g @ghazynabiel/prdfy

Yang ditangani CLI secara otomatis: deteksi root repositori, pembuatan
.prdfyignore bila belum ada, eksklusi file rahasia dan build, validasi versi
minimum.

Batasan:
- Jangan mengubah source code, membuat commit, atau push.
- Jangan menulis Sync Token ke file, log, atau commit.
- Laporkan keluaran CLI apa adanya. Jangan menyatakan sukses tanpa keluaran CLI
  yang sukses.
```

Removed: numbered step scaffolding, version-minimum numbers, the
`.prdfyignore` review instruction, and the enumerated exclusion list (a
hardcoded ignore list in the UI, explicitly forbidden).

Retained: Project ID, Sync Token, Server, expiry, security rules, and the
install command as a single precondition line so an agent that has never seen
`prdfy` is not stranded on `command not found`.

The install line states *install*, never *verify a specific version* — the
version gate stays entirely in the CLI.

### 2. Auto-create `.prdfyignore`

`readPrdfyIgnore` stays read-only, so the existing test remains true and is not
weakened. A separate mutating function is added to
`packages/cli/src/lib/ignore.ts`:

- `PRDFY_IGNORE_TEMPLATE` — the single source of truth.
- `ensurePrdfyIgnore(root): Promise<{ created: boolean }>` — checks existence,
  writes the template only when missing, never overwrites.

Template content is an explanatory header plus commented-out example patterns.
It contains **no active patterns**: built-in exclusions already cover secrets,
build output, and binaries, and a template with active rules would silently
change which files are uploaded.

Two deliberate boundaries:

- **`.gitignore` is never touched.** Appending `.prdfyignore` to a tracked file
  would itself be a tracked-repository mutation that a user could commit. The
  CLI never invokes git, so "never auto-commit or auto-push" holds by
  construction.
- **The repository root is never added to the JSON output.** `manifest.ts`
  deliberately keeps absolute paths out of payloads; adding `root` to the JSON
  contract would reintroduce one. The root prints in human output only.

### 3. CLI preparation flow

New order in `packages/cli/src/commands/codebase.ts`:

```text
resolve root (explicit --root > nearest ancestor with .git > cwd)
→ ensure .prdfyignore
→ read .prdfyignore (warn on dropped negations)
→ scan → manifest
→ blocked-content refusal
→ handshake (update notice from server cliMinVersion)
→ manifest batches → file chunks → completion
→ human summary
```

**Root detection** lands in `packages/cli/src/lib/repository.ts`. An explicit
`--root` wins; otherwise walk up to the nearest ancestor containing a `.git`
entry, treating a file or a directory as a match so worktrees and submodules
resolve; otherwise keep `cwd`. Implemented with `node:fs`/`node:path` only. The
CLI currently uses zero `child_process`, and shelling out to
`git rev-parse` would add failure modes (git absent, not on `PATH`, output
encoding, exit-code handling). The walk-up is deterministic and needs no new
dependency.

**Ignore validation** surfaces dropped `!negation` lines as a warning, since
today they fail silently. Negations stay inert: user rules must never lift
built-in secret protection.

**Update notice** is driven solely by the server's `cliMinVersion` from the
handshake. No npm-registry call, no new network dependency, no false urgency.
The CLI prints its own version plus the exact upgrade command.

**Summary** reports the root, whether `.prdfyignore` was created, included and
excluded counts, bytes uploaded, snapshot id, and the real persisted status. No
percentages and no invented stages.

### 4. Sync status UX

Replace the five-item pseudo-staged checklist with three stages, each mapped to
a signal the client can actually observe, matching `CODEBASE_SYNC_STATUSES`:

| Stage | Real signal |
|---|---|
| CLI terhubung | session has left `waiting_for_cli` |
| Upload snapshot | status is `uploading` or later |
| Analisis codebase | `analysisStatus` is pending/ready/failed |

`scanning` and `filtering` are not presented as user-facing stages:
`codebase-sync.ts` documents that the CLI never reports them and the server
walks them as bookkeeping. A phase with no real signal gets one honest neutral
label, never an invented sequence. Counts render only when the server has
actually returned them.

## Behavior matrix

| State | Behavior |
|---|---|
| `.prdfyignore` absent | created from template; root reported as created |
| `.prdfyignore` present | left byte-identical; reported as existing |
| Running in a subdirectory | resolves to repository root via `.git` walk-up |
| Explicit `--root` | wins over detection |
| No `.git` anywhere | falls back to `cwd` |
| `!negation` in `.prdfyignore` | warned, treated as inert |
| CLI below server minimum | existing non-retryable `CLI_UPDATE_REQUIRED` plus upgrade command |
| Secret content matched | existing refusal; no upload, no secret value surfaced |
| Snapshot too large | existing `SNAPSHOT_TOO_LARGE` failure |
| Zero eligible files | existing empty-batch completion path |
| Sync failed / expired | existing retry mints a new session |
| JSON output mode | no absolute path added to the payload |

## Testing

- **New**: `ensurePrdfyIgnore` creates from template; is idempotent; never
  overwrites existing content; template contains no active patterns.
- **New**: root detection — subdirectory, `.git`-as-file worktree, no git,
  explicit `--root` precedence.
- **New**: negation warning.
- **New**: prompt content — includes Project ID, Sync Token, Server, sync
  command, and security rules; excludes version numbers and any enumerated
  ignore list.
- **Updated, not weakened**: `codebase.test.ts` `excludedCount` moves `0 → 1`,
  because `.prdfyignore` now exists during the scan and is genuinely excluded
  as `built-in:ignore-file`. An assertion is added that it is never uploaded.
- **Existing UI tests** for `sync-status` continue to pass: the stages they
  assert (uploading, uploaded counts, ready, failed, expired, analysis retry)
  are preserved.
- **Browser verification**: `e2e/sync-ux-verify.spec.ts` mounts the shipped
  components in a real browser through the dev server's module graph and
  asserts the three real-signal stages, the absence of `memindai`/`filtering`
  bookkeeping labels, the absence of a fabricated percentage, and the new
  objective-oriented prompt. Kept as a permanent regression test.
- **CLI end-to-end**: real `prdfy codebase sync` runs proved root detection
  from a subdirectory, `.prdfyignore` creation at the repository root (not the
  subdirectory), idempotency on re-run, the negation warning, explicit
  `--root` precedence, and that JSON output carries no absolute local path.

## Out of scope

- Removing the now-unused `SyncAgentModal` component.
- Any change to transport, completion verification, or idempotency.
- npm-registry update checking.
- `.gitignore` modification.
