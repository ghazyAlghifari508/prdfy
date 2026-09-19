import { z } from "zod";
import { codebaseAnalysisStatusSchema } from "./codebase-sync";
import {
	CODEBASE_ANALYSIS_MAX_CONTEXT_CHARS,
	CODEBASE_ANALYSIS_MAX_MANIFEST_ENTRIES,
} from "./constants";
import { extractJson } from "./services/json-extract";

// === Codebase analysis (validated advisory output) ===
// The analysis is advisory: uncertain detections must stay labeled as
// uncertainty/verification items and must never be presented as fact.

export const codebaseAnalysisFindingSchema = z.object({
	title: z.string().min(1),
	detail: z.string().min(1),
	uncertainty: z.string().min(1).optional(),
	relevantPaths: z.array(z.string().min(1)).optional(),
});

export type CodebaseAnalysisFinding = z.infer<
	typeof codebaseAnalysisFindingSchema
>;

export const codebaseAnalysisSchema = z.object({
	projectId: z.string().min(1),
	snapshotId: z.string().min(1),
	framework: z.string().min(1).optional(),
	language: z.string().min(1).optional(),
	packageManager: z.string().min(1).optional(),
	dependencies: z.array(z.string().min(1)).optional(),
	database: z.string().min(1).nullable().optional(),
	auth: z.string().min(1).nullable().optional(),
	moduleMap: z
		.array(
			z.object({
				path: z.string().min(1),
				summary: z.string().min(1),
			}),
		)
		.optional(),
	relevantFiles: z.array(z.string().min(1)).optional(),
	impactAreas: z.array(z.string().min(1)).optional(),
	limitations: z.array(z.string().min(1)).optional(),
	findings: z.array(codebaseAnalysisFindingSchema).optional(),
});

export type CodebaseAnalysis = z.infer<typeof codebaseAnalysisSchema>;

export function parseCodebaseAnalysis(input: unknown): CodebaseAnalysis {
	return codebaseAnalysisSchema.parse(input);
}

export function safeParseCodebaseAnalysis(input: unknown) {
	return codebaseAnalysisSchema.safeParse(input);
}

// === Analysis orchestration boundary (Task 6) ===
// Pure, isomorphic helpers for the server-side analysis flow. Database access
// and model invocation live in `codebase-analysis.server.ts`; everything here
// stays unit-testable without a database or network.

export const CODEBASE_ANALYSIS_SYSTEM_PROMPT = `Kamu adalah PrdFy AI. Analisis snapshot codebase yang disinkronkan dan susun ringkasan arsitektur advisori.

FORMAT JSON (output HANYA JSON, tanpa teks lain):
{
  "framework": "Framework yang terdeteksi, atau null bila tidak terdeteksi",
  "language": "Bahasa utama, atau null bila tidak terdeteksi",
  "packageManager": "Package manager, atau null bila tidak terdeteksi",
  "dependencies": ["dependensi utama"],
  "database": "Database yang terdeteksi, atau null",
  "auth": "Mekanisme auth yang terdeteksi, atau null",
  "moduleMap": [{ "path": "jalur-modul", "summary": "ringkasan singkat" }],
  "relevantFiles": ["jalur file yang relevan"],
  "impactAreas": ["area yang terdampak fitur baru"],
  "limitations": ["keterbatasan snapshot/analisis"],
  "findings": [{ "title": "...", "detail": "...", "uncertainty": "hal yang belum pasti (wajib diisi bila ragu)" }]
}

ATURAN:
1. Output HANYA JSON valid. Jangan tambah penjelasan di luar JSON.
2. JANGAN mengarang jalur file, perilaku framework, atau detail arsitektur yang tidak ada di snapshot. Gunakan HANYA jalur dari manifest.
3. Setiap temuan yang tidak pasti WAJIB mencantumkan field "uncertainty" berisi hal yang perlu diverifikasi.
4. Field yang tidak terdeteksi diisi null atau array kosong — jangan ditebak.
5. Tulis ringkasan dan temuan dalam Bahasa Indonesia.`;

// Manifest entries come from `manifestEntrySchema` (Task 5); this structural
// subset keeps the prompt builder decoupled from the sync DTO module.
export interface AnalysisManifestEntry {
	path: string;
	size: number;
	language?: string;
}

export interface AnalysisSourceFile {
	path: string;
	text: string;
}

export interface AnalysisPromptInput {
	projectId: string;
	snapshotId: string;
	featurePrompt: string;
	manifest: readonly AnalysisManifestEntry[];
	files: readonly AnalysisSourceFile[];
	fileCount: number;
	excludedCount: number;
	branch?: string | null;
	commitSha?: string | null;
	maxContextChars?: number;
	maxManifestEntries?: number;
}

export interface SourceExcerptSelection {
	excerpts: AnalysisSourceFile[];
	truncated: boolean;
}

// Deterministic excerpt selection: files keep manifest order and the total
// text is capped so the model prompt stays bounded. Callers must pass the
// bound from CODEBASE_ANALYSIS_MAX_CONTEXT_CHARS (constants), never inline.
export function selectSourceExcerpts(
	files: readonly AnalysisSourceFile[],
	maxChars: number,
): SourceExcerptSelection {
	const excerpts: AnalysisSourceFile[] = [];
	let used = 0;
	let truncated = false;
	for (const file of files) {
		if (used >= maxChars) {
			truncated = true;
			break;
		}
		const remaining = maxChars - used;
		if (file.text.length <= remaining) {
			excerpts.push(file);
			used += file.text.length;
		} else {
			excerpts.push({ path: file.path, text: file.text.slice(0, remaining) });
			used = maxChars;
			truncated = true;
		}
	}
	return { excerpts, truncated };
}

