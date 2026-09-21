import type { OutputLanguage } from "@/types/database";

export type PendingPrdPromptMode = "auto" | "chat";

const SETUP_PROMPT_KEY = "prdfy:setup-prompt";
const PRD_PROMPT_KEY = "prdfy:prd-prompt";
const ASK_PLATFORM_KEY = "prdfy:ask-platform";
const ASK_LANGUAGE_KEY = "prdfy:ask-language";

/** Setup prompt expires after 5 minutes to prevent stale prompts */
const SETUP_PROMPT_MAX_AGE_MS = 5 * 60 * 1000;

interface SetupPromptPayload {
	prompt: string;
	createdAt: number;
}

interface PendingPrdPrompt {
	prompt: string;
	mode: PendingPrdPromptMode;
	createdAt: number;
	/** Original user message for display in chat bubble (without template/tags) */
	displayMessage?: string;
}

interface SafeStorage {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
	removeItem: (key: string) => void;
}

// sessionStorage access throws in blocked-storage/privacy mode, on quota
// exhaustion, or when the getter itself is revoked. Every touchpoint goes
// through this wrapper so persistence degrades to a no-op instead of
// crashing navigation and submit flows.
function getStorage(): SafeStorage | null {
	try {
		if (typeof window === "undefined") return null;
		const raw = window.sessionStorage;
		if (!raw) return null;
		return {
			getItem: (key) => {
				try {
					return raw.getItem(key);
				} catch {
					return null;
				}
			},
			setItem: (key, value) => {
				try {
					raw.setItem(key, value);
				} catch {
					/* best-effort persistence */
				}
			},
			removeItem: (key) => {
				try {
					raw.removeItem(key);
				} catch {
					/* already gone or unremovable */
				}
			},
		};
	} catch {
		return null;
	}
}

// Timestamps from storage are user-controlled: require finite values and
// reject future times (past a small clock-skew allowance), otherwise a
// tampered createdAt defeats stale-prompt expiry.
const CLOCK_SKEW_ALLOWANCE_MS = 60_000;

function isPlausibleTimestamp(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value <= Date.now() + CLOCK_SKEW_ALLOWANCE_MS
	);
}

export function saveSetupPrompt(prompt: string) {
	const payload: SetupPromptPayload = {
		prompt,
		createdAt: Date.now(),
	};
	getStorage()?.setItem(SETUP_PROMPT_KEY, JSON.stringify(payload));
}

/**
 * Read-only access to the setup prompt (does NOT consume it).
 * Returns empty string if missing or expired.
 */
export function getSetupPrompt(): string {
	const storage = getStorage();
	const raw = storage?.getItem(SETUP_PROMPT_KEY);
	if (!raw) return "";

	try {
		const parsed = JSON.parse(raw) as Partial<SetupPromptPayload>;
		if (!parsed.prompt || typeof parsed.prompt !== "string") return "";

		// Reject expired prompts — and any prompt whose timestamp is not
		// plausible (non-finite or future), which would otherwise bypass
		// the expiry check entirely.
		if (
			!isPlausibleTimestamp(parsed.createdAt) ||
			Date.now() - parsed.createdAt > SETUP_PROMPT_MAX_AGE_MS
		) {
			storage?.removeItem(SETUP_PROMPT_KEY);
			return "";
		}

		return parsed.prompt;
	} catch {
		// Backward compat: raw string from old saveSetupPrompt (pre-expiry)
		// Treat as expired since we can't verify age - clear and reject
		storage?.removeItem(SETUP_PROMPT_KEY);
		return "";
	}
}

export function savePendingPrdPrompt(
	prompt: string,
	mode: PendingPrdPromptMode,
	displayMessage?: string,
) {
	const payload: PendingPrdPrompt = {
		prompt,
		mode,
		createdAt: Date.now(),
		displayMessage,
	};

	getStorage()?.setItem(PRD_PROMPT_KEY, JSON.stringify(payload));
}

