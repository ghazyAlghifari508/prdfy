// Server-only codebase analysis orchestration (Task 6).
//
// Never import this module from client/isomorphic code: it imports the
// database client and the AI orchestration chain. Route handlers import it
// directly, following the neighboring `/api/codebase` top-level `{ db }`
// pattern. Pure prompt/validation helpers live in `codebase-analysis.ts`.
//
// Flow per attempt (one fresh `codebase_analyses` row each):
// 1. Snapshot must be `uploaded` and its session must be `uploaded` —
//    analysis is requested ONLY from uploaded state (Task 5 known limitation:
//    completion-replay-after-terminal is never assumed).
// 2. Legacy project sessions move uploaded → analyzing; codebase-scoped
//    sessions stay uploaded while a per-feature `pending` row is stored.
// 3. The model chain (same selectModels/tryStreamWithFallback boundary as
//    /api/chat and /api/ask/options) generates strict JSON over the bounded
//    snapshot context. Output is validated with the Task 1 Zod schema before
//    persistence; uncertainty stays labeled, paths are never invented.
// 4. Success: analysis → ready. Legacy project sessions also move to ready;
//    codebase-scoped sessions stay uploaded because the snapshot is shared by
//    every feature.
// 5. Failure: analysis → failed with a fixed safe message. Legacy project
//    sessions roll back analyzing → uploaded; codebase sessions are unchanged.
//    No credit is consumed either way.

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
	codebaseAnalyses,
	codebaseAskHandoffs,
	codebaseSnapshotFiles,
	codebaseSnapshots,
	codebaseSyncSessions,
	projects,
} from "@/db/schema";
import {
	type AnalysisSourceFile,
	buildAnalysisUserPrompt,
	CODEBASE_ANALYSIS_SYSTEM_PROMPT,
	type CodebaseAnalysis,
	parseAnalysisOutput,
	resolveAnalysisFeaturePrompt,
	toSafeAnalysisErrorMessage,
} from "./codebase-analysis";
import {
	assertSyncTransition,
	canTransitionSyncStatus,
	manifestEntrySchema,
	sanitizeSyncErrorMessage,
} from "./codebase-sync";
import { CODEBASE_ANALYSIS_MAX_TOKENS } from "./constants";
import {
	selectModels,
	tryStreamWithFallback,
} from "./services/ai-orchestrator";

export type AnalysisServiceCode = "SNAPSHOT_NOT_UPLOADED" | "ANALYSIS_FAILED";

export class AnalysisServiceError extends Error {
	readonly code: AnalysisServiceCode;
	/** Failed-attempt analysis row id (Task 9): lets the route attach the
	 *  exact failed attempt instead of the latest row, which under a
	 *  concurrent duplicate trigger could be the sibling's ready record. */
	readonly analysisId?: string;

	constructor(code: AnalysisServiceCode, message: string, analysisId?: string) {
		super(message);
		this.name = "AnalysisServiceError";
		this.code = code;
		this.analysisId = analysisId;
	}
}

export interface AnalysisMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export type AnalysisGenerator = (
	messages: AnalysisMessage[],
) => Promise<string>;

// Default generator: the shared combo-model boundary (same as /api/chat and
// /api/ask/options). Fully collected (non-streaming) since analysis output is
// a single JSON document validated once at the end.
async function defaultGenerate(messages: AnalysisMessage[]): Promise<string> {
	const { generator, firstChunk } = await tryStreamWithFallback(
		selectModels(),
		messages,
		undefined,
		CODEBASE_ANALYSIS_MAX_TOKENS,
	);
	let fullResponse = firstChunk;
	for await (const chunk of generator) fullResponse += chunk;
	return fullResponse;
}

export interface RequestAnalysisDeps {
	generate?: AnalysisGenerator;
}

export interface RequestAnalysisScope {
	codebaseId?: string;
}

