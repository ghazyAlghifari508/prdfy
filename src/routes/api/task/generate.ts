import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import {
	buildTaskMetrics,
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
import { normalizeLanguage } from "@/lib/language";
import {
	extractPageInventory,
	findUnknownSurfaces,
} from "@/lib/page-inventory";
import { checkRateLimit } from "@/lib/rate-limit";
import { getLatestAcMarkdown } from "@/lib/services/ac-service";
import {
	selectModels,
	tryStreamWithFallback,
} from "@/lib/services/ai-orchestrator";
import type { CreditOperationResult } from "@/lib/services/credit-service";
import { sanitizeErrorForClient } from "@/lib/services/error-sanitizer";
import { extractJson } from "@/lib/services/json-extract";
import {
	getLatestPrdContent,
	sanitizeModelOutput,
} from "@/lib/services/prd-service";
import {
	buildTaskRepairUserMessage,
	buildTaskSystemPrompt,
	MAX_TASK_COVERAGE_REPAIR_ATTEMPTS,
	repairTaskCoverage,
	TASK_FIRST_PASS_USER_MESSAGE,
} from "@/lib/services/task-generation";
import { parseTaskJson, saveTaskTree } from "@/lib/services/task-service";
import { requireUser } from "@/lib/session";

export const Route = createFileRoute("/api/task/generate")({
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
							error: "Generate Task hanya tersedia di paket Pro dan Hengker.",
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
					.where(
						and(
							eq(projects.id, projectId),
							eq(projects.userId, user.id),
							isNull(projects.deletedAt),
						),
					)
					.limit(1);
				if (!project)
					return Response.json({ error: "Project not found" }, { status: 404 });

				const acMarkdown = await getLatestAcMarkdown(projectId);
				if (!acMarkdown)
					return Response.json(
						{ error: "AC not found. Generate AC first." },
						{ status: 404 },
					);

				// The PRD is generation context, not just a billing input: it
				// carries the flows, data model, architecture, stack, and
				// constraints that AC does not restate. Kept separate from the
				// metrics fallback below so an absent PRD never causes the AC to
				// be injected twice (once as "PRD", once as AC).
				const latestPrd = await getLatestPrdContent(projectId);
				const prdContext = latestPrd ?? "";
				// Metrics measure the PRD when present; AC stands in as the
				// source-size proxy when a legacy project has no PRD row.
				const prdContent = latestPrd ?? acMarkdown;

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

				const metrics = buildTaskMetrics({
					prdSource: prdContent,
					prdSourceChars: prdContent.length,
					taskCount: 0,
					hasCodebaseContext: Boolean(codebaseSnapshotId),
					codebase: codebaseSnapshotInfo,
				});

				const quote = createCreditQuote({
					userId: user.id,
					projectId,
					stage: "task",
					operation: "task_generation",
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
							stageLabel: "generate Task",
						}),
						{ status: 403 },
					);
				}

				if (availableCredits < quote.maximumCredits) {
					return Response.json(
						formatInsufficientCreditsError({
							quote,
							availableCredits,
							stageLabel: "generate Task",
						}),
						{ status: 403 },
					);
				}

				const idempotencyKey =
					callerIdempotencyKey || `${projectId}:task:${callerAttempt ?? 1}`;

				let reservation: CreditOperationResult;
				try {
					// A reused key whose operation already terminated cannot
					// generate again: mint a fresh attempt instead of
					// regenerating for free (settled) or against a dead
					// reservation. Genuine in-flight retries keep joining.
					reservation = await reserveActiveCreditOperation({
						userId: user.id,
						projectId,
						stage: "task",
						operation: "task_generation",
						metrics,
						idempotencyKey,
						quote,
					});
				} catch (err) {
					console.error("[task/generate] reserveCreditOperation failed:", err);
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
								stageLabel: "generate Task",
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
							{ error: "Task sedang digenerate. Tunggu hingga selesai." },
							{ status: 409 },
						);
					}
					return Response.json(
						{ error: "Gagal menyiapkan generate Task. Coba lagi." },
						{ status: 500 },
					);
				}

				// A stale stream must never clear a newer generation's lock: the
				// error paths below reset taskStatus only while no newer active
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
									eq(creditOperations.stage, "task"),
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

				const claimTask = () =>
					db
						.update(projects)
						.set({ taskStatus: "generating" })
						.where(
							and(
								eq(projects.id, projectId),
								ne(projects.taskStatus, "generating"),
							),
						)
						.returning({ id: projects.id });

				let claimed = await claimTask();
				if (!claimed.length) {
					for (
						let waited = 0;
						waited < CLAIM_RETRY_MS;
						waited += CLAIM_POLL_MS
					) {
						await new Promise((r) => setTimeout(r, CLAIM_POLL_MS));
						claimed = await claimTask();
						if (claimed.length) break;
					}
					if (!claimed.length) {
						// Never release a running operation: it belongs to the
						// concurrent request that owns the claim.
						if (isReleasableReservation(reservation.state)) {
							await releaseCreditOperation({
								userId: user.id,
								operationId: reservation.id,
								reason: "Task generation conflict",
							}).catch(() => {});
						}
						return Response.json(
							{ error: "Task sedang digenerate. Tunggu hingga selesai." },
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
						// Composed once per stream: coverage repair reuses the
						// exact same system prompt so the repair round answers
						// under the same contract as the first pass.
						let systemPrompt = "";

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
								console.error("Failed to release Task credit reservation:", e);
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
								console.error("Failed to quarantine Task credit operation:", e);
							}
						};

						const emit = (payload: Record<string, unknown>) => {
							try {
								controller.enqueue(
									encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
								);
							} catch {}
						};

						/**
						 * One extra model round used by coverage repair. Returns
						 * the accumulated text, or "" when the request was
						 * aborted (the caller then stops repairing).
						 */
						const requestRepair = async (
							missing: string[],
						): Promise<string> => {
							if (request.signal.aborted) return "";
							const repairMessages: Array<{
								role: "system" | "user" | "assistant";
								content: string;
							}> = [
								{ role: "system", content: systemPrompt },
								{
									role: "user",
									content: TASK_FIRST_PASS_USER_MESSAGE,
								},
								{ role: "assistant", content: fullResponse },
								{
									role: "user",
									content: buildTaskRepairUserMessage(missing),
								},
							];
							const { generator, firstChunk } = await tryStreamWithFallback(
								modelsToTry,
								repairMessages,
								request.signal,
								64000,
								enqueueThinking,
							);
							let repairText = firstChunk;
							for await (const chunk of generator) {
								repairText += chunk;
							}
							return repairText;
						};

						const safeDone = async (finishReason: string | undefined) => {
							if (eventDone || eventErrored) return;
							if (isTruncatedGeneration(fullResponse, finishReason)) {
								await safeRelease("generation truncated");
								await safeError(
									"Generasi Task terputus di tengah jalan dan tidak disimpan. Coba generate ulang.",
								);
								return;
							}
							try {
								const firstPass = parseTaskJson(
									extractJson(sanitizeModelOutput(fullResponse)),
								);
								if (!firstPass) {
									await safeRelease("invalid task json");
									await safeError(
										"AI menghasilkan JSON tidak valid. Coba lagi.",
									);
									return;
								}

								// Coverage is verified server-side against the AC
								// document itself, not trusted from model prose. A
								// tree missing requirements is repaired with a
								// bounded extra round before it can be saved.
								const coverage = await repairTaskCoverage({
									acMarkdown,
									initialTree: firstPass,
									requestRepair,
									parse: (raw) =>
										parseTaskJson(extractJson(sanitizeModelOutput(raw))),
									maxAttempts: MAX_TASK_COVERAGE_REPAIR_ATTEMPTS,
									isAborted: () => request.signal.aborted,
									onRepair: (attempt, missing) => {
										emit({
											type: "thinking",
											content: `Melengkapi requirement yang belum ter-cover (${missing.join(", ")}), percobaan ${attempt}.`,
										});
									},
								});

								if (request.signal.aborted) {
									await safeRelease("client aborted during repair");
									return;
								}

								if (!coverage.ok) {
									await safeRelease("incomplete requirement coverage");
									await safeError(
										coverage.report.missing.length > 0
											? `Task tree belum men-cover semua Acceptance Criteria (belum ter-cover: ${coverage.report.missing.join(", ")}). Tidak disimpan — coba generate ulang.`
											: `Task tree merujuk Acceptance Criteria yang tidak ada (${coverage.report.unknown.join(", ")}). Tidak disimpan — coba generate ulang.`,
									);
									return;
								}

								const taskTree = coverage.tree;
								// Task → Page traceability: tasks may only reference the
								// surfaces the PRD declares. Legacy PRDs without the
								// inventory have nothing authoritative to validate
								// against, so their surfaces pass through unvalidated
								// rather than being checked against a guess.
								const pageInventory = extractPageInventory(prdContext);
								if (pageInventory.length > 0) {
									const unknownSurfaces = taskTree.features.flatMap((feature) =>
										feature.tasks.flatMap((task) =>
											findUnknownSurfaces(task.surfaces, pageInventory),
										),
									);
									const uniqueUnknown = [...new Set(unknownSurfaces)];
									if (uniqueUnknown.length > 0) {
										await safeRelease("unknown task surfaces");
										await safeError(
											`Task merujuk halaman yang tidak ada di PRD (${uniqueUnknown.join(", ")}). Tidak disimpan — coba generate ulang.`,
										);
										return;
									}
								}
								const saveResult = await saveTaskTree(projectId, taskTree);
								if (codebaseSnapshotId && saveResult.success) {
									await linkGenerationContext(
										projectId,
										codebaseSnapshotId,
										codebaseAnalysisId,
									);
								}
								if (!saveResult.success) {
									await safeRelease("saveTaskTree failed");
									await safeError(
										saveResult.error || "Gagal menyimpan task tree",
									);
									return;
								}

								const actualMetrics = buildTaskMetrics({
									prdSource: prdContent,
									prdSourceChars: prdContent.length,
									taskCount: saveResult.taskCount,
									hasCodebaseContext: Boolean(codebaseSnapshotId),
									codebase: codebaseSnapshotInfo,
								});
								try {
									await settleCreditOperation({
										userId: user.id,
										operationId: reservation.id,
										artifactId: saveResult.artifactId,
										actualMetrics,
									});
									isSettled = true;
									eventDone = true;
									emit({ type: "done", taskTree });
								} catch (settleErr) {
									// The tree is durable but unpaid: quarantine
									// for manual reconciliation instead of
									// releasing the charge into thin air.
									console.error("Task credit settlement failed:", settleErr);
									await safeQuarantine("settlement error");
									await safeError(
										"Task tersimpan, namun settlement kredit gagal. Hubungi dukungan.",
									);
									return;
								}
							} catch (err) {
								console.error("saveTaskTree failed:", err);
								await safeRelease("saveTaskTree error");
								await safeError("Failed to save task tree");
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
										.set({ taskStatus: "pending" })
										.where(eq(projects.id, projectId));
								} catch (e) {
									console.error("task_status reset failed:", e);
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
										.set({ taskStatus: "pending" })
										.where(eq(projects.id, projectId));
								} catch (e) {
									console.error("task_status reset failed:", e);
								}
							}
							emit({
								type: "error",
								error: "Task sedang digenerate. Tunggu hingga selesai.",
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
								// Ground on PRD + AC: the stack/architecture the
								// implementation must follow lives in the PRD, so
								// detecting it from AC alone under-grounds the model.
								grounded = await raceWithAbort(
									groundStack(`${prdContext}\n\n${acMarkdown}`),
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
							systemPrompt = buildTaskSystemPrompt({
								acMarkdown,
								prdContent: prdContext,
								grounded,
								codebaseBlock,
								language: projectLanguage,
							});
							const messages: Array<{
								role: "system" | "user" | "assistant";
								content: string;
							}> = [
								{ role: "system", content: systemPrompt },
								{
									role: "user",
									content: TASK_FIRST_PASS_USER_MESSAGE,
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
							await safeRelease((err as Error)?.message || "stream error");
							console.error("Task generate stream error:", err);
							await safeError(sanitizeErrorForClient(err));
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
