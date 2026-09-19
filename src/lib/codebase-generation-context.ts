import { z } from "zod";
import type {
	CodebaseAnalysis,
	CodebaseAnalysisFinding,
} from "./codebase-analysis";
import { safeParseCodebaseAnalysis } from "./codebase-analysis";
import type { SnapshotContext } from "./codebase-sync";
import { manifestEntrySchema, selectActiveSnapshot } from "./codebase-sync";
import {
	CODEBASE_ASK_HANDOFF_MAX_ANSWERS,
	CODEBASE_ASK_HANDOFF_MAX_OPTIONS,
	CODEBASE_ASK_HANDOFF_MAX_PROMPT_CHARS,
	CODEBASE_ASK_HANDOFF_MAX_STATE_CHARS,
	CODEBASE_GENERATION_MAX_ANSWER_CHARS,
	CODEBASE_GENERATION_MAX_CONSTRAINTS,
	CODEBASE_GENERATION_MAX_CONTEXT_CHARS,
	CODEBASE_GENERATION_MAX_FINDINGS,
	CODEBASE_GENERATION_MAX_PATHS,
	CODEBASE_GENERATION_MAX_PROMPT_CHARS,
	CODEBASE_GENERATION_MAX_SUMMARY_CHARS,
	MAX_PROMPT_LENGTH,
} from "./constants";

// === Generation context ===
// Snapshot identity is linked to generated output through this
// project-owned context record instead of changing existing AC/task version
// semantics. Every stage (Ask, PRD, AC, Task) receives the same six sections:
// feature request, user answers, codebase analysis, relevant module/file
// paths, known constraints, and the source snapshot identifier.

export interface GenerationContextInput {
	featurePrompt: string;
	userAnswers?: string[];
	analysis: CodebaseAnalysis;
	snapshot: SnapshotContext;
	/** Analysis DB record id, filled by the caller loading from storage. */
	analysisId?: string;
}

export interface SnapshotGenerationContext {
	projectId: string;
	snapshotId: string;
	analysisId?: string;
	featurePrompt: string;
	userAnswers: string[];
	analysisSummary: string;
	relevantPaths: string[];
	constraints: string[];
	uncertainFindings: CodebaseAnalysisFinding[];
}

export function buildAnalysisSummary(analysis: CodebaseAnalysis): string {
	const parts: string[] = [];
	if (analysis.framework) parts.push(`framework ${analysis.framework}`);
	if (analysis.language) parts.push(`language ${analysis.language}`);
	if (analysis.packageManager)
		parts.push(`package manager ${analysis.packageManager}`);
	if (analysis.dependencies && analysis.dependencies.length > 0)
		parts.push(`dependencies ${analysis.dependencies.join(", ")}`);
	if (analysis.database) parts.push(`database ${analysis.database}`);
	if (analysis.auth) parts.push(`auth ${analysis.auth}`);
	for (const entry of analysis.moduleMap ?? []) {
		parts.push(`${entry.path} (${entry.summary})`);
	}
	return parts.length > 0 ? parts.join("; ") : "-";
}

export function buildGenerationContext(
	input: GenerationContextInput,
): SnapshotGenerationContext {
	const {
		featurePrompt,
		userAnswers = [],
		analysis,
		snapshot,
		analysisId,
	} = input;
	const relevantPaths = [
		...(analysis.relevantFiles ?? []),
		...(analysis.moduleMap?.map((entry) => entry.path) ?? []),
		...(snapshot.relevantPaths ?? []),
	];
	const constraints = [...(analysis.limitations ?? [])];
	const uncertainFindings = (analysis.findings ?? []).filter(
		(finding) => finding.uncertainty && finding.uncertainty.length > 0,
	);
	return {
		projectId: snapshot.projectId,
		snapshotId: snapshot.snapshotId,
		analysisId,
		featurePrompt,
		userAnswers,
		analysisSummary: buildAnalysisSummary(analysis),
		relevantPaths: [...new Set(relevantPaths)],
		constraints,
		uncertainFindings,
	};
}

