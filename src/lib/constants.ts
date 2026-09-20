import { COMBO_MODEL_ID } from "@/lib/model-config";

const NINE_ROUTER_URL = process.env.NINE_ROUTER_URL || "http://localhost:20128";
export const ROUTER_BASE_URL = `${NINE_ROUTER_URL}/v1`;

// Single combo model — 9Router handles selection + fallback internally.
export const AI_MODELS = {
	primary: COMBO_MODEL_ID,
	fallback: COMBO_MODEL_ID,
	premium: COMBO_MODEL_ID,
} as const;

// Internal utility calls (project summary, etc.) reuse the combo model.
export const SUMMARY_MODEL = COMBO_MODEL_ID;

export const RATE_LIMITS = {
	free: 5,
	pro: 15,
	hengker: 30,
	general: 60,
} as const;

export const RATE_LIMIT_WINDOW_MS = 60_000;

// Pre-byte-retry for AI generation: if the upstream router drops/errors before
// any text-delta leaves the server, retry once before failing the whole request.
// Only safe because no client-visible delta has been emitted yet.
export const AI_STREAM_RETRY_ATTEMPTS = 1;

// No-progress watchdog: if upstream emits no text-delta AND no reasoning-delta
// for this long, abort and surface an error instead of an infinite spinner.
export const AI_STALL_TIMEOUT_MS = 120_000;

// Hard ceiling per generation (covers full stream including burst + tokens).
export const AI_TOTAL_TIMEOUT_MS = 600_000;

// Bounded wait before a 409 when another generation still holds the claim —
// an aborted request releases ac_status/task_status asynchronously, so an
// immediate retry (StrictMode double-mount) must give it time to free up.
export const CLAIM_POLL_MS = 500;
export const CLAIM_RETRY_MS = 2000;
// Max time a second generate caller (AC or Task) waits for an in-flight
// sibling attempt to settle before giving up silently (prevents stacked
// duplicate requests).
export const GUARD_WAIT_MS = 3000;

export const MIN_PROMPT_LENGTH = 20;
export const MAX_PROMPT_LENGTH = 3000;
export const HOME_DRAFT_DEBOUNCE_MS = 300;
export const HISTORY_PAGE_SIZE = 12;
export const PDF_STYLES = {
	font: "Inter",
	headerSize: 14,
	bodySize: 11,
} as const;

export const KANBAN_SSE_INTERVAL_MS = 3_000;
export const KANBAN_POLL_INTERVAL_MS = 10_000;

// === Existing codebase sync (MVP locked decisions) ===
// Browser polls the persisted sync status; no sync SSE endpoint in MVP.
export const CODEBASE_SYNC_POLL_INTERVAL_MS = 2_000;
// A sync session (and its credential) expires after 30 minutes.
export const CODEBASE_SYNC_SESSION_EXPIRY_MS = 30 * 60 * 1000;
// Transport bounds enforced by both CLI and server.
export const CODEBASE_MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;
export const CODEBASE_MAX_FILE_BYTES = 1024 * 1024;
export const CODEBASE_MAX_CHUNK_BYTES = 256 * 1024;
// Minimum supported CLI version for `prdfy codebase sync`.
export const CODEBASE_CLI_MIN_VERSION = "2.0.0";
// Maximum user-facing sync error message length served to browsers. Longer
// server-written messages are truncated so status polling stays bounded.
export const CODEBASE_MAX_ERROR_MESSAGE_CHARS = 500;
// Maximum source-context characters fed to the analysis model per attempt.
// Snapshot rows stay the source of truth; the prompt carries a bounded
// excerpt and marks truncation explicitly.
export const CODEBASE_ANALYSIS_MAX_CONTEXT_CHARS = 60_000;
// Token headroom for analysis generation. Mirrors the ask/options budget:
// reasoning models spend from the same maxOutputTokens budget before any
// JSON content is emitted.
export const CODEBASE_ANALYSIS_MAX_TOKENS = 12_000;
// Maximum manifest entries listed in the analysis prompt. Overflow is marked
// explicitly so the model never mistakes a truncated list for the full tree.
export const CODEBASE_ANALYSIS_MAX_MANIFEST_ENTRIES = 500;
// === Existing-codebase generation grounding (Task 8) ===
// Bounded snapshot-bound context injected into Ask/PRD/AC/Task prompts via
// one formatting boundary (buildCodebasePromptBlock). Null context (greenfield)
// is a no-op so greenfield prompts stay byte-identical.
export const CODEBASE_GENERATION_MAX_CONTEXT_CHARS = 6_000;
export const CODEBASE_GENERATION_MAX_PATHS = 40;
export const CODEBASE_GENERATION_MAX_FINDINGS = 5;
export const CODEBASE_GENERATION_MAX_PROMPT_CHARS = 2_000;
export const CODEBASE_GENERATION_MAX_ANSWER_CHARS = 1_000;
// Per-section caps inside the bounded block (Task 9 hardening): the global
// char ceiling alone would let one oversized section (e.g. a huge analysis
// summary) silently crowd out constraints/findings. Snapshot identity stays
// above truncation (buildCodebasePromptBlock), so identity always survives.
export const CODEBASE_GENERATION_MAX_SUMMARY_CHARS = 2_000;
export const CODEBASE_GENERATION_MAX_CONSTRAINTS = 10;
// === Ask handoff persistence (Task 8) ===
// Authoritative Ask answers/compiled prompt stored server-side for
// existing-codebase projects so refresh and multi-device access keep them.
// sessionStorage remains for UI continuity.
export const CODEBASE_ASK_HANDOFF_MAX_PROMPT_CHARS = 8_000;
export const CODEBASE_ASK_HANDOFF_MAX_ANSWERS = 60;
export const CODEBASE_ASK_HANDOFF_MAX_STATE_CHARS = 20_000;
export const CODEBASE_ASK_HANDOFF_MAX_OPTIONS = 8;
// Upper bound for the best-effort handoff save at Ask submit (Task 9): the
// save must never stall navigation to PRD. Abort/timeout/failure all fall
// through; sessionStorage already preserves UI continuity.
export const CODEBASE_ASK_HANDOFF_SAVE_TIMEOUT_MS = 8_000;

