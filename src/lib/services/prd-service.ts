/**
 * PRD helpers + DB ops - Drizzle. New schema: prd_versions(project_id, version,
 * content, change_summary); projects.share_token exists.
 */
import { randomBytes } from "node:crypto";

/**
 * Normalize a content document that an AI model mis-rendered as a full HTML
 * page back into plain text (strip markup, keep visible text). Leaves any
 * document that does not look like a whole HTML page untouched, so valid
 * markdown survives unaffected. Structural rule only — independent of any
 * specific model, symptom, or provider.
 */
export function sanitizeModelOutput(content: string): string {
	if (!content) return content;
	const isFullHtmlPage =
		/^\s*<!DOCTYPE\s+html/i.test(content) && /<\/html>/i.test(content);
	if (!isFullHtmlPage) return content;
	const stripped = content
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<head[\s\S]*?<\/head>/gi, " ");
	const text = stripped
		.replace(/><(?=\/?)/g, "> <")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > 0 ? text : content;
}

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, prdVersions, projects } from "@/db/schema";
import { advanceStep } from "@/lib/flow-progress";

// ponytail: moved from utils.ts - node:crypto crashes browser bundles via utils.ts.
export function generateShareToken(): string {
	return randomBytes(9).toString("base64url");
}

/**
 * Strip known PRD prompt boilerplate so name heuristics see only user content.
 */
function stripPrdBoilerplate(message: string): string {
	let cleanMsg = message;
	cleanMsg = cleanMsg.replace(
		/Generate PRD lengkap berdasarkan informasi berikut:\s*/gi,
		"",
	);
	cleanMsg = cleanMsg.replace(
		/\s*Gunakan section markers sesuai standar./gi,
		"",
	);
	cleanMsg = cleanMsg.replace(/\[Platform:.*?\]\s*/gi, "");
	return cleanMsg.trim();
}

/**
 * Single source of truth for explicit product-name patterns (quoted name,
 * bernama/dinamakan/named/called X, CamelCase brand token). Shared by
 * deriveProjectNameSync and hasExplicitProductName so both accept exactly the
 * same captures.
 */
function findExplicitProductName(
	message: string,
): { explicit: string; isCamelToken: boolean } | null {
	const cleanMsg = stripPrdBoilerplate(message);

	// ponytail: explicit product-name beats word-salad heuristics.
	// 1) "Quoted name" (straight or typographic quotes)
	const quoted = cleanMsg.match(
		/["\u201C\u201D\u2018\u2019]([\w][\w .&-]{1,39})["\u201C\u201D\u2018\u2019]/,
	);
	// 2) bernama/dinamakan/named/called X
	const named = cleanMsg.match(
		/\b(?:bernama|dinamakan|dengan\s+nama|named|called)\s+([A-Za-z][\w-]{1,39})/i,
	);
	// 3) CamelCase brand token (HabitFlow, NovaPay) — min 2 humps
	const camel = cleanMsg.match(/\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)\b/);

	const explicit = quoted?.[1]?.trim() ?? named?.[1] ?? camel?.[1];
	if (!explicit || explicit.replace(/\s/g, "").length < 3) return null;
	return {
		explicit,
		isCamelToken: explicit === camel?.[1] && !/\s/.test(explicit),
	};
}

/**
 * True iff the user's message contains an EXPLICIT product-name pattern
 * (quoted name / bernama-X / CamelCase token). When true, the user gave an
 * intentional name — the async AI rename must not override it.
 */
export function hasExplicitProductName(message: string): boolean {
	return findExplicitProductName(message) !== null;
}

/**
 * Synchronous regex-only project name derivation.
 * Instant, no AI call. Used at project creation for speed.
 * AI-quality name comes later via deriveProjectName() in chat.ts SSE stream.
 */