export function formatGenerationContext(
	context: SnapshotGenerationContext,
): string {
	const lines = [
		`Feature request: ${context.featurePrompt}`,
		`User answers: ${context.userAnswers.length > 0 ? context.userAnswers.join(" | ") : "-"}`,
		`Codebase analysis: ${context.analysisSummary}`,
		`Relevant modules/files: ${context.relevantPaths.length > 0 ? context.relevantPaths.join(", ") : "-"}`,
		`Known constraints: ${context.constraints.length > 0 ? context.constraints.join(" | ") : "-"}`,
		...context.uncertainFindings.map(
			(finding) =>
				`Assumption to verify [${finding.title}]: ${finding.uncertainty}`,
		),
		`Source snapshot: ${context.snapshotId}`,
	];
	return lines.join("\n");
}

// === Task 8: bounded generation grounding + Ask handoff ===
// Plan interface alias: getProjectGenerationContext(projectId) returns null
// for greenfield and a snapshot-bound GenerationContext for ready
// existing-codebase projects. Every generator consumes this one builder —
// snapshot queries and formatting are never duplicated per route.

/** Plan-interface alias for the snapshot-bound generation context. */
export type GenerationContext = SnapshotGenerationContext;

export function truncateText(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return value.slice(0, maxChars);
}

/** Bound a context to the CODEBASE_GENERATION_* limits. Snapshot identity
 *  (projectId/snapshotId/analysisId) always survives limiting. */
export function limitGenerationContext(
	context: SnapshotGenerationContext,
): SnapshotGenerationContext {
	return {
		...context,
		featurePrompt: truncateText(
			context.featurePrompt,
			CODEBASE_GENERATION_MAX_PROMPT_CHARS,
		),
		userAnswers: context.userAnswers.map((answer) =>
			truncateText(answer, CODEBASE_GENERATION_MAX_ANSWER_CHARS),
		),
		analysisSummary: truncateText(
			context.analysisSummary,
			CODEBASE_GENERATION_MAX_SUMMARY_CHARS,
		),
		constraints: context.constraints.slice(
			0,
			CODEBASE_GENERATION_MAX_CONSTRAINTS,
		),
		relevantPaths: context.relevantPaths.slice(
			0,
			CODEBASE_GENERATION_MAX_PATHS,
		),
		uncertainFindings: context.uncertainFindings.slice(
			0,
			CODEBASE_GENERATION_MAX_FINDINGS,
		),
	};
}

/** One formatting boundary: limited sections, then a hard char ceiling so
 *  arbitrary unbounded source content never reaches a model prompt. */
export function formatBoundedGenerationContext(
	context: SnapshotGenerationContext,
): string {
	return truncateText(
		formatGenerationContext(limitGenerationContext(context)),
		CODEBASE_GENERATION_MAX_CONTEXT_CHARS,
	);
}

const CODEBASE_BLOCK_START = "--- KONTEKS CODEBASE EXISTING ---";
const CODEBASE_BLOCK_END = "--- AKHIR KONTEKS CODEBASE ---";

/** Single injection helper for Ask/PRD/AC/Task. Null (greenfield) returns ""
 *  so greenfield prompts stay byte-identical. Ready context returns a framed,
 *  bounded block that labels uncertainty as assumptions and instructs the
 *  model never to invent paths or architecture. */
export function buildCodebasePromptBlock(
	context: SnapshotGenerationContext | null,
): string {
	if (!context) return "";
	const body = formatBoundedGenerationContext(context);
	return [
		"",
		CODEBASE_BLOCK_START,
		`Snapshot sumber: ${context.snapshotId}.`,
		body,
		"ATURAN: JANGAN mengarang jalur file, perilaku framework, atau detail arsitektur yang tidak ada di konteks di atas. Gunakan HANYA jalur dari daftar Relevant modules/files. Setiap hal yang tidak pasti adalah asumsi yang wajib diverifikasi — tandai sebagai asumsi, jangan sajikan sebagai fakta.",
		CODEBASE_BLOCK_END,
	].join("\n");
}

// === Ready-analysis selection (pure, DB-agnostic) ===
// Generation consumes the latest ready analysis only. Missing, pending, or
// failed analyses are rejected (null) — a failed snapshot is never exposed
// as ready context.

