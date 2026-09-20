import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, ne } from "drizzle-orm";
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
import { getLanguageDirective, normalizeLanguage } from "@/lib/language";
import { TASK_GENERATION_PROMPT } from "@/lib/prompts-task";
import { checkRateLimit } from "@/lib/rate-limit";
import { getLatestAcMarkdown } from "@/lib/services/ac-service";
import {
	selectModels,
	tryStreamWithFallback,
} from "@/lib/services/ai-orchestrator";
import { sanitizeErrorForClient } from "@/lib/services/error-sanitizer";
import { extractJson } from "@/lib/services/json-extract";
import {
	getLatestPrdContent,
	sanitizeModelOutput,
} from "@/lib/services/prd-service";
import { parseTaskJson, saveTaskTree } from "@/lib/services/task-service";
import { requireUser } from "@/lib/session";

export const Route = createFileRoute("/api/task/generate")({
	server: {
		handlers: {
			POST: async ({ request }: { request: Request }) => {
				const user = await requireUser(request.headers);

				const { db } = await import("@/db");
				const { codebaseSnapshots, projects, subscriptions } = await import(
					"@/db/schema"
				);
				const {
					createCreditQuote,
					reserveCreditOperation,
					markCreditOperationRunning,
					settleCreditOperation,
					releaseCreditOperation,
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
					.where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
					.limit(1);
				if (!project)
					return Response.json({ error: "Project not found" }, { status: 404 });

				const acMarkdown = await getLatestAcMarkdown(projectId);
				if (!acMarkdown)
					return Response.json(
						{ error: "AC not found. Generate AC first." },
						{ status: 404 },
					);

				const prdContent = (await getLatestPrdContent(projectId)) ?? acMarkdown;

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

				let reservation: {
					id: string;
					state: string;
					finalCharge: number | null;
				};
				try {
					reservation = await reserveCreditOperation({
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
					return Response.json(
						formatInsufficientCreditsError({
							quote,
							availableCredits,
							stageLabel: "generate Task",
						}),
						{ status: 403 },
					);
				}

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
						await releaseCreditOperation({
							userId: user.id,
							operationId: reservation.id,
							reason: "Task generation conflict",
						}).catch(() => {});
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
						let fullResponse = "";

						const safeRelease = async (reason: string) => {
							if (isSettled || isReleased || !reservation) return;
							isReleased = true;
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
									"Generasi Task terputus di tengah jalan dan tidak disimpan. Coba generate ulang.",
								);
								return;
							}
							eventDone = true;
							try {
								const taskTree = parseTaskJson(
									extractJson(sanitizeModelOutput(fullResponse)),
								);
								if (!taskTree) {
									await safeRelease("invalid task json");
									await safeError(
										"AI menghasilkan JSON tidak valid. Coba lagi.",
									);
									return;
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
									emit({ type: "done", taskTree });
								} catch (settleErr) {
									console.error("Task credit settlement failed:", settleErr);
									await safeRelease("settlement error");
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
							try {
								await db
									.update(projects)
									.set({ taskStatus: "pending" })
									.where(eq(projects.id, projectId));
							} catch (e) {
								console.error("task_status reset failed:", e);
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
							}).catch((err) =>
								console.error("markCreditOperationRunning error:", err),
							);

							emit({ type: "started", model: modelsToTry[0], quote });
							emit({ type: "quote", quote });

							let grounded = "";
							try {
								const { groundStack } = await import("@/lib/grounding");
								const { raceWithAbort } = await import("@/lib/abort-utils");
								grounded = await raceWithAbort(
									groundStack(acMarkdown),
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
							const systemPrompt = `${TASK_GENERATION_PROMPT}\n${getLanguageDirective(projectLanguage, "task")}\n${grounded}${codebaseBlock}\n\n--- ACCEPTANCE CRITERIA ---\n${acMarkdown}`;
							const messages: Array<{
								role: "system" | "user" | "assistant";
								content: string;
							}> = [
								{ role: "system", content: systemPrompt },
								{
									role: "user",
									content: "Generate the task tree JSON based on the AC above.",
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
