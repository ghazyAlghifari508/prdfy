import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import {
	buildAcMetrics,
	formatInsufficientCreditsError,
	formatSubscriptionPausedError,
} from "@/lib/adaptive-credit";
import {
	buildCodebasePromptBlock,
	getProjectGenerationContext,
	linkGenerationContext,
} from "@/lib/codebase-generation-context";
import { CLAIM_POLL_MS, CLAIM_RETRY_MS } from "@/lib/constants";
import { hasFullWorkflow } from "@/lib/credits";
import { isTruncatedGeneration } from "@/lib/flow-progress";
import { getLanguageDirective, normalizeLanguage } from "@/lib/language";
import { depthDirective } from "@/lib/prompt-depth";
import { AC_GENERATION_PROMPT } from "@/lib/prompts-ac";
import { checkRateLimit } from "@/lib/rate-limit";
import { saveAcVersion } from "@/lib/services/ac-service";
import {
	selectModels,
	tryStreamWithFallback,
} from "@/lib/services/ai-orchestrator";
import type { CreditOperationResult } from "@/lib/services/credit-service";
import { sanitizeErrorForClient } from "@/lib/services/error-sanitizer";
import { getLatestPrdContent } from "@/lib/services/prd-service";
import { requireUser } from "@/lib/session";

