import { createFileRoute } from "@tanstack/react-router";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
	acVersions,
	codebaseAnalyses,
	codebaseAskHandoffs,
	codebaseGenerationContexts,
	codebaseSnapshotFiles,
	codebaseSnapshots,
	codebaseSyncIdempotencyKeys,
	codebaseSyncSessions,
	conversations,
	messages,
	prdVersions,
	projects,
	tasks,
} from "@/db/schema";
import { requireUser } from "@/lib/session";

// Every project-owned sync table, in FK-safe delete order: ask handoffs
// carry no FK deps (snapshot binding is advisory text) so they go first,
// then generation contexts reference snapshots + analyses,
// analyses/idempotency/files reference snapshots/sessions, and snapshots
// reference sessions. Sessions go last. Unit-tested in
// ./-project-mode.test.ts — keep the order and the transaction below in sync.
export const PROJECT_SYNC_CHILD_TABLES = [
	"codebase_ask_handoffs",
	"codebase_generation_contexts",
	"codebase_analyses",
	"codebase_sync_idempotency_keys",
	"codebase_snapshot_files",
	"codebase_snapshots",
	"codebase_sync_sessions",
] as const;

export const Route = createFileRoute("/api/projects/$id")({
	server: {
		handlers: {
			DELETE: async ({
				request,
				params,
			}: {
				request: Request;
				params: { id: string };
			}) => {
				const user = await requireUser(request.headers);
				const { id: projectId } = params;
				if (!projectId)
					return Response.json(
						{ error: "Project ID is required" },
						{ status: 400 },
					);

				// Ownership check MUST run before any child-row deletes. Deleting
				// children first (old code) let an authenticated user wipe another
				// user's data by sending their projectId - the owner check only
				// fired on the parent delete, by which point the damage was done.
				const [ownProject] = await db
					.select({ id: projects.id })
					.from(projects)
					.where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
					.limit(1);
				if (!ownProject) {
					return Response.json({ error: "Project not found" }, { status: 404 });
				}

				// ponytail: delete children before parent. FKs lack ON DELETE CASCADE
				// (schema.ts), so skipping any leaves orphaned rows. Order matters:
				// messages→conversations first (messages FK conversations), then the
				// project-scoped tables, then projects last. All in one transaction so
				// a mid-sequence failure leaves no partial orphans. ac_versions is
				// easy to miss: it is created by the AC stage, so every project past
				// PRD-only carries rows that block the parent delete.
				await db.transaction(async (tx) => {
					const convRows = await tx
						.select({ id: conversations.id })
						.from(conversations)
						.where(eq(conversations.projectId, projectId));
					const convIds = convRows.map((c) => c.id);
					if (convIds.length > 0) {
						await tx
							.delete(messages)
							.where(inArray(messages.conversationId, convIds));
					}
					await tx
						.delete(conversations)
						.where(eq(conversations.projectId, projectId));
					await tx
						.delete(prdVersions)
						.where(eq(prdVersions.projectId, projectId));
					await tx
						.delete(acVersions)
						.where(eq(acVersions.projectId, projectId));
					await tx.delete(tasks).where(eq(tasks.projectId, projectId));
					// Existing-codebase sync records, in PROJECT_SYNC_CHILD_TABLES
					// order (FK-safe: handoffs → contexts → analyses →
					// idempotency → files → snapshots → sessions). Raw filtered
					// source lives in codebase_snapshot_files for the project
					// lifetime, so project deletion is its retention boundary —
					// everything goes.
					await tx
						.delete(codebaseAskHandoffs)
						.where(eq(codebaseAskHandoffs.projectId, projectId));
					await tx
						.delete(codebaseGenerationContexts)
						.where(eq(codebaseGenerationContexts.projectId, projectId));
					await tx
						.delete(codebaseAnalyses)
						.where(eq(codebaseAnalyses.projectId, projectId));
					const snapshotRows = await tx
						.select({ id: codebaseSnapshots.id })
						.from(codebaseSnapshots)
						.where(eq(codebaseSnapshots.projectId, projectId));
					const snapshotIds = snapshotRows.map((s) => s.id);
					const sessionRows = await tx
						.select({ id: codebaseSyncSessions.id })
						.from(codebaseSyncSessions)
						.where(eq(codebaseSyncSessions.projectId, projectId));
					const sessionIds = sessionRows.map((s) => s.id);
					if (snapshotIds.length > 0) {
						await tx
							.delete(codebaseSnapshotFiles)
							.where(inArray(codebaseSnapshotFiles.snapshotId, snapshotIds));
						await tx
							.delete(codebaseSyncIdempotencyKeys)
							.where(
								inArray(codebaseSyncIdempotencyKeys.snapshotId, snapshotIds),
							);
					}
					if (sessionIds.length > 0) {
						await tx
							.delete(codebaseSyncIdempotencyKeys)
							.where(
								inArray(codebaseSyncIdempotencyKeys.sessionId, sessionIds),
							);
					}
					await tx
						.delete(codebaseSnapshots)
						.where(eq(codebaseSnapshots.projectId, projectId));
					await tx
						.delete(codebaseSyncSessions)
						.where(eq(codebaseSyncSessions.projectId, projectId));
					await tx.delete(projects).where(eq(projects.id, projectId));
				});
				return Response.json({ success: true });
			},
		},
	},
});
