import type { OutputLanguage } from "@/types/database";

export type { OutputLanguage };

export const DEFAULT_LANGUAGE: OutputLanguage = "id";

export interface LanguageOption {
	id: OutputLanguage;
	label: string;
	shortLabel: string;
	flag: string;
}

export const SUPPORTED_LANGUAGES: readonly LanguageOption[] = [
	{
		id: "id",
		label: "Bahasa Indonesia",
		shortLabel: "ID",
		flag: "🇮🇩",
	},
	{
		id: "en",
		label: "English",
		shortLabel: "EN",
		flag: "🇬🇧",
	},
] as const;

/**
 * Normalizes any input into a valid OutputLanguage ('id' | 'en').
 * Defaults to 'id' if invalid or missing.
 */
export function normalizeLanguage(lang?: unknown): OutputLanguage {
	if (lang === "en" || lang === "id") {
		return lang;
	}
	return DEFAULT_LANGUAGE;
}

/**
 * Generates an unambiguous language directive to be appended to AI system prompts.
 * Enforces output in the requested language while explicitly preserving technical terms.
 */
export function getLanguageDirective(
	lang?: OutputLanguage | string | null,
	_stage?: "ask" | "prd" | "ac" | "task",
): string {
	const normalized = normalizeLanguage(lang);

	if (normalized === "en") {
		return `\n=== OUTPUT LANGUAGE DIRECTIVE ===\nCRITICAL: Output ALL content (questions, options, PRD sections, criteria, tasks, descriptions, and details) ENTIRELY in English.\nDo NOT translate standard technical terms, library/framework names, database engines, API endpoints, or code snippets (e.g. keep React, PostgreSQL, REST, GraphQL, Given/When/Then as-is).`;
	}

	return `\n=== OUTPUT LANGUAGE DIRECTIVE ===\nINSTRUKSI KRITIS: Tulis SELURUH konten (pertanyaan, opsi, section PRD, kriteria, nama task, deskripsi, dan rincian langkah) SEPENUHNYA dalam Bahasa Indonesia.\nJANGAN menerjemahkan istilah teknis baku ke dalam bahasa Indonesia (misal: tetap gunakan istilah asli "PostgreSQL", "React", "hooks", "query", "endpoint", "caching", "polling", "Given/When/Then").`;
}

/**
 * Server-safe helper to fetch a project's output language from PostgreSQL.
 * Dynamically imports db and schema to avoid bundling server modules into client.
 */
export async function getProjectLanguage(
	projectId: string,
): Promise<OutputLanguage> {
	if (!projectId) return DEFAULT_LANGUAGE;
	try {
		const { db } = await import("@/db");
		const { projects } = await import("@/db/schema");
		const { and, eq, isNull } = await import("drizzle-orm");

		const [project] = await db
			.select({ language: projects.language })
			.from(projects)
			.where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
			.limit(1);

		return normalizeLanguage(project?.language);
	} catch (err) {
		console.error(
			"Failed to query project language, falling back to default:",
			err,
		);
		return DEFAULT_LANGUAGE;
	}
}
