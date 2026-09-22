# PrdFy AI

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff)](#tech-stack)
[![React](https://img.shields.io/badge/React_19-149ECA?logo=react&logoColor=fff)](#tech-stack)
[![TanStack Start](https://img.shields.io/badge/TanStack_Start-FF4154?logo=tanstack&logoColor=fff)](#tech-stack)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_4-06B6D4?logo=tailwindcss&logoColor=fff)](#tech-stack)
[![Postgres](https://img.shields.io/badge/Postgres-4169E1?logo=postgresql&logoColor=fff)](#tech-stack)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle-386641?logo=drizzle&logoColor=fff)](#tech-stack)
[![Better Auth](https://img.shields.io/badge/Better_Auth-0F766E?logo=auth0&logoColor=fff)](#authentication)
[![Biome](https://img.shields.io/badge/Biome-60A5FA?logo=biome&logoColor=fff)](#development)

AI-powered product development planner. Answer a guided flow of questions and PrdFy turns your idea into a full PRD, a set of acceptance criteria (AC), and an executable task kanban board.

## Table of Contents

- [Overview](#overview)
- [How it works](#how-it-works)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Authentication](#authentication)
- [Security](#security)
- [Billing](#billing)
- [Getting Started](#getting-started)
- [Scripts](#scripts)
- [Project Structure](#project-structure)
- [API](#api)
- [Existing Codebase Sync](#existing-codebase-sync)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [FAQ](#faq)
- [Contributing](#contributing)

Built with TanStack Start, React 19, and Vite, backed by Postgres (Drizzle ORM) and a local AI router.

## Why PrdFy

Writing a product spec from scratch is slow and the blank page is hostile. Most ideas die before the first sentence gets written. PrdFy inverts the process: instead of staring at an empty document, you answer a short, guided flow of questions and let the AI assemble the artifact for you.

The output is structured, editable, and versioned, so a one-line idea becomes a reviewable spec in minutes.

## Overview

PrdFy removes the blank page problem. Instead of writing specs from scratch, you answer focused questions about your product, stack, and audience. The AI generates each artifact from the answers, and you can keep revising it in the same flow.

The product pipeline has four stages:

1. **Ask** - answer a guided question flow (tech stack, platform, complexity)
2. **PRD** - a full product requirements document with version history
3. **AC** - acceptance criteria generated per feature
4. **Task** - a kanban board with executable, complexity-scaled tasks

Every stage keeps a revision history, so you can compare versions and re-generate. You never lose a version: the pipeline is append-only per stage.

## How it works

1. **Answer the flow.** Pick a stack (frontend, backend, database, hosting) and toggle between web and mobile. The question count scales to your app's complexity.
2. **Review the PRD.** PrdFy drafts a complete product requirements document with a table of contents and architecture diagrams. Regenerate any section or revise the whole doc.
3. **Approve the AC.** Each feature gets acceptance criteria plus an implementation-options picker, so the team knows both *what* to build and *how* to build it.
4. **Execute on the board.** PrdFy breaks the scope into a kanban board of complexity-scaled tasks. Track status, open task details, and sketch on the whiteboard canvas.

If anything misses the mark, go back a stage. Every revision is saved to version history.

## Features

- Guided question flow with dynamic scaling: subtask and non-tech question counts scale to app complexity
- Cross-block and block-skip support inside the ask flow
- Full PRD generation with mermaid diagrams and a table of contents
- Acceptance criteria viewer with an implementation-options picker
- Kanban board with per-card task details, subtask breakdown, whiteboard canvas, zoom, and auto-refresh polling
- Version history and project sharing via unauthenticated share links
- Optional blocks for specific app-building phases (auth, payments, notifications, etc.)
- Model switcher with free and premium model tiers per request
- Public REST API (`/api/v1`) for projects, tasks, subtasks, and kanban status
- Share links that let collaborators view a project without an account
- User accounts with Better Auth: email/password plus Google and GitHub OAuth
- Three plans (Free / Pro / Hengker) with per-minute AI rate limits
- Payments via Midtrans (snap + webhook)
- AI model tiers with automatic fallback routing through a local 9router
- Dark/light theme toggle with a preference-respecting default
- Error reporting endpoint and an in-app feedback form
- API keys page for programmatic access to the `/api/v1` endpoints

## Tech Stack

PrdFy is a full-stack TypeScript app. The same codebase serves both the interactive planner and a public REST API.

| Layer | Choice |
| --- | --- |
| Framework | TanStack Start (React Router file-based routing) |
| UI | React 19, Tailwind CSS 4, Radix UI, shadcn-style components |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite` |
| Data | Postgres, Drizzle ORM, `pg` |
| Auth | Better Auth (email/password, Google, GitHub) |
| AI | Local 9router endpoint (`http://localhost:20128`) with OpenAI-compatible completions |
| State | TanStack Query + Zustand |
| Rendering | Mermaid for diagrams, react-markdown + remark-gfm, DOMPurify |
| Lint / Format | Biome |
| Tests | Playwright, unit tests with Node's built-in test runner |
| Package Manager | pnpm |

## Architecture

PrdFy is a full-stack app where a single TanStack Start server handles both the browser UI and the server-side work:

- **File-based routes** under `src/routes/` drive the ask flow, PRD, AC, kanban, settings, auth, and pricing pages.
- **Server functions and API routes** wrap the AI calls, persistence, and business logic. Generation happens server-side; the client only streams the result.
- **A local 9router** exposes an OpenAI-compatible endpoint that PrdFy calls for all AI completions. Models are split into free and premium tiers with automatic fallback to the next available model.
- **Drizzle ORM + Postgres** store users, projects, PRD versions, AC, tasks, and kanban state. Migrations are managed with `drizzle-kit`.
- **Better Auth** handles session management server-side with email/password plus OAuth providers, and hashing with a server-only secret.
- **A public REST API** under `/api/v1` mirrors the core workflows so the same engine can be driven programmatically.

The four-stage pipeline is stateless at each step: you answer questions, get an artifact, and re-generate as needed. Nothing is mutated destructively; each stage writes a new version.

## Authentication

Authentication is handled by [Better Auth](https://better-auth.com), a server-side auth library for TypeScript. PrdFy supports:

- Email and password sign-up with server-side session cookies
- Social login via Google and GitHub OAuth
- Protected server functions and API routes that verify the session on every request
- A per-user plan (Free / Pro / Hengker) that gates AI rate limits and feature access

Session tokens are stored in HTTP-only cookies, and the secret lives only in the server environment, never in the client bundle.

## Security

Security is handled at the platform layer where possible:

- Session cookies are HTTP-only and SameSite.
- Passwords are hashed by Better Auth with a server-side secret.
- Server functions and API routes verify the session before mutating data.
- User-provided markdown is sanitized with DOMPurify before rendering.
- Payment secrets live only in server environment variables.

Report a vulnerability by opening a private issue or contacting the maintainer directly.

## Billing

PrdFy uses [Midtrans](https://midtrans.com) for payments. The flow is web-standard:

1. The client requests a payment on the server via `POST /api/payments/create`, which returns a Midtrans redirect URL.
2. The user completes the payment on Midtrans's hosted page.
3. A webhook at `POST /api/payments/webhook` verifies the transaction and updates the user's plan server-side.

Sensitive payment configuration lives in the server environment and is never exposed to the client.

## Getting Started

### Prerequisites

- Node.js 20 or newer
- pnpm (any recent version)
- PostgreSQL 17 or newer (installed natively or any reachable Postgres instance)
- A running 9router (or any OpenAI-compatible server) on `http://localhost:20128`
- A modern browser (Chrome, Edge, Firefox, or Safari)

### Environment Variables

The table below documents every variable the app reads. Sensitive values must be set server-side only and never committed.

> Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`.

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string |
| `BETTER_AUTH_SECRET` | Yes | Session secret (32+ random bytes base64) |
| `BETTER_AUTH_URL` | Yes | Public base URL of the app (`http://localhost:3000` in dev) |
| `GOOGLE_CLIENT_ID` | For Google login | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | For Google login | Google OAuth client secret |
| `GITHUB_CLIENT_ID` | For GitHub login | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | For GitHub login | GitHub OAuth client secret |
| `NINE_ROUTER_URL` | Yes | Base URL of the local AI router |


### Quick start

```bash
git clone https://github.com/ghazyAlghifari508/prdfy.git
cd prdfy
cp .env.example .env   # fill DATABASE_URL, BETTER_AUTH_SECRET, NINE_ROUTER_URL
pnpm install
pnpm db:push
pnpm dev
```

The full walkthrough is below.

### Installation

```bash
# 1. Install dependencies
pnpm install

# 2. Copy environment variables and fill them in
cp .env.example .env
```

Required values in `.env`:

```env
DATABASE_URL="postgresql://novaplan:novaplan_local@localhost:5432/novaplan"
BETTER_AUTH_SECRET="<openssl rand -base64 32>"
BETTER_AUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""
NINE_ROUTER_URL="http://localhost:20128"
```

### Database & migrations

The Postgres schema is defined in `src/db/schema.ts` with Drizzle. There are two ways to sync the database:

- `pnpm db:push` applies the schema directly. Fast for local iteration.
- `pnpm db:generate` + `pnpm db:migrate` create and run a migration file. Use this in shared environments.

`pnpm db:studio` opens Drizzle Studio for inspecting the database.

### Local AI router

PrdFy does not call a hosted model API directly. It talks to a local [9router](https://9router.com)-style OpenAI-compatible server at `NINE_ROUTER_URL`. Point it at any server exposing `/v1/chat/completions` and the app works unchanged.

### Start the database

Install PostgreSQL 17 natively. Create the user and database:

```sql
CREATE USER prdfy WITH PASSWORD 'prdfy_local';
CREATE DATABASE prdfy OWNER prdfy;
```

### Push the schema and run

```bash
pnpm db:push
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

> First run: create an account, then start a project from the home page and answer the ask-flow questions. The PRD, AC, and task board appear as soon as each stage finishes.

## Usage

1. **Sign up.** Email/password, Google, or GitHub. Free plan is enough to try everything.
2. **Start a project.** Give it a name and answer the ask-flow questions. Toggle web/mobile to shape the stack.
3. **Read the PRD.** Open the project, review each section, and regenerate what misses.
4. **Approve acceptance criteria.** Pick an implementation option where offered.
5. **Execute on the kanban.** Move tasks across columns, open details, and use the whiteboard for sketches.
6. **Share or export.** Use a share link for collaborators, or export the PRD and project bundle.

## Scripts

```bash
pnpm dev          # start the dev server on port 3000
pnpm build        # production build
pnpm preview      # preview the production build
pnpm db:generate  # generate a Drizzle migration
pnpm db:migrate   # apply migrations
pnpm db:push      # push schema directly (fast iteration)
pnpm db:studio    # open Drizzle Studio
pnpm lint         # Biome lint
pnpm format       # Biome format
pnpm check        # Biome check
```

## Project Structure

The source tree is organized by feature, with shared libraries kept under `lib/`:

```
src/
  app/            app-wide config, server actions (ask flow, settings, PRD)
  components/     feature components: ask, chat, kanban, prd, task, settings, ui
  db/             Drizzle schema and client
  hooks/          shared hooks (canvas zoom, kanban polling, panel resize)
  lib/            AI client, auth, constants, model config, utilities
  routes/         file-based routes + server API routes
  routes/api/v1/  public REST API
  store/          Zustand store
  tests/          unit tests for pure logic (constants, kanban utils)
```

## API

PrdFy exposes a public REST API under `/api/v1`. All endpoints are JSON and session-authenticated where the action mutates data. Endpoints cover:

- Projects: `GET/POST /api/v1/projects`, `GET /api/v1/projects/:id`
- Tasks: `GET /api/v1/projects/:id/tasks`
- Status: `PATCH /api/v1/tasks/:id/status`, `PATCH /api/v1/subtasks/:id/status`
- Kanban: `GET /api/v1/projects/:id/kanban`

## Existing Codebase Sync

PrdFy supports generating PRDs, acceptance criteria, and task boards for existing applications without uploading files manually. An external AI coding agent runs locally in your project, scans the repository safely via the official PrdFy CLI, and synchronizes a filtered snapshot to PrdFy.

### 1. CLI Installation

Install the official PrdFy CLI globally:

```bash
npm install -g @ghazynabiel/prdfy
```

Verify that the installed version meets the minimum required version (`>= 2.0.0`):

```bash
prdfy --version
```

### 2. Synchronization Command

When you choose **Codebase existing** on the Home page, PrdFy creates a project and issues a temporary, single-use sync token (valid for 30 minutes). Run the command from your repository root:

```bash
prdfy codebase sync --project-id <id> --sync-token <token>
```

Available flags:
- `--project-id <id>`: Required project UUID.
- `--sync-token <token>`: Required project-scoped sync token (in-memory, never saved to global config).
- `--root <path>`: Optional repository root. Detected automatically when omitted (nearest ancestor containing a `.git` entry), so running from a subdirectory still syncs the whole repository.
- `--output <mode>`: Output format (`human` by default, or `json` for agent-to-agent piping). The resolved root is printed in `human` output only and is never added to the JSON payload.
- `--api-url <url>`: Override API base URL (defaults to `http://localhost:3000`).

### 3. Exclusions & `.prdfyignore`

The CLI enforces **built-in exclusions** that can never be overridden by user configuration:
- Secrets and credentials: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `secrets/`, `credentials/`
- Build outputs & dependencies: `node_modules/`, `dist/`, `build/`, `.git/`, `coverage/`
- Local database dumps & binaries: `.sqlite`, `.db`, image/media binary files

`.prdfyignore` is created automatically on the first sync, so you never have to
write it by hand. The generated template documents the built-in coverage above
and ships with every pattern commented out — exclusions are already handled, and
an active pattern in the seed file would silently change what gets uploaded.
Only add repository-specific patterns:

```gitignore
# Custom exclusions
internal-tools/
private-docs/
fixtures/
```

The file is local sync configuration and is never committed or pushed
automatically. It is also excluded from the upload itself.

*Note: Negation patterns (`!pattern`) in `.prdfyignore` are inert to prevent accidental leakage of protected paths, and the CLI warns about each one it ignores.*

### 4. Privacy & Data Retention Policy

- **Payload limits**: Maximum snapshot size is 50 MiB; individual files cannot exceed 1 MiB; chunks are transmitted in 256 KiB envelopes.
- **Source retention**: Filtered text source context is stored securely and associated with the project snapshot for analysis and generation context.
- **Project deletion**: Deleting a project permanently and transactionally removes all associated codebase sync sessions, snapshots, file chunks, and analyses.

### 5. Failure Recovery

| Issue | Cause | Resolution |
|---|---|---|
| `CLI_UPDATE_REQUIRED` | CLI version is older than 2.0.0 | Run `npm install -g @ghazynabiel/prdfy` to update |
| `INVALID_SYNC_CREDENTIAL` | Token expired (30 min) or wrong project | Click "Mulai sync baru" on the web page to issue a fresh session |
| `SYNC_SESSION_ACTIVE` (409) | A sync session is already active in another tab | Click "Cabut sesi lama & buat baru" to revoke the previous session and issue a new one |
| `SNAPSHOT_BLOCKED` | A file matching high-risk secret patterns was found | Add the file to `.prdfyignore` or redact sensitive tokens before syncing |
| `SNAPSHOT_TOO_LARGE` | Repository exceeds 50 MiB or file exceeds 1 MiB | Add large assets or directories to `.prdfyignore` |
| `Network / 5xx error` | Temporary connection or server timeout | The CLI automatically retries up to 3 times with identical idempotency keys |

## Testing

Unit tests live next to the code they cover and use Node's built-in test runner (no extra framework):

```bash
node --test src/lib/*.test.ts src/lib/**/*.test.ts
```

End-to-end flows are covered with Playwright. Run them with:

```bash
pnpm exec playwright test
```

## Deployment

PrdFy is a standard Node server that builds to a production bundle:

```bash
pnpm build
pnpm preview
```

Point the deployment at a managed Postgres instance, set the environment variables above, and expose the server over HTTPS. Because the AI calls go to your own router, there is no external model provider to configure in production.

## Troubleshooting

**The app shows an error on generation.**
Check that `NINE_ROUTER_URL` is reachable and that `pnpm dev` started without errors. The AI calls go through the local router, so a stopped router means empty generations.

**The login screen never completes.**
Confirm `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are set and that `BETTER_AUTH_URL` matches the host you are browsing on.

**The database connection fails.**
Make sure Postgres is running and `DATABASE_URL` is correct. Use `pnpm db:studio` to verify the connection, then `pnpm db:push` to sync the schema.

**Runs are slower than expected.**
The fallback chain tries the premium model first. If it is slow, switch to the free tier model in the model dropdown.

**I changed a file but the app did not reload.**
Vite hot-reloads by default. If a route was added or renamed, run `pnpm generate-routes` or restart the dev server.

## Roadmap

Ideas that are likely to land next:

- Multi-user collaboration on a single project
- More AI model providers behind the router abstraction
- Export to GitHub Issues and Jira
- Custom PRD templates
- In-app notifications for long generations

## FAQ

**Do I need an OpenAI API key?**
No. PrdFy calls your local AI router, so no hosted API key is required.

**Which stack should I pick?**
Any. The ask flow lets you mix frontend, backend, database, and hosting choices. Toggle web or mobile and the available stacks update.

**Is my data stored on my machine?**
Yes, in the Postgres database you configure. PrdFy is self-hosted; there is no PrdFy cloud.

**How is the task count decided?**
PrdFy scales subtask counts and non-tech question counts to your app's complexity, so a small idea stays small and a large product gets the coverage it needs.

**How do I start over on a stage?**
Open the project, pick the stage, and re-generate. Every version is kept in history.

## Contributing

Contributions are welcome. The project uses Biome for linting and formatting and Node's built-in test runner for unit tests.

1. Fork the repository and create a feature branch.
2. Run `pnpm install` and `pnpm dev` to get a working local setup.
3. Keep changes scoped. Run `pnpm check` before opening a pull request.
4. Add a test alongside any non-trivial logic.
5. Open a pull request against `main`.

## License

Private project. Not licensed for redistribution.