export interface ReadyAnalysisCandidate {
	id: string;
	status: string;
	createdAt: string;
}

export function selectReadyAnalysis<T extends ReadyAnalysisCandidate>(
	analyses: readonly T[],
): T | null {
	const ready = [...analyses]
		.filter((analysis) => analysis.status === "ready")
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	return ready[0] ?? null;
}

// === Ask handoff validation (pure) ===
// Authoritative server-side copy of Ask answers/compiled prompt for
// existing-codebase projects. Bounded so refresh/multi-device restore stays
// cheap; sessionStorage remains for UI continuity.

export const askHandoffAnswerSchema = z.object({
	question: z.string().min(1).max(500),
	answer: z.string().min(1).max(2000),
});

export const askHandoffQuestionSchema = z.object({
	id: z.string().min(1).max(128),
	question: z.string().min(1).max(500),
	type: z.enum(["select", "text", "multiselect"]),
	options: z.array(z.string().min(1).max(100)).max(12).optional(),
});

export const askHandoffNonTechAnswerSchema = z.object({
	value: z.string().default(""),
	isCustom: z.boolean().default(false),
	skipped: z.boolean().default(false),
	values: z.array(z.string()).optional(),
});

export const askHandoffTechAnswersSchema = z.object({
	frontend: z.string().optional(),
	backend: z.string().optional(),
	fullstackFramework: z.string().optional(),
	database: z.string().optional(),
	deployment: z.string().optional(),
});

export const askHandoffStateSchema = z.object({
	prompt: z
		.string()
		.min(1)
		.max(MAX_PROMPT_LENGTH * 2),
	platform: z.enum(["web", "mobile"]).optional(),
	session: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
	questions: z.array(askHandoffQuestionSchema).max(24).optional(),
	nonTechAnswers: z
		.record(z.string(), askHandoffNonTechAnswerSchema)
		.optional(),
	techAnswers: askHandoffTechAnswersSchema.optional(),
	skippedTech: z.array(z.string().max(64)).max(12).optional(),
});

export type AskHandoffState = z.infer<typeof askHandoffStateSchema>;

export const askHandoffSchema = z.object({
	projectId: z.string().min(1),
	answers: z
		.array(askHandoffAnswerSchema)
		.max(CODEBASE_ASK_HANDOFF_MAX_ANSWERS * 2)
		.default([]),
	compiledPrompt: z
		.string()
		.max(CODEBASE_ASK_HANDOFF_MAX_PROMPT_CHARS * 2)
		.optional(),
	snapshotId: z.string().min(1).nullable().optional(),
	state: askHandoffStateSchema.optional(),
});

export type AskHandoff = z.infer<typeof askHandoffSchema>;

/** Bound the restorable Ask UI snapshot: question/option counts capped,
 *  long strings truncated, and the serialized total kept under budget. */
export function sanitizeAskHandoffState(
	state: AskHandoffState,
): AskHandoffState {
	const questions = (state.questions ?? [])
		.slice(0, CODEBASE_ASK_HANDOFF_MAX_ANSWERS)
		.map((q) => ({
			id: truncateText(q.id, 128),
			question: truncateText(q.question, 500),
			type: q.type,
			...(q.options
				? {
						options: q.options
							.slice(0, CODEBASE_ASK_HANDOFF_MAX_OPTIONS)
							.map((o) => truncateText(o, 100)),
					}
				: {}),
		}));
	const clean: AskHandoffState = {
		prompt: truncateText(state.prompt, MAX_PROMPT_LENGTH),
		...(state.platform ? { platform: state.platform } : {}),
		...(state.session ? { session: state.session } : {}),
		questions,
	};
	if (state.nonTechAnswers && typeof state.nonTechAnswers === "object") {
		clean.nonTechAnswers = state.nonTechAnswers;
	}
	if (state.techAnswers && typeof state.techAnswers === "object") {
		clean.techAnswers = state.techAnswers;
	}
	if (state.skippedTech) {
		clean.skippedTech = state.skippedTech.slice(0, 12);
	}
	// Total-size guard: drop the heavy free-form maps first if oversized.
	let serialized = JSON.stringify(clean);
	if (serialized.length > CODEBASE_ASK_HANDOFF_MAX_STATE_CHARS) {
		delete clean.nonTechAnswers;
		delete clean.techAnswers;
		serialized = JSON.stringify(clean);
	}
	if (serialized.length > CODEBASE_ASK_HANDOFF_MAX_STATE_CHARS) {
		clean.questions = [];
	}
	return clean;
}

