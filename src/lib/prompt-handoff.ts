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

function getStorage() {
	if (typeof window === "undefined") return null;
	return window.sessionStorage;
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
		if (!parsed.prompt) return "";

		// Reject expired prompts
		if (
			parsed.createdAt &&
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

export function consumePendingPrdPrompt(): PendingPrdPrompt | null {
	const storage = getStorage();
	const raw = storage?.getItem(PRD_PROMPT_KEY);
	if (!storage || !raw) return null;

	storage.removeItem(PRD_PROMPT_KEY);

	try {
		const parsed = JSON.parse(raw) as Partial<PendingPrdPrompt>;
		if (!parsed.prompt || !parsed.mode) return null;

		return {
			prompt: parsed.prompt,
			mode: parsed.mode,
			createdAt: parsed.createdAt || Date.now(),
			displayMessage: parsed.displayMessage,
		};
	} catch {
		return null;
	}
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

/** Read-only restore. Returns null if missing or for a different project. */
export function getAskState(projectId: string): AskState | null {
	const storage = getStorage();
	const raw = storage?.getItem(ASK_STATE_KEY);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as AskState;
		if (!parsed || parsed.projectId !== projectId) return null;
		return parsed;
	} catch {
		storage?.removeItem(ASK_STATE_KEY);
		return null;
	}
}

/* ---------- PRD chat follow-up draft (survives refresh) ---------- */
const PRD_DRAFT_MAP_KEY = "prdfy:prd-drafts";

function readPrdDraftMap(): Record<string, string> {
	const storage = getStorage();
	const raw = storage?.getItem(PRD_DRAFT_MAP_KEY);
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

/** Persist the PRD chat input draft, keyed per project so drafts don't leak
 *  between projects. Tab-scoped (sessionStorage): a draft is session work. */
export function savePrdDraft(projectId: string, draft: string) {
	const storage = getStorage();
	if (!storage) return;
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

export function getOnboardingState(): OnboardingState | null {
	const storage = getStorage();
	const raw = storage?.getItem(ONBOARDING_STATE_KEY);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as OnboardingState;
		if (!parsed || typeof parsed.step !== "number") return null;
		return parsed;
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
		if (!parsed.projectId || !parsed.stage || !parsed.createdAt) return null;
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
