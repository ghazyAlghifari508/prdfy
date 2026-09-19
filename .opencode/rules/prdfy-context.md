# PRDFY — Application Context (WAJIB DIBACA SEBELUM KERJA)

**Tujuan rules ini**: Supaya AI PAHAM aplikasi ini sebelum ngoding. Jangan halu. Jangan tebak. Baca ini dulu, baru kerja.

---

## Apa PRDFY?

PRDFY = AI-powered product development planner. User input ide produk → app generate PRD → AC → Task/Kanban. Self-hosted (own Postgres, local AI router "9router"). Tagline: "Dari ide ke PRD profesional dalam 5 menit, bukan 5 hari."

**Bahasa Indonesia** — semua UI copy, prompt, dan label pakai Bahasa Indonesia. Jangan translate istilah teknis.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | TanStack Start + TanStack Router (file-based routing di `src/routes/`) |
| UI | React 19, Radix UI, shadcn/ui, Tailwind CSS 4 (`@tailwindcss/vite`), Framer Motion, `class-variance-authority` |
| State | Zustand (3 stores di `src/store/index.ts`), TanStack Query |
| Auth | Better Auth 1.6 (Google + GitHub OAuth, email/password DISABLED) |
| DB | PostgreSQL 17, Drizzle ORM (`drizzle-kit` migrate/push/studio) |
| AI | Vercel AI SDK v7 (`ai`, `@ai-sdk/openai`) → local "9router" OpenAI-compatible endpoint |
| Validation | Zod v4 |
| Payment | Midtrans Snap + webhook |
| Email | Resend |
| Export | jszip (zip bundle), markdown export |
| Rendering | react-markdown + remark-gfm + rehype-highlight, Mermaid (diagrams), DOMPurify |
| Lint/Format | Biome |
| Testing | Vitest (unit), Playwright (e2e) |
| Build | Vite 8, TypeScript 6 |
| Package Manager | pnpm |

---

## User Flow (End-to-End Happy Path)

```
1. / (landing) → user ketik ide produk → klik send
2. /login → Google/GitHub OAuth (Better Auth)
3. / (authenticated) → POST /api/projects → redirect ke /ask/{id}
4. /ask/{id} → Session 1 (non-tech questions) → Session 2 (tech stack picks)
5. /prd/{id} → auto-submit compiled prompt → POST /api/chat (mode=generate)
   → SSE stream → PRD 8 sections → save prdVersions v1 → burn 1 credit
6. (opsional) revise PRD via chat (free, unlimited) → :::UPDATE_SECTION patches
7. "Generate AC" → step advances → /ac/{id}
   → auto-generate → POST /api/ac/generate → stream → save acVersions → burn 1 credit
8. /task/{id} → auto-generate → POST /api/task/generate → JSON → save tasks → burn 1 credit
9. /kanban/{id} → drag/track task status (polling 10s)
10. /history → resume project di step terakhir
```

---

## 4-Stage Pipeline (Append-Only, Version History)

| Stage | Route | API | Output | Credit |
|---|---|---|---|---|
| **Ask** | `/ask/$id` | `POST /api/ask/options` | Clarifying questions (JSON) | 0 |
| **PRD** | `/prd/$id` | `POST /api/chat` | 8-section PRD (markdown + mermaid) | 1 |
| **AC** | `/ac/$id` | `POST /api/ac/generate` | Acceptance criteria (markdown) | 1 |
| **Task** | `/task/$id` | `POST /api/task/generate` | Task tree (JSON) | 1 |

Revision = **free, unlimited** di semua tier. Hanya `generate` yang bakar credit.

---

## Plans & Credits

| Plan | Harga (one-time) | Credits | Full Workflow (AC/Task/Kanban) | Share Link | Version History |
|---|---|---|---|---|---|
| **free** | Rp 0 | 2 | ❌ (PRD only) | ❌ | ❌ |
| **pro** | Rp 49.000 | 30 | ✅ | ✅ | 30 versions |
| **hengker** | Rp 149.000 | 105 | ✅ | ✅ | unlimited |

- 1 credit = 1 generate action (PRD/AC/Task). Revision free.
- Credits additive, never expire, no billing period.
- Atomic burn: `consumeCredit()` uses `WHERE creditsUsed < credits` to prevent race condition.
- Payment: Midtrans Snap → webhook → auto-verify → auto-resume blocked action.

---

## Database Schema (Key Tables)

| Table | Purpose |
|---|---|
| `users` | Better Auth core user + app fields (fullName, company, role) |
| `sessions` | Better Auth sessions |
| `accounts` | OAuth/credential accounts |
| `subscriptions` | Plan (free/pro/hengker), credits, creditsUsed |
| `projects` | Core entity: name, status, mode, step (prd/ac/task), shareToken |
| `prd_versions` | Append-only PRD content per version |
| `ac_versions` | Append-only AC content per version |
| `conversations` | Chat thread tied to project |
| `messages` | Chat messages (role, content, jsonb metadata) |
| `tasks` | Flat task table (featureName groups, subtasks jsonb) |
| `api_keys` | Hashed API keys for /api/v1 public REST |
| `payments` | Midtrans order records |
| `rate_limits` | Sliding-window rate limiting |
| `feedback` | User feedback |
| `error_reports` | Client error reports |

