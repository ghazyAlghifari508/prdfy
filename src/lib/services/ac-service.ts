/**
 * AC versions - Drizzle DB ops. Mirrors prd-service.ts.
 * New schema: ac_versions(project_id, version, content, change_summary).
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { acVersions, projects } from "@/db/schema";
import { advanceStep } from "@/lib/flow-progress";
import { sanitizeModelOutput } from "@/lib/services/prd-service";

/** Thrown when the project does not exist or belongs to another tenant. */
export class AcProjectNotFoundError extends Error {
	readonly code = "AC_PROJECT_NOT_FOUND" as const;

	constructor() {
		super("Project not found");
		this.name = "AcProjectNotFoundError";
	}
}

/**
 * Save AC content for the owning tenant. Single row per project (version
 * pinned to 1): regeneration overwrites instead of appending a new version —
 * AC has no revision/history feature. Ownership, the AC write, and the
 * forward-only step advance run in one transaction with the project row
 * locked, so a concurrent writer can neither write into a foreign project nor
 * rewind the step from a stale read.
 */
export async function saveAcVersion(
	projectId: string,
	userId: string,
	fullResponse: string,
	userMessage: string,
): Promise<{ acVersionId: string; version: number }> {
	const cleanContent = sanitizeModelOutput(fullResponse);
	const summary = userMessage || "Initial AC generation";

	return db.transaction(async (tx) => {
		const [project] = await tx
			.select({ id: projects.id, step: projects.step })
			.from(projects)
			.where(
				and(
					eq(projects.id, projectId),
					eq(projects.userId, userId),
					isNull(projects.deletedAt),
				),
			)
			.for("update")
			.limit(1);
		if (!project) throw new AcProjectNotFoundError();

		const [row] = await tx
			.insert(acVersions)
			.values({
				id: crypto.randomUUID(),
				projectId,
				version: 1,
				content: cleanContent,
				changeSummary: summary,
			})
			.onConflictDoUpdate({
				target: [acVersions.projectId, acVersions.version],
				set: {
					content: cleanContent,
					changeSummary: summary,
					createdAt: new Date(),
				},
			})
			.returning({ id: acVersions.id });
		if (!row) throw new Error("Failed to save AC");

		const updateData: { acStatus: string; updatedAt: Date; step?: string } = {
			acStatus: "completed",
			updatedAt: new Date(),
		};
		const next = advanceStep(project.step, "ac");
		if (next) updateData.step = next;
		await tx.update(projects).set(updateData).where(eq(projects.id, projectId));

		return { acVersionId: row.id, version: 1 };
	});
}

export async function getLatestAcContent(
	projectId: string,
): Promise<string | null> {
	const [row] = await db
		.select({ content: acVersions.content })
		.from(acVersions)
		.where(eq(acVersions.projectId, projectId))
		.orderBy(desc(acVersions.version))
		.limit(1);
	return row?.content ?? null;
}

export async function getLatestAcMarkdown(
	projectId: string,
): Promise<string | null> {
	return getLatestAcContent(projectId);
}

/**
 * Extract one feature's AC block from full AC markdown, matched by its
 * `## <featureName>` heading (case-insensitive). Content runs until the
 * next `## `/`# ` heading or end of string.
 */
export function extractFeatureSection(
	acMarkdown: string,
	featureName: string,
): string | null {
	const target = featureName.trim().toLowerCase();

	const headingRe = /^(#{1,2})\s+(.+)$/gm;
	let start = -1;
	let bodyStart = -1;
	for (const match of acMarkdown.matchAll(headingRe)) {
		const [full, level, text] = match;
		if (level === "##" && text.trim().toLowerCase() === target) {
			start = match.index;
			bodyStart = match.index + full.length;
			break;
		}
	}
	if (start === -1) return null;

	headingRe.lastIndex = bodyStart;
	const next = headingRe.exec(acMarkdown);
	const end = next ? next.index : acMarkdown.length;

	return acMarkdown.slice(start, end).trim();
}