export async function requestCodebaseAnalysis(
	projectId: string,
	snapshotId: string,
	deps: RequestAnalysisDeps = {},
	scope: RequestAnalysisScope = {},
): Promise<CodebaseAnalysis & { id: string }> {
	const generate = deps.generate ?? defaultGenerate;
	const { db } = await import("@/db");

	const [snapshot] = await db
		.select()
		.from(codebaseSnapshots)
		.where(
			and(
				eq(codebaseSnapshots.id, snapshotId),
				scope.codebaseId
					? eq(codebaseSnapshots.codebaseId, scope.codebaseId)
					: eq(codebaseSnapshots.projectId, projectId),
			),
		)
		.limit(1);
	if (!snapshot || snapshot.status !== "uploaded") {
		throw new AnalysisServiceError(
			"SNAPSHOT_NOT_UPLOADED",
			"Snapshot belum siap dianalisis. Selesaikan sync terlebih dahulu.",
		);
	}

	const [session] = await db
		.select()
		.from(codebaseSyncSessions)
		.where(
			and(
				eq(codebaseSyncSessions.id, snapshot.syncSessionId),
				scope.codebaseId
					? eq(codebaseSyncSessions.codebaseId, scope.codebaseId)
					: eq(codebaseSyncSessions.projectId, projectId),
			),
		)
		.limit(1);
	if (!session || session.status !== "uploaded") {
		throw new AnalysisServiceError(
			"SNAPSHOT_NOT_UPLOADED",
			"Snapshot belum siap dianalisis. Selesaikan sync terlebih dahulu.",
		);
	}

	const [project] = await db
		.select({ name: projects.name })
		.from(projects)
		.where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
		.limit(1);
	const [handoff] = await db
		.select({ state: codebaseAskHandoffs.state })
		.from(codebaseAskHandoffs)
		.where(eq(codebaseAskHandoffs.projectId, projectId))
		.limit(1);
	const handoffPrompt =
		handoff?.state &&
		typeof handoff.state === "object" &&
		"prompt" in handoff.state &&
		typeof handoff.state.prompt === "string"
			? handoff.state.prompt
			: null;
	const featurePrompt = resolveAnalysisFeaturePrompt({
		handoffPrompt,
		projectName: project?.name?.trim() || "",
		projectId,
	});

	// Fresh record per attempt: terminal rows are never mutated.
	const analysisId = crypto.randomUUID();
	const isCodebaseScoped = Boolean(scope.codebaseId);
	if (!isCodebaseScoped) assertSyncTransition("uploaded", "analyzing");

	// Atomic claim: legacy rows claim the sync session; codebase rows claim the
	// feature/snapshot pair so multiple features can analyze one shared upload.
	const claimed = await db.transaction(async (tx) => {
		if (scope.codebaseId) {
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtext(${`${scope.codebaseId}:${projectId}:${snapshotId}`}))`,
			);
			const [pending] = await tx
				.select({ id: codebaseAnalyses.id })
				.from(codebaseAnalyses)
				.where(
					and(
						eq(codebaseAnalyses.projectId, projectId),
						eq(codebaseAnalyses.snapshotId, snapshotId),
						eq(codebaseAnalyses.status, "pending"),
					),
				)
				.limit(1);
			if (pending) return false;
			await tx.insert(codebaseAnalyses).values({
				id: analysisId,
				projectId,
				snapshotId,
				status: "pending",
			});
			return true;
		}

		const [updated] = await tx
			.update(codebaseSyncSessions)
			.set({ status: "analyzing", updatedAt: new Date() })
			.where(
				and(
					eq(codebaseSyncSessions.id, session.id),
					eq(codebaseSyncSessions.status, "uploaded"),
				),
			)
			.returning({ id: codebaseSyncSessions.id });

		if (!updated) return false;

		await tx.insert(codebaseAnalyses).values({
			id: analysisId,
			projectId,
			snapshotId,
			status: "pending",
		});

		return true;
	});

	if (!claimed) {
		throw new AnalysisServiceError(
			"SNAPSHOT_NOT_UPLOADED",
			"Analisis sedang berjalan untuk snapshot ini. Tunggu hingga selesai.",
		);
	}

	try {
		const storedManifest = manifestEntrySchema
			.array()
			.safeParse(snapshot.manifest ?? []);
		if (!storedManifest.success) {
			throw new Error("Snapshot manifest is corrupted");
		}

		const rows = await db
			.select({
				path: codebaseSnapshotFiles.path,
				chunkIndex: codebaseSnapshotFiles.chunkIndex,
				data: codebaseSnapshotFiles.data,
			})
			.from(codebaseSnapshotFiles)
			.where(eq(codebaseSnapshotFiles.snapshotId, snapshot.id))
			.orderBy(
				asc(codebaseSnapshotFiles.path),
				asc(codebaseSnapshotFiles.chunkIndex),
			);

		const chunksByPath = new Map<string, string[]>();
		for (const row of rows) {
			const group = chunksByPath.get(row.path) ?? [];
			group[row.chunkIndex] = row.data;
			chunksByPath.set(row.path, group);
		}
		const files: AnalysisSourceFile[] = [];
		for (const entry of storedManifest.data) {
			const group = chunksByPath.get(entry.path);
			if (!group) continue;
			try {
				const text = Buffer.from(group.join(""), "base64").toString("utf8");
				files.push({ path: entry.path, text });
			} catch {
				// Undecodable content is skipped, never fails the attempt: the
				// manifest still bounds what the model may reference.
			}
		}

		const messages: AnalysisMessage[] = [
			{ role: "system", content: CODEBASE_ANALYSIS_SYSTEM_PROMPT },
			{
				role: "user",
				content: buildAnalysisUserPrompt({
					projectId,
					snapshotId,
					featurePrompt,
					manifest: storedManifest.data,
					files,
					fileCount: snapshot.fileCount ?? storedManifest.data.length,
					excludedCount: snapshot.excludedCount ?? 0,
					branch: snapshot.branch,
					commitSha: snapshot.commitSha,
				}),
			},
		];
		const raw = await generate(messages);
		const analysis = parseAnalysisOutput(raw, { projectId, snapshotId });

		await db.transaction(async (tx) => {
			await tx
				.update(codebaseAnalyses)
				.set({ status: "ready", output: analysis, updatedAt: new Date() })
				.where(eq(codebaseAnalyses.id, analysisId));
			if (!isCodebaseScoped) {
				// The snapshot stays `uploaded`: it is a repository artifact
				// shared by every feature, so its state must not depend on one
				// feature's analysis. `ready` remains valid for historical rows.
				assertSyncTransition("analyzing", "ready");
				await tx
					.update(codebaseSyncSessions)
					.set({ status: "ready", updatedAt: new Date() })
					.where(eq(codebaseSyncSessions.id, session.id));
			}
		});
		return { ...analysis, id: analysisId };
	} catch (error) {
		// Defense-in-depth: writers store only the fixed safe string; the
		// sanitizer additionally guarantees no token/source content passes.
		const safe =
			sanitizeSyncErrorMessage(
				error instanceof AnalysisServiceError
					? error.message
					: toSafeAnalysisErrorMessage(error),
			) ?? "Analisis codebase gagal. Coba analisis ulang.";
		await db
			.update(codebaseAnalyses)
			.set({
				status: "failed",
				errorCode: "ANALYSIS_FAILED",
				errorMessage: safe,
				updatedAt: new Date(),
			})
			.where(eq(codebaseAnalyses.id, analysisId));
		// Rollback to uploaded (documented Task 6 edge): the snapshot is still
		// valid, so the next attempt writes a fresh record from uploaded state.
		// The session is re-read first: under a concurrent duplicate trigger
		// the sibling attempt may already have advanced it (e.g. to ready),
		// in which case there is nothing to roll back and the transition
		// assert must not throw out of the failure path.
		if (!isCodebaseScoped) {
			const [current] = await db
				.select({ status: codebaseSyncSessions.status })
				.from(codebaseSyncSessions)
				.where(eq(codebaseSyncSessions.id, session.id))
				.limit(1);
			if (
				current?.status === "analyzing" &&
				canTransitionSyncStatus("analyzing", "uploaded")
			) {
				await db
					.update(codebaseSyncSessions)
					.set({ status: "uploaded", updatedAt: new Date() })
					.where(eq(codebaseSyncSessions.id, session.id));
			}
		}
		if (error instanceof AnalysisServiceError) throw error;
		throw new AnalysisServiceError("ANALYSIS_FAILED", safe, analysisId);
	}
}