**Penting**: `tasks` = schema-fork. Old normalized tables collapsed jadi 1 flat table. `task-service.ts` reconstruct tree di app code. Types di `src/types/database.ts` ada yang stale (VibeCoding platform migration) — gak 1:1 mapping sama actual tables lagi.

---

## Zustand Stores (`src/store/index.ts`)

### `useAuthStore`
- `user` (id/email), `plan`, `prdUsed`/`prdLimit`, `isLoading`

### `useChatStore`
- `messages[]`, `isStreaming`, `isGeneratingPRD`, `isGeneratingAC`, `isTaskGenerated`
- `generationStep`, `selectedMode` (ai_auto/manual), `activeProjectId`
- `streamingPRDContent`, `completedSections[]`, `creditsExhausted`

### `useUIStore`
- `isChatPanelOpen`, `isPRDLoading`, toast state

No persistence = pure in-memory. Server truth di Postgres, re-fetched via TanStack Query/loaders.

---

## AI Integration Detail

### Model Tiers (`src/lib/model-config.ts`)

| Tier | Models | Plan Required |
|---|---|---|
| Free | Big Pickle, Laguna S 2.1 | free+ |
| Pro | Nemotron 3 Ultra, MiMo v2.5 | pro+ |
| Hengker | DeepSeek V4 Flash | hengker |

### Streaming Pipeline (`/api/chat`)
1. `requireUser` + plan lookup
2. Rate limit check (`checkRateLimit`, action `ai_generate`)
3. Credit gate (`checkCredits`)
4. System prompt = stage-specific prompt + `depthDirective()`
5. `selectModels(plan, requestedModel)` → fallback chain
6. `tryStreamWithFallback()` → tries each model until one streams
7. SSE events: `started` → `thinking` (reasoning models) → `delta` → `done`/`error`

### PRD Revision Protocol
- Model instructed to NEVER rewrite whole doc
- Output: `:::UPDATE_SECTION[Name]::: ... :::END_UPDATE:::` blocks
- Server-side regex merge into current saved content
- Client live-patches displayed PRD during streaming

### Reasoning Models Behavior
- 9router reasoning models (o1, etc) emit NO deltas during 15-90s thinking phase
- Then burst entire document in <2s
- Client-side typewriter reveal animation masks this (cosmetic only, ~50 chars/25ms)

---

## Architecture Notes

### Server-Only Modules
- `db`, `auth`, `pg` dynamically imported inside handlers, NEVER at module top-level
- Keeps server-only deps out of client bundle
- Pattern: `const { db } = await import("@/db")` inside handler

### App-Level Security
- No RLS — uses `WHERE user_id = ?` on every query
- `requireUser(headers)` throws "Unauthorized" if no session
- API key auth: Bearer token → SHA-256 hash → `api_keys` lookup, scope check

### File Structure
```
src/
  app/            → server actions, providers
  components/     → feature-grouped: ask, chat, kanban, prd, ac, task, settings, auth, layout, ui
  db/             → schema.ts (Drizzle) + client
  hooks/          → use-canvas-zoom, use-kanban-polling, use-panel-resize, use-user-plan
  lib/            → ai-client, auth, constants, model-config, credits, rate-limit, session, prompts*.ts
  lib/services/   → ai-orchestrator, chat-service, prd-service, ac-service, task-service, payment-service
  routes/         → file-based UI routes + routes/api/* + routes/api/v1/* (public REST)
  store/          → single index.ts — 3 Zustand stores
  types/          → database.ts (shared domain types)
```

### Key Routes
```
/                    → landing + chat input
/login               → Google/GitHub OAuth
/ask/$id             → guided question flow
/prd/$id             → PRD viewer + chat panel
/ac/$id              → AC viewer
/task/$id            → task detail
/kanban/$id          → kanban board
/history             → all projects list
/pricing             → pricing page
/settings/*          → profile, account, api-keys, billing, notifications, feedback
/prd/share/$token    → public read-only PRD view
/api/v1/*            → public REST API (Bearer API-key auth)
```

---

## Rules Sebelum Ngoding

1. **PAHAM dulu flow-nya** — sebelum edit apapun, trace dari route → component → service → DB. Jangan asal tebak.
2. **Server-only modules** — `db`, `auth`, `pg` wajib dynamic import di handler, jangan module top-level.
3. **Credit = 1 generate** — revision free. Jangan tambah credit gate di revision flow.
4. **Append-only versioning** — PRD/AC versions gak pernah di-mutate, selalu insert baru.
5. **Step monotonic** — `projects.step` hanya naik (question→prd→ac→task), gak pernah mundur.
6. **SSE streaming** — `started`→`delta`→`done`. Client consume via fetch + ReadableStream pattern di `chat-panel.tsx`.
7. **Revision = patch protocol** — `:::UPDATE_SECTION[Name]:::` blocks, BUKAN full rewrite.
8. **Reasoning models burst** — gak ada delta selama thinking, lalu semua sekaligus. Typewriter reveal = cosmetic fix.
9. **Zustand = in-memory** — server truth di Postgres. Jangan assume Zustand persist across refresh.
10. **TanStack Start** — file-based routing di `src/routes/`, BUKAN Next.js App Router. Jangan pakai `next/*` imports kecuali ada compat shim.
11. **Bahasa Indonesia** — UI copy, prompt, error message. Jangan translate istilah teknis.
12. **No RLS** — app-level `WHERE user_id = ?`. Pastikan semua query filter by userId.