export function sanitizeAskHandoff(input: AskHandoff): AskHandoff {
	return {
		projectId: input.projectId,
		answers: (input.answers ?? []).slice(0, CODEBASE_ASK_HANDOFF_MAX_ANSWERS),
		...(input.compiledPrompt
			? {
					compiledPrompt: truncateText(
						input.compiledPrompt,
						CODEBASE_ASK_HANDOFF_MAX_PROMPT_CHARS,
					),
				}
			: {}),
		...(input.snapshotId ? { snapshotId: input.snapshotId } : {}),
		...(input.state ? { state: sanitizeAskHandoffState(input.state) } : {}),
	};
}

/** Neutral structural rendering of stored answers (no secrets involved —
 *  answers are user-provided product preferences only). */
export function buildAskHandoffPrompt(
	answers: ReadonlyArray<{ question: string; answer: string }>,
): string {
	if (answers.length === 0) return "-";
	return answers.map((a) => `- ${a.question}: ${a.answer}`).join("\n");
}

/** Loose parse of the jsonb answers column: malformed entries are dropped,
 *  never thrown, so a corrupt handoff degrades to empty answers. */
export function parseStoredHandoffAnswers(
	value: unknown,
): Array<{ question: string; answer: string }> {
	if (!Array.isArray(value)) return [];
	const out: Array<{ question: string; answer: string }> = [];
	for (const entry of value) {
		if (
			typeof entry === "object" &&
			entry !== null &&
			typeof (entry as { question?: unknown }).question === "string" &&
			typeof (entry as { answer?: unknown }).answer === "string"
		) {
			const question = (entry as { question: string }).question.trim();
			const answer = (entry as { answer: string }).answer.trim();
			if (question && answer) out.push({ question, answer });
		}
	}
	return out.slice(0, CODEBASE_ASK_HANDOFF_MAX_ANSWERS);
}

// === Generation link row (pure) ===
// Snapshot identity is linked to generated output through a
// codebase_generation_contexts record instead of changing AC/task
// version/deletion semantics.

export interface GenerationLinkInput {
	projectId: string;
	snapshotId: string;
	analysisId?: string;
}

export interface GenerationLinkRow {
	id: string;
	projectId: string;
	snapshotId: string;
	analysisId: string | null;
}

