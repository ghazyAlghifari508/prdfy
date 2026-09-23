import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
// Server-import exception: top-level `@/db`, schema, and `.server` imports
// are correct here — server handlers only, no client component (neighboring
// `/api/v1` pattern). Never import this module from client code.
import { db } from "@/db";
import { codebaseSnapshots, codebaseSyncSessions } from "@/db/schema";
import {
	assertSyncTransition,
	isExpectedIdempotencyKey,
	isManifestReplayCompatible,
	manifestBatchRequestSchema,
	manifestEntrySchema,
	uploadTransitionSteps,
} from "@/lib/codebase-sync";
import {
	claimIdempotency,
	finalizeIdempotencyClaim,
	guardSyncUpload,
	readBoundedJson,
	releaseIdempotencyClaim,
} from "@/lib/codebase-sync-upload.server";

export const Route = createFileRoute("/api/v1/codebases/$id/codebase/manifest")({
	server: {
		handlers: {
			// CLI manifest upload: `uploadManifestWithRetry` POSTs
			// `{ sessionId, attemptId, batchIndex, batchTotal, entries,
			// idempotencyKey }` per bounded batch. Batches merge into the
			// handshake-bound snapshot manifest; duplicate batches replay
			// idempotently; conflicting entries fail closed. The idempotency
			// key is claimed before the merge runs, so concurrent retries of
			// one batch cannot both merge. Bearer sync credential only (see
			// `codebase-sync-upload.server.ts` for the scope-separation
			// rationale).
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

				const guard = await guardSyncUpload(request, codebaseId, body);
				if (!guard.ok)
					return Response.json(guard.failure.body, {
						status: guard.failure.status,
					});
				const { session, snapshot } = guard.ctx;

				const claim = await claimIdempotency({
					key: body.idempotencyKey,
					sessionId: session.id,
					snapshotId: snapshot.id,
					kind: "manifest",
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
						{ error: "Batch upload is in progress", code: "SYNC_IN_PROGRESS" },
						{ status: 409 },
					);
				if (claim.status === "replay") {
					// Replay-payload identity check (Task 9): the retried batch
					// must carry the same batch index and its entries must all
					// already exist in the stored manifest with identical
					// identity (multi-batch retries replay the whole loop after
					// later batches merged, so stored is always a superset).
					// Anything else is conflicting key reuse — fail closed.
					const storedResponse = claim.response as {
						batchIndex?: unknown;
					} | null;
					if (!storedResponse || storedResponse.batchIndex !== body.batchIndex)
						return Response.json(
							{
								error: "Idempotency key is already bound to another operation",
								code: "SNAPSHOT_CONFLICT",
							},
							{ status: 409 },
						);
					const stored = manifestEntrySchema
						.array()
						.safeParse(snapshot.manifest ?? []);
					if (!stored.success)
						return Response.json(
							{ error: "Sync snapshot is corrupted", code: "SYNC_FAILED" },
							{ status: 500 },
						);
					if (!isManifestReplayCompatible(stored.data, body.entries))
						return Response.json(
							{
								error: "Manifest entry conflicts with uploaded manifest",
								code: "SNAPSHOT_CONFLICT",
							},
							{ status: 409 },
						);
					return Response.json(claim.response, { status: claim.statusCode });
				}

				// Claimed: this request owns the key. Any path that ends without
				// finalizing releases the claim so a legitimate retry is never
				// wedged behind a pending sentinel.
				let finalized = false;
				try {
					const stored = manifestEntrySchema
						.array()
						.safeParse(snapshot.manifest ?? []);
					if (!stored.success)
						return Response.json(
							{ error: "Sync snapshot is corrupted", code: "SYNC_FAILED" },
							{ status: 500 },
						);

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

					// Merge against the stored manifest. Sequential-only guard
					// (Task 5 → 9): the supported CLI sends batches strictly
					// sequentially (`uploadManifest`: `for` + `await` in
					// sync-client.ts), so two merges for one snapshot never
					// interleave. A future concurrent client must move this
					// merge into a transaction with SELECT ... FOR UPDATE
					// before enabling parallelism.
					const byPath = new Map(
						stored.data.map((entry) => [entry.path, entry]),
					);
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
								(previous.language ?? undefined) !==
									(entry.language ?? undefined)
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
