import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
// Server-import exception: top-level `@/db`, schema, and `.server` imports
// are correct here — server handlers only, no client component (neighboring
// `/api/v1` pattern). Never import this module from client code.
import { db } from "@/db";
import { codebaseSnapshotFiles, codebaseSyncSessions } from "@/db/schema";
import {
	assertSyncTransition,
	fileChunkRequestSchema,
	isFileReplayCompatible,
	isSlotIdempotencyKey,
	uploadTransitionSteps,
} from "@/lib/codebase-sync";
import { decodeBase64ByteLength } from "@/lib/codebase-sync.server";
import {
	claimIdempotency,
	finalizeIdempotencyClaim,
	guardSyncUpload,
	readBoundedJson,
	releaseIdempotencyClaim,
} from "@/lib/codebase-sync-upload.server";
import {
	CODEBASE_MAX_FILE_BYTES,
	CODEBASE_MAX_SNAPSHOT_BYTES,
} from "@/lib/constants";

export const Route = createFileRoute("/api/v1/codebases/$id/codebase/files")({
	server: {
		handlers: {
			// CLI file upload: `uploadFileChunksWithRetry` POSTs
			// `{ sessionId, attemptId, path, chunkIndex, chunkTotal, encoding,
			// data, contentHash, idempotencyKey }` per bounded base64 text
			// chunk (binaries are excluded client-side, never uploaded).
			// Chunks persist per (snapshot, path, index); hash verification
			// runs per file at completion. The idempotency key is claimed
			// before the write so concurrent retries cannot both insert.
			// Bearer sync credential only (see `codebase-sync-upload.server.ts`
			// for the scope-separation rationale).
			POST: async ({
				request,
				params,
			}: {
				request: Request;
				params: { id: string };
			}) => {
				const { id: codebaseId } = params;

				const raw = await readBoundedJson(request);
				if (!raw.ok)
					return Response.json(raw.failure.body, {
						status: raw.failure.status,
					});

				const parsed = fileChunkRequestSchema.safeParse(raw.body);
				if (!parsed.success)
					return Response.json(
						{ error: "Invalid file chunk", code: "SYNC_FAILED" },
						{ status: 400 },
					);
				const body = parsed.data;

				// File keys are numbered by the CLI flat chunk sequence, which
				// the server cannot reconstruct — bind the
				// `${attemptId}:file:<n>` slot shape instead of an exact
				// index. Exact replay still matches the stored key.
				if (!isSlotIdempotencyKey(body.idempotencyKey, body.attemptId, "file"))
					return Response.json(
						{ error: "Invalid file chunk", code: "SYNC_FAILED" },
						{ status: 400 },
					);

				const guard = await guardSyncUpload(request, codebaseId, body, {
					rateLimit: false,
				});
				if (!guard.ok)
					return Response.json(guard.failure.body, {
						status: guard.failure.status,
					});
				const { session, snapshot } = guard.ctx;

				const claim = await claimIdempotency({
					key: body.idempotencyKey,
					sessionId: session.id,
					snapshotId: snapshot.id,
					kind: "file",
				});
				if (claim.status === "conflict")
					return Response.json(
						{
							error: "Idempotency key is already bound to another operation",
							code: "SNAPSHOT_CONFLICT",
						},
						{ status: 409 },
					);
				if (claim.status === "in-progress")
					return Response.json(
						{ error: "Chunk upload is in progress", code: "SYNC_IN_PROGRESS" },
						{ status: 409 },
					);

				const contentHash = body.contentHash.toLowerCase();
				const rows = await db
					.select()
					.from(codebaseSnapshotFiles)
					.where(eq(codebaseSnapshotFiles.snapshotId, snapshot.id));

				if (claim.status === "replay") {
					// Replay-payload identity check (Task 9): the retried chunk
					// must match the stored (path, chunkIndex) row byte-for-byte.
					// Slot keys cannot encode the path, so a divergent retry
					// fails closed instead of silently returning success.
					if (
						!isFileReplayCompatible(rows, {
							path: body.path,
							chunkIndex: body.chunkIndex,
							chunkTotal: body.chunkTotal,
							contentHash,
							data: body.data,
						})
					)
						return Response.json(
							{
								error: "File chunk conflicts with uploaded chunks",
								code: "SNAPSHOT_CONFLICT",
							},
							{ status: 409 },
						);
					return Response.json(claim.response, { status: claim.statusCode });
				}

				// Claimed: any path that ends without finalizing releases the
				// claim so a legitimate retry is never wedged.
				let finalized = false;
				try {
					let steps: ReturnType<typeof uploadTransitionSteps>;
					try {
						steps = uploadTransitionSteps(
							session.status as Parameters<typeof uploadTransitionSteps>[0],
						);
					} catch {
						return Response.json(
							{
								error: "Sync handshake required before upload",
								code: "SYNC_FAILED",
							},
							{ status: 409 },
						);
					}

					// Chunk identity must agree within a path; a desynced client
					// fails closed instead of corrupting the stored chunks.
					const pathRows = rows.filter((row) => row.path === body.path);
					for (const row of pathRows) {
						if (
							row.chunkTotal !== body.chunkTotal ||
							row.contentHash.toLowerCase() !== contentHash
						) {
							return Response.json(
								{
									error: "File chunk conflicts with uploaded chunks",
									code: "SNAPSHOT_CONFLICT",
								},
								{ status: 409 },
							);
						}
					}

					const decoded = decodeBase64ByteLength(body.data);
					if (decoded === null)
						return Response.json(
							{ error: "Invalid file chunk", code: "SYNC_FAILED" },
							{ status: 400 },
						);

					// Bounded accounting: per-file 1 MiB and per-snapshot 50 MiB,
					// computed from stored decoded sizes plus the new chunk
					// (replacing the previous bytes when a slot is re-sent).
					const replaced = pathRows.find(
						(row) => row.chunkIndex === body.chunkIndex,
					);
					const pathTotal =
						pathRows.reduce((sum, row) => sum + (row.size ?? 0), 0) -
						(replaced?.size ?? 0) +
						decoded;
					if (pathTotal > CODEBASE_MAX_FILE_BYTES)
						return Response.json(
							{
								error: "File exceeds the 1 MiB per-file limit",
								code: "SNAPSHOT_TOO_LARGE",
							},
							{ status: 413 },
						);
					const grandTotal =
						rows.reduce((sum, row) => sum + (row.size ?? 0), 0) -
						(replaced?.size ?? 0) +
						decoded;
					if (grandTotal > CODEBASE_MAX_SNAPSHOT_BYTES)
						return Response.json(
							{
								error: "Snapshot exceeds the 50 MiB snapshot limit",
								code: "SNAPSHOT_TOO_LARGE",
							},
							{ status: 413 },
						);

					if (replaced) {
						// Same slot re-sent: identical bytes are benign (new
						// idempotency key, same content); differing bytes conflict.
						if (
							replaced.data !== body.data ||
							replaced.chunkTotal !== body.chunkTotal ||
							replaced.contentHash.toLowerCase() !== contentHash
						) {
							return Response.json(
								{
									error: "File chunk conflicts with uploaded chunks",
									code: "SNAPSHOT_CONFLICT",
								},
								{ status: 409 },
							);
						}
					} else {
						await db.insert(codebaseSnapshotFiles).values({
							snapshotId: snapshot.id,
							path: body.path,
							chunkIndex: body.chunkIndex,
							chunkTotal: body.chunkTotal,
							contentHash,
							encoding: "base64",
							data: body.data,
							size: decoded,
						});
					}

					for (const [from, to] of steps) assertSyncTransition(from, to);
					if (steps.length > 0) {
						await db
							.update(codebaseSyncSessions)
							.set({ status: "uploading", updatedAt: new Date() })
							.where(eq(codebaseSyncSessions.id, session.id));
					}

					const receivedChunks = replaced
						? pathRows.length
						: pathRows.length + 1;
					const response = {
						status: "uploading",
						snapshotId: snapshot.id,
						path: body.path,
						chunkIndex: body.chunkIndex,
						receivedChunks,
						chunkTotal: body.chunkTotal,
					};
					await finalizeIdempotencyClaim({
						key: body.idempotencyKey,
						statusCode: 200,
						response,
					});
					finalized = true;
					return Response.json(response);
				} finally {
					if (!finalized) await releaseIdempotencyClaim(body.idempotencyKey);
				}
			},
		},
	},
});