export function getPendingPrdPrompt(): PendingPrdPrompt | null {
	const storage = getStorage();
	const raw = storage?.getItem(PRD_PROMPT_KEY);
	if (!storage || !raw) return null;

	try {
		const parsed = JSON.parse(raw) as Partial<PendingPrdPrompt>;
		if (!parsed.prompt || typeof parsed.prompt !== "string") return null;
		// Tampered sessionStorage could carry any mode string and branch
		// consumers into the wrong flow — accept only known modes.
		if (parsed.mode !== "auto" && parsed.mode !== "chat") return null;
		if (!isPlausibleTimestamp(parsed.createdAt)) return null;

		return {
			prompt: parsed.prompt,
			mode: parsed.mode,
			createdAt: parsed.createdAt,
			displayMessage:
				typeof parsed.displayMessage === "string"
					? parsed.displayMessage
					: undefined,
		};
	} catch {
		return null;
	}
}

export function clearPendingPrdPrompt(): void {
	getStorage()?.removeItem(PRD_PROMPT_KEY);
}

export function consumePendingPrdPrompt(): PendingPrdPrompt | null {
	const pending = getPendingPrdPrompt();
	if (pending) {
		clearPendingPrdPrompt();
	}
	return pending;
}

/**
 * Platform choice (web/mobile) carried from the home prompt into the /ask flow,
 * so session 2 can offer the right frontend option list.
 */
export function saveAskPlatform(platform: "web" | "mobile") {
	getStorage()?.setItem(ASK_PLATFORM_KEY, platform);
}

export function getAskPlatform(): "web" | "mobile" {
	return getStorage()?.getItem(ASK_PLATFORM_KEY) === "mobile"
		? "mobile"
		: "web";
}

export function saveAskLanguage(language: OutputLanguage) {
	getStorage()?.setItem(ASK_LANGUAGE_KEY, language);
}

export function getAskLanguage(): OutputLanguage {
	return getStorage()?.getItem(ASK_LANGUAGE_KEY) === "en" ? "en" : "id";
}

/* ---------- /ask flow persistence (survives refresh) ---------- */
const ASK_STATE_KEY = "prdfy:ask-state";

export interface AskState {
	projectId: string;
	prompt: string;
	platform: "web" | "mobile";
	language?: OutputLanguage;
	session: 1 | 2;
	questions: {
		id: string;
		question: string;
		type: "select" | "text" | "multiselect";
		options?: string[];
	}[];
	nonTechAnswers: Record<
		string,
		{ value: string; isCustom: boolean; skipped: boolean; values?: string[] }
	>;
	skippedTech: string[];
	techAnswers: {
		frontend?: string;
		backend?: string;
		fullstackFramework?: string;
		database?: string;
		deployment?: string;
	};
}

/** Persist the generated question set + both sessions' answers so a refresh
 *  (or hard refresh) restores state instead of regenerating questions. */
export function saveAskState(state: AskState) {
	getStorage()?.setItem(ASK_STATE_KEY, JSON.stringify(state));
}

const ASK_QUESTION_TYPES = new Set(["select", "text", "multiselect"]);
const ASK_PLATFORMS = new Set(["web", "mobile"]);

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Read-only restore. Returns null if missing, corrupt, or for a different
 *  project. The stored value is fully validated — a tampered payload must
 *  not inject bad sessions, question shapes, or enum values into the flow. */