export const Route = createFileRoute("/api/ac/generate")({
	server: {
		handlers: {
			POST: async ({ request }: { request: Request }) => {
				const user = await requireUser(request.headers);

				const { db } = await import("@/db");
				const { codebaseSnapshots, creditOperations, projects, subscriptions } =
					await import("@/db/schema");
				const {
					CreditSubscriptionOriginError,
					createCreditQuote,
					reserveActiveCreditOperation,
					isReleasableReservation,
					markCreditOperationRunning,
					settleCreditOperation,
					releaseCreditOperation,
					quarantineCreditOperation,
				} = await import("@/lib/services/credit-service");

				const body = await request
					.json()
					.catch(() => ({ projectId: undefined }));
				const {
					projectId,
					idempotencyKey: callerIdempotencyKey,
					attempt: callerAttempt,
				} = body as {
					projectId?: string;
					idempotencyKey?: string;
					attempt?: number;
				};
				if (!projectId)
					return Response.json(
						{ error: "Project ID required" },
						{ status: 400 },
					);

				const { resolveSubscriptionState } = await import("@/lib/billing");
				const [sub] = await db
					.select({
						plan: subscriptions.plan,
						status: subscriptions.status,
						credits: subscriptions.credits,
						creditsUsed: subscriptions.creditsUsed,
						creditsReserved: subscriptions.creditsReserved,
						currentPeriodStart: subscriptions.currentPeriodStart,
						currentPeriodEnd: subscriptions.currentPeriodEnd,
						cancelledAt: subscriptions.cancelledAt,
					})
					.from(subscriptions)
					.where(eq(subscriptions.userId, user.id))
					.orderBy(desc(subscriptions.createdAt))
					.limit(1);
				const eff = resolveSubscriptionState(sub, new Date());

				if (!hasFullWorkflow(eff.effectivePlan)) {
					return Response.json(
						{
							error: "Generate AC hanya tersedia di paket Pro dan Hengker.",
							code: "UPGRADE_REQUIRED",
							plan: eff.effectivePlan,
						},
						{ status: 403 },
					);
				}

				const rateCheck = await checkRateLimit(
					user.id,
					eff.effectivePlan,
					"api_call",
				);
				if (!rateCheck.allowed)
					return Response.json(
						{ error: "Too many requests", retryAfter: 60 },
						{ status: 429 },
					);
				const [project] = await db
					.select({
						id: projects.id,
						language: projects.language,
						projectMode: projects.projectMode,
					})
					.from(projects)
					.where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
					.limit(1);
				if (!project)
					return Response.json({ error: "Project not found" }, { status: 404 });

				const prdContent = await getLatestPrdContent(projectId);
				if (!prdContent)
					return Response.json(
						{ error: "PRD not found. Generate PRD first." },
						{ status: 404 },
					);

				let codebaseSnapshotId: string | undefined;
				let codebaseAnalysisId: string | undefined;
				let codebaseSnapshotInfo:
					| { fileCount?: number; sourceBytes?: number }
					| undefined;

				if (project.projectMode === "existing_codebase") {
					try {
						const generationContext =
							await getProjectGenerationContext(projectId);
						if (generationContext) {
							codebaseSnapshotId = generationContext.snapshotId;
							codebaseAnalysisId = generationContext.analysisId ?? undefined;
							const [snapRow] = await db
								.select({
									fileCount: codebaseSnapshots.fileCount,
									contentSize: codebaseSnapshots.contentSize,
								})
								.from(codebaseSnapshots)
								.where(eq(codebaseSnapshots.id, generationContext.snapshotId))
								.limit(1);
							if (snapRow) {
								codebaseSnapshotInfo = {
									fileCount: snapRow.fileCount,
									sourceBytes: snapRow.contentSize,
								};
							}
						}
					} catch (_e) {
						/* optional context must never block generation */
					}
				}

				const metrics = buildAcMetrics({
					prdSource: prdContent,
					prdSourceChars: prdContent.length,
					hasCodebaseContext: Boolean(codebaseSnapshotId),
					codebase: codebaseSnapshotInfo,
				});

				const quote = createCreditQuote({
					userId: user.id,
					projectId,
					stage: "ac",
					operation: "ac_generation",
					metrics,
				});

				const availableCredits = Math.max(
					0,
					(sub.credits ?? 0) -
						(sub.creditsUsed ?? 0) -
						(sub.creditsReserved ?? 0),
				);

				if (eff.state === "paused") {
					return Response.json(
						formatSubscriptionPausedError({
							quote,
							availableCredits,
							stageLabel: "generate AC",
						}),
						{ status: 403 },
					);
				}

				if (availableCredits < quote.maximumCredits) {
					return Response.json(
						formatInsufficientCreditsError({
							quote,
							availableCredits,
							stageLabel: "generate AC",
						}),
						{ status: 403 },
					);
				}

				const idempotencyKey =
					callerIdempotencyKey || `${projectId}:ac:${callerAttempt ?? 1}`;

				let reservation: CreditOperationResult;
				try {
					// A reused key whose operation already terminated cannot
					// generate again: mint a fresh attempt instead of
					// regenerating for free (settled) or against a dead
					// reservation. Genuine in-flight retries keep joining.
					reservation = await reserveActiveCreditOperation({
						userId: user.id,
						projectId,
						stage: "ac",
						operation: "ac_generation",
						metrics,
						idempotencyKey,
						quote,
					});
				} catch (err) {
					console.error("[ac/generate] reserveCreditOperation failed:", err);
					// Map the failure honestly: only genuine credit exhaustion is
					// a 403. Ownership problems are 404, idempotency races are
					// 409, and unexpected failures (DB outage, quote errors)
					// are 5xx so clients/operators can retry and reconcile.
					const message =
						err instanceof Error ? err.message : "Reservation failed";
					if (
						err instanceof CreditSubscriptionOriginError ||
						message === "Insufficient available credit"
					) {
						return Response.json(
							formatInsufficientCreditsError({
								quote,
								availableCredits,
								stageLabel: "generate AC",
							}),
							{ status: 403 },
						);
					}
					if (message === "Credit operation ownership mismatch") {
						return Response.json(
							{ error: "Project not found" },
							{ status: 404 },
						);
					}
					if (
						message === "Credit operation idempotency conflict" ||
						message === "Credit operation reservation transition conflict"
					) {
						return Response.json(
							{ error: "AC sedang digenerate. Tunggu hingga selesai." },
							{ status: 409 },
						);
					}
					return Response.json(
						{ error: "Gagal menyiapkan generate AC. Coba lagi." },
						{ status: 500 },
					);
				}

				// A stale stream must never clear a newer generation's lock: the
				// error paths below reset acStatus only while no newer active
				// credit operation for this project+stage exists. Fails open
				// (resets) when the check itself errors, preserving liveness.
				const ownsProjectLock = async () => {
					try {
						const [latest] = await db
							.select({ id: creditOperations.id })
							.from(creditOperations)
							.where(
								and(
									eq(creditOperations.userId, user.id),
									eq(creditOperations.projectId, projectId),
									eq(creditOperations.stage, "ac"),
									inArray(creditOperations.state, [
										"quoted",
										"reserved",
										"running",
										"settling",
									]),
								),
							)
							.orderBy(desc(creditOperations.createdAt))
							.limit(1);
						return !latest || latest.id === reservation.id;
					} catch {
						return true;
					}
				};

				const claimAc = () =>
					db
						.update(projects)
						.set({ acStatus: "generating" })
						.where(
							and(
								eq(projects.id, projectId),
								ne(projects.acStatus, "generating"),
							),
						)
						.returning({ id: projects.id });

				let claimed = await claimAc();
				if (!claimed.length) {
					for (
						let waited = 0;
						waited < CLAIM_RETRY_MS;
						waited += CLAIM_POLL_MS
					) {
						await new Promise((r) => setTimeout(r, CLAIM_POLL_MS));
						claimed = await claimAc();
						if (claimed.length) break;
					}
					if (!claimed.length) {
						// Never release a running operation: it belongs to the
						// concurrent request that owns the claim.
						if (isReleasableReservation(reservation.state)) {
							await releaseCreditOperation({
								userId: user.id,
								operationId: reservation.id,
								reason: "AC generation conflict",
							}).catch(() => {});
						}
						return Response.json(
							{ error: "AC sedang digenerate. Tunggu hingga selesai." },
							{ status: 409 },
						);
					}
				}

				const modelsToTry = selectModels();

				const stream = new ReadableStream<Uint8Array>({
					async start(controller) {
						const encoder = new TextEncoder();
						let eventDone = false;
						let eventErrored = false;
						let isSettled = false;
						let isReleased = false;
						let isQuarantined = false;
						let fullResponse = "";

						const safeRelease = async (reason: string) => {
							if (isSettled || isReleased || !reservation) return;
							isReleased = true;
							// A running operation is owned by a concurrent
							// request sharing this key: never cancel it here.
							if (!isReleasableReservation(reservation.state)) return;
							try {
								await releaseCreditOperation({
									userId: user.id,
									operationId: reservation.id,
									reason,
								});
							} catch (e) {
								console.error("Failed to release AC credit reservation:", e);
							}
						};

						const safeQuarantine = async (reason: string) => {
							if (isSettled || isReleased || isQuarantined || !reservation)
								return;
							isQuarantined = true;
							try {
								await quarantineCreditOperation({
									userId: user.id,
									operationId: reservation.id,
									reason,
								});
							} catch (e) {
								console.error("Failed to quarantine AC credit operation:", e);
							}
						};

						const emit = (payload: Record<string, unknown>) => {
							try {
								controller.enqueue(
									encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
								);
							} catch {}
						};

						const safeDone = async (finishReason: string | undefined) => {
							if (eventDone || eventErrored) return;
							if (isTruncatedGeneration(fullResponse, finishReason)) {
								await safeRelease("generation truncated");
								await safeError(
									"Generasi AC terputus di tengah jalan dan tidak disimpan. Coba generate ulang.",
								);
								return;
							}
							let saved = false;
							try {
								const savedResult = await saveAcVersion(
									projectId,
									user.id,
									fullResponse,
									"Initial AC generation",
								);
								saved = true;
								if (codebaseSnapshotId) {
									await linkGenerationContext(
										projectId,
										codebaseSnapshotId,
										codebaseAnalysisId,
									);
								}
								const actualMetrics = buildAcMetrics({
									prdSource: prdContent,
									prdSourceChars: prdContent.length,
									hasCodebaseContext: Boolean(codebaseSnapshotId),
									codebase: codebaseSnapshotInfo,
								});
								await settleCreditOperation({
									userId: user.id,
									operationId: reservation.id,
									artifactId: savedResult.acVersionId,
									actualMetrics,
								});
								isSettled = true;
								eventDone = true;
								emit({ type: "done" });
							} catch (e) {
								if (!saved) {
									console.error("saveAcVersion failed:", e);
									await safeRelease("saveAcVersion failed");
									if (await ownsProjectLock()) {
										await db
											.update(projects)
											.set({ acStatus: "pending" })
											.where(eq(projects.id, projectId))
											.catch((err) =>
												console.error("ac_status reset failed:", err),
											);
									}
									emit({
										type: "error",
										error: "Gagal menyimpan AC. Coba generate ulang.",
									});
								} else {
									// The artifact is durable but unpaid: quarantine
									// for manual reconciliation instead of
									// releasing the charge into thin air.
									console.error("AC credit settlement failed:", e);
									await safeQuarantine("settlement error");
									emit({
										type: "error",
										error:
											"AC tersimpan, namun settlement kredit gagal. Hubungi dukungan.",
									});
								}
							}
							try {
								controller.close();
							} catch {}
						};

						const safeError = async (msg: string) => {
							if (eventDone || eventErrored) return;
							eventErrored = true;
							await safeRelease(msg);
							// The error event below must always reach the client;
							// only the lock reset is ownership-gated.
							if (await ownsProjectLock()) {
								try {
									await db
										.update(projects)
										.set({ acStatus: "pending" })
										.where(eq(projects.id, projectId));
								} catch (e) {
									console.error("ac_status reset failed:", e);
								}
							}
							emit({ type: "error", error: msg });
							try {
								controller.close();
							} catch {}
						};

						const enqueueThinking = (text: string) => {
							try {
								controller.enqueue(
									encoder.encode(
										`data: ${JSON.stringify({ type: "thinking", content: text })}\n\n`,
									),
								);
							} catch {}
						};

						try {
							await markCreditOperationRunning({
								userId: user.id,
								operationId: reservation.id,
							});
						} catch (err) {
							// The reservation is not ours to run (a concurrent
							// request owns it, or it died): do not generate
							// against it and do not release it either.
							console.error("markCreditOperationRunning error:", err);
							eventErrored = true;
							if (await ownsProjectLock()) {
								try {
									await db
										.update(projects)
										.set({ acStatus: "pending" })
										.where(eq(projects.id, projectId));
								} catch (e) {
									console.error("ac_status reset failed:", e);
								}
							}
							emit({
								type: "error",
								error: "AC sedang digenerate. Tunggu hingga selesai.",
							});
							try {
								controller.close();
							} catch {}
							return;
						}

						try {
							emit({ type: "started", model: modelsToTry[0], quote });
							emit({ type: "quote", quote });

							let grounded = "";
							try {
								const { groundStack } = await import("@/lib/grounding");
								const { raceWithAbort } = await import("@/lib/abort-utils");
								grounded = await raceWithAbort(
									groundStack(prdContent),
									request.signal,
								);
							} catch (e) {
								if (e instanceof Error && e.name === "AbortError") throw e;
							}

							let codebaseBlock = "";
							if (project.projectMode === "existing_codebase") {
								try {
									const generationContext =
										await getProjectGenerationContext(projectId);
									if (generationContext) {
										codebaseBlock = buildCodebasePromptBlock(generationContext);
									}
								} catch (e) {
									if (e instanceof Error && e.name === "AbortError") throw e;
								}
							}
							const projectLanguage = normalizeLanguage(project.language);
							const systemPrompt = `${AC_GENERATION_PROMPT(projectLanguage)}\n${depthDirective("ac")}\n${getLanguageDirective(projectLanguage, "ac")}\n${grounded}${codebaseBlock}\n\n--- PRD CONTENT ---\n${prdContent}`;
							const messages: Array<{
								role: "system" | "user" | "assistant";
								content: string;
							}> = [
								{ role: "system", content: systemPrompt },
								{
									role: "user",
									content:
										"Generate acceptance criteria based on the PRD above.",
								},
							];

							const { generator, firstChunk, outcome } =
								await tryStreamWithFallback(
									modelsToTry,
									messages,
									request.signal,
									64000,
									enqueueThinking,
								);

							fullResponse += firstChunk;
							emit({ type: "delta", content: firstChunk });

							for await (const chunk of generator) {
								fullResponse += chunk;
								emit({ type: "delta", content: chunk });
							}

							await safeDone(outcome.finishReason);
						} catch (err: unknown) {
							await safeRelease(
								err instanceof Error ? err.message : "stream error",
							);
							const isAbort =
								(err instanceof DOMException && err.name === "AbortError") ||
								(err instanceof Error && err.name === "AbortError") ||
								(err instanceof Error && err.message === "Request aborted") ||
								(err instanceof Error && err.message === "AI stream aborted");
							if (!isAbort) {
								console.error("AC generate stream error:", err);
							}
							await safeError(sanitizeErrorForClient(err, "ac"));
						}
					},
				});

				return new Response(stream, {
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
						Connection: "keep-alive",
					},
				});
			},
		},
	},
});
