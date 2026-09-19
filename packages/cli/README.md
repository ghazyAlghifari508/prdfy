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
- `--root <path>`: Path to repository root (defaults to `.`)
- `--output <mode>`: Output format (`human` or `json`, default: `human`)
- `--api-url <url>`: PrdFy server base URL (default: `http://localhost:3000`)

### Filtering & `.prdfyignore`

The CLI automatically excludes:
- Environment variables and secrets (`.env*`, `*.pem`, `*.key`, `*.p12`)
- Dependency and build folders (`node_modules/`, `dist/`, `build/`, `coverage/`, `.git/`)
- Binary files and SQLite/local database files

Custom exclusions can be added to `.prdfyignore` in your repository root.

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