export function getAskState(projectId: string): AskState | null {
	const storage = getStorage();
	const raw = storage?.getItem(ASK_STATE_KEY);
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return null;
		const p = parsed as Record<string, unknown>;
		if (p.projectId !== projectId) return null;
		if (typeof p.prompt !== "string") return null;
		if (typeof p.platform !== "string" || !ASK_PLATFORMS.has(p.platform))
			return null;
		if (p.language !== undefined && p.language !== "id" && p.language !== "en")
			return null;
		if (p.session !== 1 && p.session !== 2) return null;
		if (!Array.isArray(p.questions)) return null;
		for (const q of p.questions) {
			if (!q || typeof q !== "object" || Array.isArray(q)) return null;
			const qq = q as Record<string, unknown>;
			if (typeof qq.id !== "string" || typeof qq.question !== "string")
				return null;
			if (typeof qq.type !== "string" || !ASK_QUESTION_TYPES.has(qq.type))
				return null;
			if (qq.options !== undefined && !isStringArray(qq.options)) return null;
		}
		if (!p.nonTechAnswers || typeof p.nonTechAnswers !== "object") return null;
		for (const a of Object.values(
			p.nonTechAnswers as Record<string, unknown>,
		)) {
			if (!a || typeof a !== "object" || Array.isArray(a)) return null;
			const aa = a as Record<string, unknown>;
			if (
				typeof aa.value !== "string" ||
				typeof aa.isCustom !== "boolean" ||
				typeof aa.skipped !== "boolean" ||
				(aa.values !== undefined && !isStringArray(aa.values))
			)
				return null;
		}
		if (!isStringArray(p.skippedTech)) return null;
		if (!p.techAnswers || typeof p.techAnswers !== "object") return null;
		for (const v of Object.values(p.techAnswers as Record<string, unknown>)) {
			if (v !== undefined && typeof v !== "string") return null;
		}
		return parsed as AskState;
	} catch {
		storage?.removeItem(ASK_STATE_KEY);
		return null;
	}
}

/* ---------- PRD chat follow-up draft (survives refresh) ---------- */
const PRD_DRAFT_MAP_KEY = "prdfy:prd-drafts";

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isSafeMapKey(key: string): boolean {
	return (
		typeof key === "string" &&
		key.length > 0 &&
		key.length <= 128 &&
		!DANGEROUS_KEYS.has(key)
	);
}

function emptyDraftMap(): Record<string, string> {
	return Object.create(null);
}

function readPrdDraftMap(): Record<string, string> {
	const storage = getStorage();
	const raw = storage?.getItem(PRD_DRAFT_MAP_KEY);
	if (!raw) return emptyDraftMap();
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return emptyDraftMap();
		// Null-prototype map + own string values only: a tampered payload
		// must not be able to set __proto__ or smuggle non-string drafts.
		// (A plain {} literal would expose Object.prototype on __proto__ reads.)
		const out: Record<string, string> = Object.create(null);
		for (const [key, value] of Object.entries(parsed)) {
			if (isSafeMapKey(key) && typeof value === "string") out[key] = value;
		}
		return out;
	} catch {
		return emptyDraftMap();
	}
}

/** Persist the PRD chat input draft, keyed per project so drafts don't leak
 *  between projects. Tab-scoped (sessionStorage): a draft is session work. */
export function savePrdDraft(projectId: string, draft: string) {
	const storage = getStorage();
	if (!storage || !isSafeMapKey(projectId)) return;
	const all = readPrdDraftMap();
	if (!draft) {
		delete all[projectId];
	} else {
		all[projectId] = draft;
	}
	storage.setItem(PRD_DRAFT_MAP_KEY, JSON.stringify(all));
}

/** Read-only restore. Returns "" if missing for this project. */
export function getPrdDraft(projectId: string): string {
	if (!isSafeMapKey(projectId)) return "";
	return readPrdDraftMap()[projectId] ?? "";
}

export function clearPrdDraft() {
	// ponytail: no projectId available at some call sites — kept as a full
	// clear for backward compatibility with existing callers.
	getStorage()?.removeItem(PRD_DRAFT_MAP_KEY);
}

/* ---------- Home seed-prompt draft (survives refresh before send) ---------- */
const HOME_DRAFT_KEY = "prdfy:home-draft";

/** Persist the home textarea draft before the user presses send. Tab-scoped.
 *  Distinct from saveSetupPrompt (which fires on send with the enriched payload). */
export function saveHomeDraft(draft: string) {
	const storage = getStorage();
	if (!storage) return;
	if (!draft) {
		storage.removeItem(HOME_DRAFT_KEY);
		return;
	}
	storage.setItem(HOME_DRAFT_KEY, draft);
}

export function getHomeDraft(): string {
	return getStorage()?.getItem(HOME_DRAFT_KEY) ?? "";
}

