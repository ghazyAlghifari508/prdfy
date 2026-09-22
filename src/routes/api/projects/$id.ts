import { createFileRoute } from "@tanstack/react-router";
import { and, eq, inArray, isNull } from "drizzle-orm";
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
import { deletionTimestamp } from "@/lib/project-deletion";
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
						{ error: "Project ID is required", code: "PROJECT_NOT_FOUND" },
						{ status: 400 },
					);

				try {
					// Deletion destroys the user's product artifacts but must NOT
					// destroy accounting. `credit_ledger_entries` is append-only
					// (enforced by a database trigger) and references
					// `credit_operations`, which references `projects`; the
					// project row is therefore retained as a tombstone and every
					// read path filters it out. Removing the ledger instead would
					// break financial audit, and dropping the append-only trigger
					// would break ledger immutability.
					//
					// Ownership is established inside the transaction on the locked
					// project row, and the final tombstone update repeats the owner
					// predicate, so a project that changes hands (or disappears)
					// mid-request can never be deleted without revalidation.
					const result = await db.transaction(async (tx) => {
						const [ownProject] = await tx
							.select({ id: projects.id, deletedAt: projects.deletedAt })
							.from(projects)
							.where(
								and(eq(projects.id, projectId), eq(projects.userId, user.id)),
							)
							.limit(1)
							.for("update");
						if (!ownProject) return { kind: "not_found" as const };
						// Idempotent: a repeat delete reports success without
						// re-purging (and without touching accounting).
						if (ownProject.deletedAt) return { kind: "already" as const };

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

						// Clear share access: the token must not keep resolving to
						// purged content.
						const tombstoned = await tx
							.update(projects)
							.set({
								deletedAt: deletionTimestamp(),
								shareToken: null,
								lastUrl: null,
								updatedAt: deletionTimestamp(),
							})
							.where(
								and(
									eq(projects.id, projectId),
									eq(projects.userId, user.id),
									isNull(projects.deletedAt),
								),
							)
							.returning({ id: projects.id });
						if (!tombstoned.length) return { kind: "not_found" as const };
						return { kind: "deleted" as const };
					});

					if (result.kind === "not_found") {
						// Idempotent contract: a missing project is already gone.
						return Response.json(
							{ error: "Project not found", code: "PROJECT_NOT_FOUND" },
							{ status: 404 },
						);
					}
					return Response.json({ success: true, deleted: true });
				} catch (error) {
					// The client gets a stable code and a safe message; the real
					// cause is logged server-side so a failure stays diagnosable
					// instead of collapsing into a generic string.
					console.error(
						`[projects/delete] failed for project ${projectId} (user ${user.id}):`,
						error,
					);
					return Response.json(
						{
							error: "Gagal menghapus proyek.",
							code: "PROJECT_DELETE_FAILED",
						},
						{ status: 500 },
					);
				}
			},
		},
	},
});
