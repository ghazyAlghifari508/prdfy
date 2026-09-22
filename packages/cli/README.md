# @ghazynabiel/prdfy

Official command-line interface for [PrdFy](https://github.com/ghazyAlghifari508/prdfy).

## Installation

```bash
npm install -g @ghazynabiel/prdfy
```

Check version:

```bash
prdfy --version
```

Minimum version required for existing codebase sync is **2.0.0**.

## Commands

### Codebase Sync

Synchronize a filtered repository snapshot to PrdFy for existing-codebase project planning:

```bash
prdfy codebase sync --project-id <id> --sync-token <token>
```

#### Options

- `--project-id <id>`: Project UUID (required)
- `--sync-token <token>`: Project-scoped temporary sync token (required)
- `--root <path>`: Repository root. Detected automatically when omitted.
- `--output <mode>`: Output format (`human` or `json`, default: `human`)
- `--api-url <url>`: PrdFy server base URL (default: `http://localhost:3000`)

#### Automatic preparation

The CLI performs every preparation step; the agent prompt only requests the
sync. Running the command from a subdirectory is safe.

- **Repository root** — an explicit `--root` wins. Otherwise the CLI walks up
  to the nearest ancestor containing a `.git` entry (a file counts, so
  worktrees and submodules resolve). Without any marker it falls back to the
  current directory.
- **`.prdfyignore`** — created from the default template when missing, and
  never overwritten. The file is local sync configuration; the CLI does not
  run git, so it is never committed or pushed automatically.
- **Version** — the server advertises its minimum version during handshake and
  the CLI fails closed when it is too old. When the running version is below
  that minimum, the notice and the exact upgrade command are printed.
- **Ignore validation** — negation patterns (`!pattern`) are inert and are
  reported as a warning, because user rules must never lift the built-in
  secret and unsafe-path protection.

### Filtering & `.prdfyignore`

The CLI automatically excludes:
- Environment variables and secrets (`.env*`, `*.pem`, `*.key`, `*.p12`)
- Dependency and build folders (`node_modules/`, `dist/`, `build/`, `coverage/`, `.git/`)
- Binary files and SQLite/local database files
- Its own `.prdfyignore` control file

Custom exclusions can be added to `.prdfyignore` in your repository root. The
file is created for you on the first sync with the built-in coverage documented
in its header, so you only add repository-specific patterns.

### Authentication for Task Management

For general task and kanban tracking:

```bash
prdfy login --api-key <your-api-key>
```

### Projects, Tasks, and Kanban

```bash
prdfy project get <projectId>
prdfy prd <projectId>
prdfy ac <projectId>
prdfy task list <projectId> [--status <status>]
prdfy task next <projectId>
prdfy task update <taskId> --status <status>
prdfy subtask update <taskId> --index <index> --status <status>
prdfy kanban <projectId>
prdfy export rules <projectId> [--format agents|claude|cursor]
```