export function clearHomeDraft() {
	getStorage()?.removeItem(HOME_DRAFT_KEY);
}

/* ---------- Onboarding multi-step state (survives refresh) ---------- */
const ONBOARDING_STATE_KEY = "prdfy:onboarding-state";

export interface OnboardingState {
	step: number;
	fullName: string;
	role: string;
	goals: string[];
}

/** Persist the 3-step onboarding wizard state so a refresh mid-wizard
 *  (before the final submit) restores step + name + role + goals instead of
 *  restarting at step 1. Tab-scoped. */
export function saveOnboardingState(state: OnboardingState) {
	getStorage()?.setItem(ONBOARDING_STATE_KEY, JSON.stringify(state));
}

const ONBOARDING_TOTAL_STEPS = 3;

export function getOnboardingState(): OnboardingState | null {
	const storage = getStorage();
	const raw = storage?.getItem(ONBOARDING_STATE_KEY);
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return null;
		const p = parsed as Record<string, unknown>;
		if (
			!Number.isInteger(p.step) ||
			(p.step as number) < 1 ||
			(p.step as number) > ONBOARDING_TOTAL_STEPS
		)
			return null;
		if (typeof p.fullName !== "string" || typeof p.role !== "string")
			return null;
		if (!isStringArray(p.goals)) return null;
		return parsed as OnboardingState;
	} catch {
		storage?.removeItem(ONBOARDING_STATE_KEY);
		return null;
	}
}

export function clearOnboardingState() {
	getStorage()?.removeItem(ONBOARDING_STATE_KEY);
}

/* ---------- Resume intent (credit-exhaustion → payment → auto-resume) ---------- */
const RESUME_INTENT_KEY = "prdfy:resume-intent";
const RESUME_INTENT_MAX_AGE_MS = 15 * 60 * 1000;

interface ResumeIntentPayload {
	projectId: string;
	stage: "prd" | "ac" | "task";
	createdAt: number;
}

export function saveResumeIntent(
	projectId: string,
	stage: "prd" | "ac" | "task",
) {
	const payload: ResumeIntentPayload = {
		projectId,
		stage,
		createdAt: Date.now(),
	};
	getStorage()?.setItem(RESUME_INTENT_KEY, JSON.stringify(payload));
}

/**
 * Consume-pattern: reads and removes. Returns the stage if the stored intent
 * matches `projectId` and hasn't expired, otherwise null (and clears stale data).
 */
export function consumeResumeIntent(
	projectId: string,
): "prd" | "ac" | "task" | null {
	const storage = getStorage();
	const raw = storage?.getItem(RESUME_INTENT_KEY);
	if (!raw) return null;
	storage?.removeItem(RESUME_INTENT_KEY);
	try {
		const parsed = JSON.parse(raw) as Partial<ResumeIntentPayload>;
		if (!parsed.projectId || typeof parsed.projectId !== "string") return null;
		if (
			parsed.stage !== "prd" &&
			parsed.stage !== "ac" &&
			parsed.stage !== "task"
		)
			return null;
		if (!isPlausibleTimestamp(parsed.createdAt)) return null;
		if (parsed.projectId !== projectId) return null;
		if (Date.now() - parsed.createdAt > RESUME_INTENT_MAX_AGE_MS) return null;
		return parsed.stage;
	} catch {
		return null;
	}
}

/* ---------- Suppress auto-generate on history resume landing ---------- */
const SUPPRESS_AUTOGEN_KEY = "prdfy:suppress-autogen";

export function saveSuppressAutoGen(projectId: string) {
	getStorage()?.setItem(SUPPRESS_AUTOGEN_KEY, projectId);
}

/**
 * One-shot check: returns true if `projectId` matches the stored suppress marker,
 * then clears it. Returns false otherwise.
 */
export function consumeSuppressAutoGen(projectId: string): boolean {
	const storage = getStorage();
	const stored = storage?.getItem(SUPPRESS_AUTOGEN_KEY);
	if (stored === projectId) {
		storage?.removeItem(SUPPRESS_AUTOGEN_KEY);
		return true;
	}
	return false;
}