export function deriveProjectNameSync(message: string): string {
	const match = findExplicitProductName(message);
	if (match) {
		const { explicit, isCamelToken } = match;
		const titled = isCamelToken
			? explicit
			: explicit
					.split(/\s+/)
					.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
					.join(" ");
		return titled.slice(0, 40).trim();
	}

	const cleanMsg = stripPrdBoilerplate(message);

	const fillers = [
		"tolong",
		"coba",
		"bantu",
		"harap",
		"buatkan",
		"bikin",
		"generate",
		"tuliskan",
		"buat",
		"bikinin",
		"dong",
		"ya",
		"yaa",
		"gw",
		"saya",
		"kami",
		"aku",
		"gue",
		"sebuah",
		"satu",
		"suatu",
		"itu",
		"ini",
		"prd",
		"dokumen",
		"file",
		"untuk",
		"tentang",
		"dengan",
		"yang",
		"dan",
		"atau",
		"serta",
		"dari",
		"ke",
		"di",
		"pada",
		"adalah",
		"akan",
		"bisa",
		"juga",
		"the",
		"a",
		"an",
		"of",
		"and",
		"or",
		"for",
		"to",
		"in",
		"on",
		"with",
		"that",
		"this",
		"is",
		"are",
		"was",
		"be",
		"has",
		"have",
		"its",
		"it",
		"by",
		"from",
		"but",
		"not",
		"no",
		"so",
		"if",
		"membuat",
		"membangun",
		"menggunakan",
		"ada",
		"aplikasi",
		"website",
		"platform",
		"sistem",
		"web",
		"app",
		"apps",
		"mobile",
		"desktop",
		"software",
		"project",
		"proyek",
		"baru",
		"simple",
		"basic",
		"lengkap",
		"sederhana",
		"modern",
	];
	let fallback = cleanMsg.replace(/\[.*?\]\s*/g, "");
	const fillerRegex = new RegExp(`\\b(?:${fillers.join("|")})\\b`, "gi");
	fallback = fallback
		.replace(fillerRegex, "")
		.replace(/[^\w\s-]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (fallback.length < 2) return "Project Baru";
	const words = fallback.split(" ").filter((w) => w.length > 1);
	if (words.length === 0) return "Project Baru";
	const tail = words.slice(-4);
	return (
		tail.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") ||
		"Project Baru"
	);
}

/**
 * Derive a human-readable project name from the user's raw prompt.
 * Uses AI to extract the core app concept, with regex fallback if AI fails.
 */
export async function deriveProjectName(message: string): Promise<string> {
	// Strip platform tags and known boilerplate
	let cleanMsg = message;
	cleanMsg = cleanMsg.replace(
		/Generate PRD lengkap berdasarkan informasi berikut:\s*/gi,
		"",
	);
	cleanMsg = cleanMsg.replace(
		/\s*Gunakan section markers sesuai standar./gi,
		"",
	);
	cleanMsg = cleanMsg.replace(/\[Platform:.*?\]\s*/gi, "");
	cleanMsg = cleanMsg.trim();

	// AI path: ask model to extract a short project title
	try {
		const { completeChat } = await import("@/lib/ai-client");
		const title = await completeChat(
			[
				{
					role: "system",
					content:
						"Extract a short project/app name (2-5 words) from the user's prompt. " +
						"Return ONLY the name, nothing else. No quotes, no punctuation, no explanation. " +
						"Use Title Case. Examples: 'Padel Booking', 'Kasir POS', 'LMS Gamifikasi', 'E-Commerce Marketplace'.",
				},
				{ role: "user", content: cleanMsg },
			],
			"oc/big-pickle",
		);
		const cleaned = title
			.trim()
			.replace(/^["']|["']$/g, "")
			.replace(/\.$/, "");
		if (cleaned.length >= 2 && cleaned.length <= 60) return cleaned;
	} catch {
		// Fall through to regex fallback
	}

	// Regex fallback: strip fillers, take last meaningful words
	const fillers = [
		"tolong",
		"coba",
		"bantu",
		"harap",
		"buatkan",
		"bikin",
		"generate",
		"tuliskan",
		"buat",
		"bikinin",
		"dong",
		"ya",
		"yaa",
		"gw",
		"saya",
		"kami",
		"aku",
		"gue",
		"sebuah",
		"satu",
		"suatu",
		"itu",
		"ini",
		"prd",
		"dokumen",
		"file",
		"untuk",
		"tentang",
		"dengan",
		"yang",
		"dan",
		"atau",
		"serta",
		"dari",
		"ke",
		"di",
		"pada",
		"adalah",
		"akan",
		"bisa",
		"juga",
		"the",
		"a",
		"an",
		"of",
		"and",
		"or",
		"for",
		"to",
		"in",
		"on",
		"with",
		"that",
		"this",
		"is",
		"are",
		"was",
		"be",
		"has",
		"have",
		"its",
		"it",
		"by",
		"from",
		"but",
		"not",
		"no",
		"so",
		"if",
		"membuat",
		"membangun",
		"menggunakan",
		"ada",
		"aplikasi",
		"website",
		"platform",
		"sistem",
		"web",
		"app",
		"apps",
		"mobile",
		"desktop",
		"software",
		"project",
		"proyek",
		"baru",
		"simple",
		"basic",
		"lengkap",
		"sederhana",
		"modern",
	];
	let fallback = cleanMsg.replace(/\[.*?\]\s*/g, "");
	const fillerRegex = new RegExp(`\\b(?:${fillers.join("|")})\\b`, "gi");
	fallback = fallback
		.replace(fillerRegex, "")
		.replace(/[^\w\s-]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (fallback.length < 2) return "Project Baru";
	const words = fallback.split(" ").filter((w) => w.length > 1);
	if (words.length === 0) return "Project Baru";
	const tail = words.slice(-4);
	return (
		tail.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") ||
		"Project Baru"
	);
}

/**
 * Save a PRD version + mark project completed. On generate, set share token.
 * Resolves projectId from conversationId if needed.
 */
export async function savePrdVersion(
	idOrConversationId: string,
	fullResponse: string,
	userMessage: string,
	mode: "generate" | "revise",
	allowShareLink = true,
): Promise<{ prdVersionId: string; version: number } | undefined> {
	let projectId: string | undefined;
	const [conv] = await db
		.select({ projectId: conversations.projectId })
		.from(conversations)
		.where(eq(conversations.id, idOrConversationId))
		.limit(1);
	if (conv?.projectId) {
		projectId = conv.projectId;
	} else {
		const [proj] = await db
			.select({ id: projects.id })
			.from(projects)
			.where(eq(projects.id, idOrConversationId))
			.limit(1);
		if (proj?.id) {
			projectId = proj.id;
		}
	}
	if (!projectId) {
		console.warn(
			"savePrdVersion: conversation or project missing, content discarded",
			{ idOrConversationId },
		);
		return undefined;
	}

	if (mode === "generate" && allowShareLink) {
		await db
			.update(projects)
			.set({ shareToken: generateShareToken() })
			.where(eq(projects.id, projectId));
	}

	// Enforce the PRD contract before persist: a generate must carry all 8
	// section markers. HTML-page output (a model that ignored the markdown
	// instruction) is unwrapped to text when possible; a document with fewer
	// than all 8 unique markers is a truncated/aborted generation (a model that
	// stopped early with finish_reason "stop") and is rejected rather than saved
	// as a broken version — the truncation guard can't rely on finishReason
	// alone because providers report "stop" even for premature ends. Revisions
	// patch into existing content, so they may legitimately ship a single block.
	const cleanContent = sanitizeModelOutput(fullResponse);
	const sectionMarkerCount = (
		cleanContent.match(/<!--\s*SECTION:\s*([^-\n]+?)\s*-->/gi) || []
	).filter((m, i, arr) => arr.indexOf(m) === i).length;
	if (mode === "generate" && cleanContent.trim() && sectionMarkerCount < 8) {
		throw new Error(
			"PRD output tidak lengkap (kurang dari 8 section). Tidak disimpan. Coba lagi.",
		);
	}

	let nextVersion = 1;
	if (mode === "revise") {
		const [latest] = await db
			.select({ version: prdVersions.version })
			.from(prdVersions)
			.where(eq(prdVersions.projectId, projectId))
			.orderBy(desc(prdVersions.version))
			.limit(1);
		if (latest) nextVersion = latest.version + 1;
	}

	let prdVersionId = crypto.randomUUID();
	await db
		.insert(prdVersions)
		.values({
			id: prdVersionId,
			projectId,
			version: nextVersion,
			content: cleanContent,
			changeSummary:
				mode === "generate"
					? "Initial PRD generation"
					: `${userMessage.substring(0, 50)}...`,
		})
		.catch(async (err: unknown) => {
			// unique (project_id, version) violation — another writer took this number.
			// re-read the new max and retry once.
			const msg = err instanceof Error ? err.message : String(err);
			if (!msg.includes("23505")) throw err;
			const [latest] = await db
				.select({ version: prdVersions.version })
				.from(prdVersions)
				.where(eq(prdVersions.projectId, projectId))
				.orderBy(desc(prdVersions.version))
				.limit(1);
			nextVersion = (latest?.version ?? nextVersion) + 1;
			prdVersionId = crypto.randomUUID();
			await db.insert(prdVersions).values({
				id: prdVersionId,
				projectId,
				version: nextVersion,
				content: cleanContent,
				changeSummary:
					mode === "generate"
						? "Initial PRD generation"
						: `${userMessage.substring(0, 50)}...`,
			});
		});

	// Advance step to 'prd' — forward only (mirrors saveAcVersion). A generate
	// marks the project furthest point reached; History sends the user to /prd.
	const [proj] = await db
		.select({ step: projects.step })
		.from(projects)
		.where(eq(projects.id, projectId))
		.limit(1);
	const nextStep = advanceStep(proj?.step, "prd");
	await db
		.update(projects)
		.set(
			nextStep
				? { status: "completed", step: nextStep, updatedAt: new Date() }
				: { status: "completed", updatedAt: new Date() },
		)
		.where(eq(projects.id, projectId));

	return { prdVersionId, version: nextVersion };
}

export async function getPrdVersionContent(
	projectId: string,
	version: number,
): Promise<string | null> {
	const [row] = await db
		.select({ content: prdVersions.content })
		.from(prdVersions)
		.where(
			and(
				eq(prdVersions.projectId, projectId),
				eq(prdVersions.version, version),
			),
		)
		.limit(1);
	return row?.content ?? null;
}

export async function getLatestPrdContent(
	projectId: string,
): Promise<string | null> {
	const [row] = await db
		.select({ content: prdVersions.content })
		.from(prdVersions)
		.where(eq(prdVersions.projectId, projectId))
		.orderBy(desc(prdVersions.version))
		.limit(1);
	return row?.content ?? null;
}

export async function resolveProjectId(
	projectId: string | undefined,
	conversationId: string | undefined,
): Promise<string | undefined> {
	if (projectId) return projectId;
	if (!conversationId) return undefined;
	const [conv] = await db
		.select({ projectId: conversations.projectId })
		.from(conversations)
		.where(eq(conversations.id, conversationId))
		.limit(1);
	return conv?.projectId ?? undefined;
}