function newLinkId(): string {
	try {
		if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
			return crypto.randomUUID();
		}
	} catch {
		/* fall through to Math.random fallback */
	}
	return `gen_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function buildGenerationLinkRow(
	input: GenerationLinkInput,
): GenerationLinkRow {
	return {
		id: newLinkId(),
		projectId: input.projectId,
		snapshotId: input.snapshotId,
		analysisId: input.analysisId ?? null,
	};
}

// === Server loaders (dynamic db import keeps server-only deps out of the
// client bundle; never import "@/db" at module top-level here) ===

/** Load the validated, snapshot-bound generation context for a project.
 *  Returns null for greenfield projects, projects without a ready snapshot,
 *  or snapshots without a ready (validated) analysis. Never throws for
 *  missing data — callers treat null as "generate without codebase context".
 *  Consumes no credits. */
export async function getProjectGenerationContext(
	projectId: string,
): Promise<GenerationContext | null> {
	const { db } = await import("@/db");
	const { codebaseAnalyses, codebaseAskHandoffs, codebaseSnapshots, projects } =
		await import("@/db/schema");
	const { and, asc, desc, eq } = await import("drizzle-orm");

	const [project] = await db
		.select({
			projectMode: projects.projectMode,
			name: projects.name,
			description: projects.description,
		})
		.from(projects)
		.where(eq(projects.id, projectId))
		.limit(1);
	if (!project || project.projectMode !== "existing_codebase") return null;

	const snapshotRows = await db
		.select({
			id: codebaseSnapshots.id,
			status: codebaseSnapshots.status,
			branch: codebaseSnapshots.branch,
			commitSha: codebaseSnapshots.commitSha,
			manifest: codebaseSnapshots.manifest,
			fileCount: codebaseSnapshots.fileCount,
			excludedCount: codebaseSnapshots.excludedCount,
			createdAt: codebaseSnapshots.createdAt,
		})
		.from(codebaseSnapshots)
		.where(
			and(
				eq(codebaseSnapshots.projectId, projectId),
				eq(codebaseSnapshots.status, "ready"),
			),
		)
		.orderBy(asc(codebaseSnapshots.createdAt));
	const active = selectActiveSnapshot(
		snapshotRows.map((row) => ({
			id: row.id,
			status: row.status,
			createdAt: row.createdAt?.toISOString() ?? "",
		})),
	);
	if (!active) return null;
	const activeRow = snapshotRows.find((row) => row.id === active.id);
	if (!activeRow) return null;

	const analysisRows = await db
		.select({
			id: codebaseAnalyses.id,
			status: codebaseAnalyses.status,
			output: codebaseAnalyses.output,
			createdAt: codebaseAnalyses.createdAt,
		})
		.from(codebaseAnalyses)
		.where(
			and(
				eq(codebaseAnalyses.projectId, projectId),
				eq(codebaseAnalyses.snapshotId, activeRow.id),
			),
		)
		.orderBy(desc(codebaseAnalyses.createdAt));
	const readyAnalysis = selectReadyAnalysis(
		analysisRows.map((row) => ({
			id: row.id,
			status: row.status,
			createdAt: row.createdAt?.toISOString() ?? "",
		})),
	);
	if (!readyAnalysis) return null;
	const readyRow = analysisRows.find((row) => row.id === readyAnalysis.id);
	const parsed = safeParseCodebaseAnalysis(readyRow?.output);
	if (!parsed.success) return null;

	// Relevant paths come from the validated manifest only — never invented.
	let relevantPaths: string[] = [];
	try {
		const manifest = manifestEntrySchema
			.array()
			.safeParse(activeRow.manifest ?? []);
		if (manifest.success) {
			relevantPaths = manifest.data
				.map((entry) => entry.path)
				.slice(0, CODEBASE_GENERATION_MAX_PATHS);
		}
	} catch {
		relevantPaths = [];
	}

	// Authoritative persisted Ask answers (best-effort: missing handoff
	// degrades to empty answers, never a generation failure).
	let userAnswers: string[] = [];
	try {
		const [handoff] = await db
			.select({
				answers: codebaseAskHandoffs.answers,
				snapshotId: codebaseAskHandoffs.snapshotId,
			})
			.from(codebaseAskHandoffs)
			.where(eq(codebaseAskHandoffs.projectId, projectId))
			.limit(1);
		if (handoff) {
			userAnswers = parseStoredHandoffAnswers(handoff.answers).map(
				(entry) =>
					`${truncateText(entry.question, 200)}: ${truncateText(entry.answer, CODEBASE_GENERATION_MAX_ANSWER_CHARS)}`,
			);
		}
	} catch {
		userAnswers = [];
	}

	const featurePrompt =
		project.description?.trim() || project.name?.trim() || projectId;

	return buildGenerationContext({
		featurePrompt,
		userAnswers,
		analysis: parsed.data,
		snapshot: {
			snapshotId: activeRow.id,
			projectId,
			branch: activeRow.branch,
			commitSha: activeRow.commitSha,
			fileCount: activeRow.fileCount ?? 0,
			excludedCount: activeRow.excludedCount ?? 0,
			relevantPaths,
		},
		analysisId: readyRow?.id,
	});
}

/** Resolve the currently active ready snapshot id for handoff
 *  traceability (Task 9 write-through). Returns null when no snapshot is
 *  ready, but preserves database failures so callers never silently lose
 *  snapshot identity. Generation still resolves
 *  the active snapshot at call time (first-ready default, see
 *  selectActiveSnapshot); the stamped id is advisory traceability only. */
export async function resolveActiveSnapshotId(
	projectId: string,
): Promise<string | null> {
	const { db } = await import("@/db");
	const { codebaseSnapshots } = await import("@/db/schema");
	const { and, asc, eq } = await import("drizzle-orm");
	const rows = await db
		.select({
			id: codebaseSnapshots.id,
			status: codebaseSnapshots.status,
			createdAt: codebaseSnapshots.createdAt,
		})
		.from(codebaseSnapshots)
		.where(
			and(
				eq(codebaseSnapshots.projectId, projectId),
				eq(codebaseSnapshots.status, "ready"),
			),
		)
		.orderBy(asc(codebaseSnapshots.createdAt));
	const active = selectActiveSnapshot(
		rows.map((row) => ({
			id: row.id,
			status: row.status,
			createdAt: row.createdAt?.toISOString() ?? "",
		})),
	);
	return active?.id ?? null;
}

/** Persist the snapshot-identity link after a successful generation.
 *  Non-fatal by design: link failures never block generation output.
 *  Consumes no credits. */
export async function linkGenerationContext(
	projectId: string,
	snapshotId: string,
	analysisId?: string,
): Promise<void> {
	try {
		const { db } = await import("@/db");
		const { codebaseGenerationContexts } = await import("@/db/schema");
		await db
			.insert(codebaseGenerationContexts)
			.values(buildGenerationLinkRow({ projectId, snapshotId, analysisId }));
	} catch (error) {
		console.warn("linkGenerationContext skipped:", error);
	}
}

/** Upsert the authoritative Ask handoff (ownership-checked by the caller).
 *  Throws on DB errors — the route maps them to 500. */
export async function saveAskHandoff(
	userId: string,
	input: AskHandoff,
): Promise<void> {
	const clean = sanitizeAskHandoff(input);
	const { db } = await import("@/db");
	const { codebaseAskHandoffs } = await import("@/db/schema");
	await db
		.insert(codebaseAskHandoffs)
		.values({
			projectId: clean.projectId,
			userId,
			snapshotId: clean.snapshotId ?? null,
			answers: clean.answers,
			compiledPrompt: clean.compiledPrompt ?? null,
			state: clean.state ?? null,
			updatedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: [codebaseAskHandoffs.projectId],
			set: {
				userId,
				snapshotId: clean.snapshotId ?? null,
				answers: clean.answers,
				...(clean.compiledPrompt !== undefined
					? { compiledPrompt: clean.compiledPrompt }
					: {}),
				state: clean.state ?? null,
				updatedAt: new Date(),
			},
		});
}

/** Read the authoritative Ask handoff. Returns null when absent or owned by
 *  another user — never throws for missing data. */
export async function getAskHandoff(
	projectId: string,
	userId: string,
): Promise<AskHandoff | null> {
	const { db } = await import("@/db");
	const { codebaseAskHandoffs } = await import("@/db/schema");
	const { and, eq } = await import("drizzle-orm");
	const [row] = await db
		.select({
			answers: codebaseAskHandoffs.answers,
			compiledPrompt: codebaseAskHandoffs.compiledPrompt,
			snapshotId: codebaseAskHandoffs.snapshotId,
			state: codebaseAskHandoffs.state,
		})
		.from(codebaseAskHandoffs)
		.where(
			and(
				eq(codebaseAskHandoffs.projectId, projectId),
				eq(codebaseAskHandoffs.userId, userId),
			),
		)
		.limit(1);
	if (!row) {
		return null;
	}
	if (!row.compiledPrompt && !row.state) {
		return null;
	}
	const stateParsed =
		row.state && typeof row.state === "object"
			? askHandoffStateSchema.safeParse(row.state)
			: null;
	return sanitizeAskHandoff({
		projectId,
		answers: parseStoredHandoffAnswers(row.answers),
		...(row.compiledPrompt ? { compiledPrompt: row.compiledPrompt } : {}),
		...(row.snapshotId ? { snapshotId: row.snapshotId } : {}),
		...(stateParsed?.success ? { state: stateParsed.data } : {}),
	});
}