// === Client error reports ===
// Bounds for error telemetry persisted by /api/report-error. The endpoint
// stores whatever passes validation, so oversized payloads are rejected
// with 400 before insert instead of growing the table unboundedly.
export const ERROR_REPORT_MAX_MESSAGE_CHARS = 2000;
export const ERROR_REPORT_MAX_CONTEXT_CHARS = 8000;

// === User feedback ===
export const FEEDBACK_TYPES = ["general", "bug", "feature"] as const;
export const FEEDBACK_MAX_MESSAGE_CHARS = 2000;

// === Billing (monthly subscription) ===
// Length of one paid/free billing period. All period math lives in lib/billing.ts.
export const BILLING_PERIOD_DAYS = 30;
// Days before period end when the pre-expiry notice email fires (cron job).
export const PRE_EXPIRY_NOTICE_DAYS = 3;
// Post-expiry pause reminder schedule, in days after the period ended.
// reminder_count tracks how many of these have been sent (see lib/services/billing-emails.ts).
export const REMINDER_SCHEDULE_DAYS = [1, 7, 14] as const;

// === Credit top-up (mid-period purchase) ===
// Single universal SKU: bought by ACTIVE Pro/Hengker subscribers only
// (state active_paid). Credits join the SAME pool as the monthly allocation
// (shared credits/creditsUsed) and are forfeited together at period end.
// Buying NEVER extends the current period. Anti-undercut cap per period =
// PLAN_CREDITS[plan]; tracked from successful topup payments within
// [current_period_start, current_period_end] (spec topup-design §4).
export const TOPUP_SKU = {
	id: "topup-15",
	credits: 15,
	priceIdr: 20000,
} as const;

// Versioned product-level pricing inputs for adaptive credit quotes.
export const ADAPTIVE_CREDIT_PRICING = {
	version: "adaptive-v1",
	thresholds: {
		promptChars: 4_000,
		prdSourceChars: 12_000,
		featureCount: 4,
		personaCount: 3,
		workflowCount: 3,
		requirementCount: 8,
		constraintCount: 5,
		taskCount: 8,
		fileCount: 100,
		sourceBytes: 250_000,
		languageCount: 3,
		dependencyCount: 20,
		relationshipCount: 100,
	} as const,
	weights: {
		promptChars: 0.25,
		prdSourceChars: 0.5,
		taskCount: 0.5,
		featureCount: 0.5,
		personaCount: 0.25,
		workflowCount: 0.5,
		requirementCount: 0.25,
		constraintCount: 0.25,
		fileCount: 0.5,
		sourceBytes: 0.5,
		languageCount: 0.25,
		dependencyCount: 0.25,
		relationshipCount: 0.25,
		codebaseContext: 0.5,
	} as const,
	operations: {
		codebase_analysis: { baseCredits: 2, maximumCredits: 12 },
		prd_generation: { baseCredits: 1, maximumCredits: 8 },
		ac_generation: { baseCredits: 1, maximumCredits: 6 },
		task_generation: { baseCredits: 1, maximumCredits: 8 },
	} as const,
} as const;
