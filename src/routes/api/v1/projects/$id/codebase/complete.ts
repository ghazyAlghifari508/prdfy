import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
	codebaseSnapshotFiles,
	codebaseSnapshots,
	codebaseSyncSessions,
} from "@/db/schema";
import {
	assertSyncTransition,
	checkSnapshotCompletion,
	isExpectedIdempotencyKey,
	manifestEntrySchema,
	SnapshotCompletionError,
	snapshotCompleteRequestSchema,
} from "@/lib/codebase-sync";
import { verifyFileContentHash } from "@/lib/codebase-sync.server";
import {
	getIdempotentReplay,
	guardSyncUpload,
	readBoundedJson,
	storeIdempotentResponse,
} from "@/lib/codebase-sync-upload.server";

export const Route = createFileRoute("/api/v1/projects/$id/codebase/complete")({
	server: {
		handlers: {
			// CLI completion: `completeWithRetry` POSTs
			// `{ sessionId, attemptId, fileCount, excludedCount,
			// idempotencyKey }`. The snapshot transitions to `uploaded`
			// atomically (transaction) ONLY after the stored manifest and
			// chunks verify: expected counts/hashes match, every manifest
			// entry has complete contiguous chunks, bounds hold, and each
			// reassembled file hashes to its manifest hash. Partial/failed
			// snapshots stay `uploading` and are never usable by analysis.
			// Completion replay (same or new key) returns the stored result
			// without mutating. Bearer sync credential only (see
			// `codebase-sync-upload.server.ts` for the scope-separation
			// rationale).
			POST: async ({
				request,
				params,
			}: {
				request: Request;
				params: { id: string };
			}) => {
				const { id: projectId } = params;

				const raw = await readBoundedJson(request);
				if (!raw.ok)
					return Response.json(raw.failure.body, {
						status: raw.failure.status,
					});

				const parsed = snapshotCompleteRequestSchema.safeParse(raw.body);
				if (!parsed.success)
					return Response.json(
						{ error: "Invalid completion request", code: "SYNC_FAILED" },
						{ status: 400 },
					);
				const body = parsed.data;

				if (
					!isExpectedIdempotencyKey(
						body.idempotencyKey,
						body.attemptId,
						"complete",
						0,
					)
				)
					return Response.json(
						{ error: "Invalid completion request", code: "SYNC_FAILED" },
						{ status: 400 },
					);

				const guard = await guardSyncUpload(request, projectId, body);
				if (!guard.ok)
					return Response.json(guard.failure.body, {
						status: guard.failure.status,
					});
				const { session, snapshot } = guard.ctx;

				const replay = await getIdempotentReplay(body.idempotencyKey);
				if (replay)
					return Response.json(replay.response, {
						status: replay.statusCode,
					});

				// Idempotent completion: an already-uploaded snapshot returns
				// its stored result (new keys are recorded for future replay).
				if (snapshot.status === "uploaded") {
					const response = {
						status: "uploaded",
						snapshotId: snapshot.id,
						fileCount: snapshot.fileCount,
						excludedCount: snapshot.excludedCount,
					};
					await storeIdempotentResponse({
						key: body.idempotencyKey,
						sessionId: session.id,
						snapshotId: snapshot.id,
						kind: "complete",
						statusCode: 200,
						response,
					});
					return Response.json(response);
				}

				if (session.status !== "uploading" || snapshot.status !== "uploading")
					return Response.json(
						{
							error: "Snapshot upload is not in progress",
							code: "SYNC_FAILED",
						},
						{ status: 409 },
					);

				const storedManifest = manifestEntrySchema
					.array()
					.safeParse(snapshot.manifest ?? []);
				if (!storedManifest.success)
					return Response.json(
						{ error: "Sync snapshot is corrupted", code: "SYNC_FAILED" },
						{ status: 500 },
					);

				const rows = await db
					.select()
					.from(codebaseSnapshotFiles)
					.where(eq(codebaseSnapshotFiles.snapshotId, snapshot.id));

				// Structural verification first (counts, contiguity, orphans,
				// per-file and snapshot bounds) — pure and DB-agnostic.
				let contentSize: number;
				try {
					({ contentSize } = checkSnapshotCompletion({
						manifest: storedManifest.data,
						chunks: rows.map((row) => ({
							path: row.path,
							chunkIndex: row.chunkIndex,
							chunkTotal: row.chunkTotal,
							dataBase64Length: row.data.length,
							decodedBytes: row.size ?? 0,
						})),
						fileCount: body.fileCount,
						excludedCount: body.excludedCount,
					}));
				} catch (error) {
					if (error instanceof SnapshotCompletionError) {
						const status = error.code === "SNAPSHOT_TOO_LARGE" ? 413 : 409;
						return Response.json(
							{ error: "Snapshot verification failed", code: error.code },
							{ status },
						);
					}
					throw error;
				}

				// Hash verification per file: reassemble ordered chunks and
				// compare against the manifest hash (rows agree with the
				// manifest by construction of the files endpoint, but the
				// manifest is the source of truth here).
				const byPath = new Map<string, typeof rows>();
				for (const row of rows) {
					const group = byPath.get(row.path) ?? [];
					group.push(row);
					byPath.set(row.path, group);
				}
				for (const entry of storedManifest.data) {
					const group = (byPath.get(entry.path) ?? []).sort(
						(a, b) => a.chunkIndex - b.chunkIndex,
					);
					for (const row of group) {
						if (row.contentHash.toLowerCase() !== entry.hash.toLowerCase()) {
							return Response.json(
								{
									error: "Snapshot verification failed",
									code: "SNAPSHOT_HASH_MISMATCH",
								},
								{ status: 409 },
							);
						}
					}
					const assembled = group.map((row) => row.data).join("");
					if (!verifyFileContentHash(assembled, entry.hash)) {
						return Response.json(
							{
								error: "Snapshot verification failed",
								code: "SNAPSHOT_HASH_MISMATCH",
							},
							{ status: 409 },
						);
					}
				}

				// Atomic transition: snapshot AND session move to `uploaded`
				// together, or neither does. uploadTransitionSteps already
				// validated the session upload path on chunk receipt; the
				// final uploading -> uploaded step is asserted in-transaction.
				assertSyncTransition(session.status as "uploading", "uploaded");
				await db.transaction(async (tx) => {
					await tx
						.update(codebaseSnapshots)
						.set({
							status: "uploaded",
							fileCount: body.fileCount,
							excludedCount: body.excludedCount,
							contentSize,
							manifest: storedManifest.data,
						})
						.where(eq(codebaseSnapshots.id, snapshot.id));
					await tx
						.update(codebaseSyncSessions)
						.set({ status: "uploaded", updatedAt: new Date() })
						.where(eq(codebaseSyncSessions.id, session.id));
				});

				const response = {
					status: "uploaded",
					snapshotId: snapshot.id,
					fileCount: body.fileCount,
					excludedCount: body.excludedCount,
				};
				await storeIdempotentResponse({
					key: body.idempotencyKey,
					sessionId: session.id,
					snapshotId: snapshot.id,
					kind: "complete",
					statusCode: 200,
					response,
				});
				return Response.json(response);
			},
		},
	},
});