export function buildAnalysisUserPrompt(input: AnalysisPromptInput): string {
	const {
		projectId,
		snapshotId,
		featurePrompt,
		manifest,
		files,
		fileCount,
		excludedCount,
		branch,
		commitSha,
		maxContextChars = CODEBASE_ANALYSIS_MAX_CONTEXT_CHARS,
		maxManifestEntries = CODEBASE_ANALYSIS_MAX_MANIFEST_ENTRIES,
	} = input;
	const listedManifest = manifest.slice(0, maxManifestEntries);
	const manifestLines = listedManifest.map(
		(entry) =>
			`- ${entry.path} (${entry.size} bytes${entry.language ? `, ${entry.language}` : ""})`,
	);
	if (manifest.length > listedManifest.length) {
		manifestLines.push(
			`(+ ${manifest.length - listedManifest.length} entri lainnya tidak ditampilkan — jangan mengarang jalur di luar daftar ini.)`,
		);
	}
	const { excerpts, truncated } = selectSourceExcerpts(files, maxContextChars);
	const excerptLines = excerpts.map(
		(file) => `=== ${file.path} ===\n${file.text}`,
	);
	const lines = [
		`Project: ${projectId}`,
		`Snapshot: ${snapshotId}${branch ? ` (branch ${branch}${commitSha ? `, commit ${commitSha}` : ""})` : ""}`,
		`File: ${fileCount} terupload, ${excludedCount} dieksklusi (isi file yang dieksklusi TIDAK disertakan).`,
		"",
		`Permintaan fitur user: ${featurePrompt}`,
		"",
		"Manifest (jalur tepercaya — jangan mengarang jalur di luar daftar ini):",
		...manifestLines,
		"",
		"Konteks sumber (terpotong agar terbatas):",
		...excerptLines,
	];
	if (truncated) {
		lines.push(
			"",
			"(Konteks sumber dipotong karena batas ukuran — tandai cakupan yang hilang di limitations.)",
		);
	}
	return lines.join("\n");
}

// === Model output validation ===
// Server identities are injected AFTER parsing: model-provided projectId /
// snapshotId are discarded so a rogue completion cannot rebind the analysis
// to another project or snapshot.

export class AnalysisValidationError extends Error {
	readonly code = "ANALYSIS_FAILED" as const;

	constructor(message: string) {
		super(message);
		this.name = "AnalysisValidationError";
	}
}

export function parseAnalysisOutput(
	raw: string,
	ids: { projectId: string; snapshotId: string },
): CodebaseAnalysis {
	let parsed: unknown;
	try {
		// Strict-JSON boundary: anything that is not JSON (including a
		// mis-rendered HTML page) fails closed into AnalysisValidationError.
		parsed = JSON.parse(extractJson(raw)) as unknown;
	} catch {
		throw new AnalysisValidationError(
			"AI menghasilkan output yang tidak valid. Coba analisis ulang.",
		);
	}
	if (typeof parsed !== "object" || parsed === null) {
		throw new AnalysisValidationError(
			"AI menghasilkan output yang tidak valid. Coba analisis ulang.",
		);
	}
	const {
		projectId: _droppedProject,
		snapshotId: _droppedSnapshot,
		...rest
	} = parsed as Record<string, unknown>;
	const result = codebaseAnalysisSchema.safeParse({
		...rest,
		projectId: ids.projectId,
		snapshotId: ids.snapshotId,
	});
	if (!result.success) {
		throw new AnalysisValidationError(
			"AI menghasilkan output yang tidak valid. Coba analisis ulang.",
		);
	}
	return result.data;
}

// Fixed user-facing message. Never echoes model text, stack traces, tokens,
// or source content — the caller stores only this string.
export function toSafeAnalysisErrorMessage(error: unknown): string {
	void error;
	return "Analisis codebase gagal. Coba analisis ulang dalam beberapa menit.";
}

// === Idempotent trigger decision (pure, DB-agnostic) ===
// The route loads the snapshot row + its analysis rows, then applies this
// decision: analysis runs ONLY on uploaded snapshots; a pending or ready
// record is reused; each new attempt after failure gets a fresh record.

export type AnalysisRequestDecision =
	| { action: "create" }
	| { action: "reuse"; analysisId: string }
	| { action: "reject"; code: "SNAPSHOT_NOT_UPLOADED"; message: string };

export function decideAnalysisRequest(
	snapshot: { id: string; status: string },
	analyses: readonly { id: string; status: string }[],
): AnalysisRequestDecision {
	if (snapshot.status !== "uploaded") {
		return {
			action: "reject",
			code: "SNAPSHOT_NOT_UPLOADED",
			message:
				"Snapshot belum siap dianalisis. Selesaikan sync terlebih dahulu.",
		};
	}
	const pending = analyses.find((analysis) => analysis.status === "pending");
	if (pending) return { action: "reuse", analysisId: pending.id };
	const ready = analyses.find((analysis) => analysis.status === "ready");
	if (ready) return { action: "reuse", analysisId: ready.id };
	return { action: "create" };
}

// === Trigger/read DTOs ===

export const analysisRequestSchema = z.object({
	snapshotId: z.string().min(1).optional(),
});

export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;

export const analysisResponseSchema = z.object({
	id: z.string().min(1),
	projectId: z.string().min(1),
	snapshotId: z.string().min(1),
	status: codebaseAnalysisStatusSchema,
	output: codebaseAnalysisSchema.nullable().optional(),
	errorCode: z.string().min(1).nullable().optional(),
	errorMessage: z.string().min(1).nullable().optional(),
	createdAt: z.string().datetime().optional(),
	updatedAt: z.string().datetime().optional(),
});

export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;
