import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { codebaseSnapshots, codebaseSyncSessions } from "@/db/schema";
import {
	assertSyncTransition,
	isExpectedIdempotencyKey,
	manifestBatchRequestSchema,
	manifestEntrySchema,
	uploadTransitionSteps,
} from "@/lib/codebase-sync";
import {
	getIdempotentReplay,
	guardSyncUpload,
	readBoundedJson,
	storeIdempotentResponse,
} from "@/lib/codebase-sync-upload.server";

export const Route = createFileRoute("/api/v1/projects/$id/codebase/manifest")({
	server: {
		handlers: {
			// CLI manifest upload: `uploadManifestWithRetry` POSTs
			// `{ sessionId, attemptId, batchIndex, batchTotal, entries,
			// idempotencyKey }` per bounded batch. Batches merge into the
			// handshake-bound snapshot manifest; duplicate batches replay
			// idempotently; conflicting entries fail closed. Bearer sync
			// credential only (see `codebase-sync-upload.server.ts` for the
			// scope-separation rationale).
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

				const parsed = manifestBatchRequestSchema.safeParse(raw.body);
				if (!parsed.success)
					return Response.json(
						{ error: "Invalid manifest batch", code: "SYNC_FAILED" },
						{ status: 400 },
					);
				const body = parsed.data;

				if (
					!isExpectedIdempotencyKey(
						body.idempotencyKey,
						body.attemptId,
						"manifest",
						body.batchIndex,
					)
				)
					return Response.json(
						{ error: "Invalid manifest batch", code: "SYNC_FAILED" },
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

				// The session must be on the upload path (handshake happened).
				// Each step is asserted valid before persisting `uploading`.
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

				// Merge normalized entries. Identical re-sends are benign;
				// same path with different identity fails closed.
				const stored = manifestEntrySchema
					.array()
					.safeParse(snapshot.manifest ?? []);
				if (!stored.success)
					return Response.json(
						{ error: "Sync snapshot is corrupted", code: "SYNC_FAILED" },
						{ status: 500 },
					);
				const byPath = new Map(stored.data.map((entry) => [entry.path, entry]));
				for (const rawEntry of body.entries) {
					const entry = {
						...rawEntry,
						hash: rawEntry.hash.toLowerCase(),
					};
					const previous = byPath.get(entry.path);
					if (previous) {
						if (
							previous.size !== entry.size ||
							previous.hash.toLowerCase() !== entry.hash ||
							(previous.language ?? undefined) !== (entry.language ?? undefined)
						) {
							return Response.json(
								{
									error: "Manifest entry conflicts with uploaded manifest",
									code: "SNAPSHOT_CONFLICT",
								},
								{ status: 409 },
							);
						}
					} else {
						byPath.set(entry.path, entry);
					}
				}
				const merged = [...byPath.values()];

				for (const [from, to] of steps) assertSyncTransition(from, to);
				await db
					.update(codebaseSnapshots)
					.set({ manifest: merged })
					.where(eq(codebaseSnapshots.id, snapshot.id));
				if (steps.length > 0) {
					await db
						.update(codebaseSyncSessions)
						.set({ status: "uploading", updatedAt: new Date() })
						.where(eq(codebaseSyncSessions.id, session.id));
				}

				const response = {
					status: "uploading",
					snapshotId: snapshot.id,
					receivedEntries: merged.length,
					batchIndex: body.batchIndex,
				};
				await storeIdempotentResponse({
					key: body.idempotencyKey,
					sessionId: session.id,
					snapshotId: snapshot.id,
					kind: "manifest",
					statusCode: 200,
					response,
				});
				return Response.json(response);
			},
		},
	},
});
