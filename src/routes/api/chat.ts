import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
	buildPrdMetrics,
	type CreditQuote,
	formatInsufficientCreditsError,
	formatSubscriptionPausedError,
} from "@/lib/adaptive-credit";
import {
	buildCodebasePromptBlock,
	getProjectGenerationContext,
	linkGenerationContext,
} from "@/lib/codebase-generation-context";
import {
	MAX_PREFERENCES_CHARS,
	MAX_PROMPT_LENGTH,
	MAX_RESUME_CONTENT_CHARS,
} from "@/lib/constants";
import { isTruncatedGeneration } from "@/lib/flow-progress";
import { getLanguageDirective, normalizeLanguage } from "@/lib/language";
import { depthDirective } from "@/lib/prompt-depth";
import { PRD_REVISION_PROMPT, PRD_SYSTEM_PROMPT } from "@/lib/prompts";
import { checkRateLimit } from "@/lib/rate-limit";
import {
	selectModels,
	tryStreamWithFallback,
} from "@/lib/services/ai-orchestrator";
import {
	ConversationProjectOwnershipError,
	ensureConversation,
	getConversationHistory,
	rollbackStreamInserts,
	saveMessages,
} from "@/lib/services/chat-service";
import type { CreditOperationResult } from "@/lib/services/credit-service";
import { sanitizeErrorForClient } from "@/lib/services/error-sanitizer";
import {
	deriveProjectName,
	deriveProjectNameSync,
	getLatestPrdContent,
	getPrdVersionContent,
	hasExplicitProductName,
	resolveProjectId,
	savePrdVersion,
} from "@/lib/services/prd-service";
import { requireUser } from "@/lib/session";
import type { Plan } from "@/types/database";

export const Route = createFileRoute("/api/chat")({
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
					reserveActiveCreditOperation,
					isReleasableReservation,
					markCreditOperationRunning,
					settleCreditOperation,
					releaseCreditOperation,
					quarantineCreditOperation,
				} = await import("@/lib/services/credit-service");

				const [sub] = await db
					.select({
						plan: subscriptions.plan,
						credits: subscriptions.credits,
						creditsUsed: subscriptions.creditsUsed,
						creditsReserved: subscriptions.creditsReserved,
						currentPeriodEnd: subscriptions.currentPeriodEnd,
					})
					.from(subscriptions)
					.where(eq(subscriptions.userId, user.id))
					.orderBy(desc(subscriptions.createdAt))
					.limit(1);
				const plan = (sub?.plan || "free") as Plan;

				const body = await request.json();
				const {
					message,
					displayMessage,
					conversationId,
					projectId,
					mode = "chat",
					partialContent,
					preferences,
					selectedVersionNum,
					idempotencyKey: callerIdempotencyKey,
					attempt: callerAttempt,
				} = body as {
					message: string;
					displayMessage?: string;
					conversationId?: string;
					projectId?: string;
					mode?: "chat" | "generate" | "revise" | "resume";
					partialContent?: string;
					preferences?: Record<string, unknown>;
					selectedVersionNum?: number;
					idempotencyKey?: string;
					attempt?: number;
				};

				if (!message?.trim())
					return Response.json(
						{ error: "Message is required" },
						{ status: 400 },
					);
				// Bounded inputs: unbounded strings flow straight into the
				// model prompt (cost/latency) and partialContent is persisted
				// into PRD versions on resume. Caps mirror the documented
				// home-prompt contract; resume content allows a full PRD.
				if (message.length > MAX_PROMPT_LENGTH) {
					return Response.json(
						{
							error: `Message terlalu panjang (maksimal ${MAX_PROMPT_LENGTH} karakter).`,
						},
						{ status: 400 },
					);
				}
				if (
					partialContent !== undefined &&
					(typeof partialContent !== "string" ||
						partialContent.length > MAX_RESUME_CONTENT_CHARS)
				) {
					return Response.json(
						{ error: "Konten resume tidak valid." },
						{ status: 400 },
					);
				}
				if (
					preferences !== undefined &&
					(typeof preferences !== "object" ||
						preferences === null ||
						JSON.stringify(preferences).length > MAX_PREFERENCES_CHARS)
				) {
					return Response.json(
						{ error: "Preferences tidak valid." },
						{ status: 400 },
					);
				}

				const rateCheck = await checkRateLimit(user.id, plan, "ai_generate");
				if (!rateCheck.allowed)
					return Response.json(
						{
							error: "Too many requests. Please wait a moment.",
							retryAfter: 60,
						},
						{ status: 429 },
					);

				let conversationIdToUse = conversationId;
				let projectIdToUse = projectId;
				let createdProjectId: string | undefined;
				let createdConversationId: string | undefined;
				let conversationHistory: Array<{
					role: "system" | "user" | "assistant";
					content: string;
				}> = [];

				if (conversationIdToUse) {
					const result = await getConversationHistory(
						conversationIdToUse,
						user.id,
					);
					if (!result.valid)
						return Response.json(
							{ error: "Conversation not found or unauthorized" },
							{ status: 403 },
						);
					conversationHistory = result.messages;
				}

				if (mode === "generate" && !conversationIdToUse) {
					let result: Awaited<ReturnType<typeof ensureConversation>>;
					try {
						result = await ensureConversation(
							user.id,
							projectIdToUse,
							deriveProjectNameSync(message),
							preferences || null,
						);
					} catch (error) {
						if (error instanceof ConversationProjectOwnershipError) {
							return Response.json(
								{ error: "Project not found or unauthorized" },
								{ status: 403 },
							);
						}
						throw error;
					}
					conversationIdToUse = result.conversationId;
					projectIdToUse = result.projectId;
					createdConversationId = result.createdConversationId;
					createdProjectId = result.createdProjectId;
				}

				let systemPrompt = PRD_SYSTEM_PROMPT();
				let groundingSource = message;
				let projectLanguage: "id" | "en" = "id";
				let codebaseBlock = "";
				let codebaseSnapshotId: string | undefined;
				let codebaseAnalysisId: string | undefined;
				let codebaseSnapshotInfo:
					| { fileCount?: number; sourceBytes?: number }
					| undefined;

				if (projectIdToUse) {
					const [projCheck] = await db
						.select({
							id: projects.id,
							language: projects.language,
							projectMode: projects.projectMode,
							step: projects.step,
						})
						.from(projects)
						.where(
							and(
								eq(projects.id, projectIdToUse),
								eq(projects.userId, user.id),
								isNull(projects.deletedAt),
							),
						)
						.limit(1);

					if (!projCheck) {
						return Response.json(
							{ error: "Project not found or unauthorized" },
							{ status: 403 },
						);
					}

					if (mode === "revise") {
						const { isPrdLocked } = await import("@/lib/flow-progress");
						if (isPrdLocked(projCheck?.step)) {
							const stageLabel =
								projCheck?.step === "task"
									? "Task / Kanban"
									: "Acceptance Criteria";
							return Response.json(
								{
									error: `Dokumen PRD telah dikunci (Read-Only) karena proyek telah mencapai tahap ${stageLabel}.`,
									code: "PRD_LOCKED",
								},
								{ status: 409 },
							);
						}
					}

					if (projCheck?.language) {
						projectLanguage = normalizeLanguage(projCheck.language);
					}

					if (projCheck?.projectMode === "existing_codebase") {
						try {
							const generationContext =
								await getProjectGenerationContext(projectIdToUse);
							if (generationContext) {
								codebaseBlock = buildCodebasePromptBlock(generationContext);
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
						} catch {
							/* optional context must never block generation */
						}
					}

					if (mode === "revise" || mode === "chat") {
						const activeContent =
							mode === "revise" && selectedVersionNum
								? await getPrdVersionContent(projectIdToUse, selectedVersionNum)
								: await getLatestPrdContent(projectIdToUse);
						if (activeContent) {
							groundingSource = `${activeContent}\n\n${message}`;
							if (mode === "revise") {
								systemPrompt = `${PRD_REVISION_PROMPT}\n\nCURRENT PRD CONTENT:\n\n${activeContent}`;
							}
						}
					}
				}

				let creditQuote: CreditQuote | undefined;
				let reservation: CreditOperationResult | undefined;

				if (mode === "generate" && projectIdToUse) {
					const metrics = buildPrdMetrics({
						prompt: message,
						promptChars: message.length,
						hasCodebaseContext: Boolean(codebaseSnapshotId),
						codebase: codebaseSnapshotInfo,
					});

					creditQuote = createCreditQuote({
						userId: user.id,
						projectId: projectIdToUse,
						stage: "prd",
						operation: "prd_generation",
						metrics,
					});

					const isPaused =
						sub?.currentPeriodEnd !== null &&
						sub?.currentPeriodEnd !== undefined &&
						new Date(sub.currentPeriodEnd).getTime() < Date.now();

					const availableCredits = Math.max(
						0,
						(sub?.credits ?? 0) -
							(sub?.creditsUsed ?? 0) -
							(sub?.creditsReserved ?? 0),
					);

					if (isPaused) {
						if (createdProjectId) {
							await rollbackStreamInserts(
								user.id,
								createdConversationId,
								createdProjectId,
							).catch(() => {});
						}
						return Response.json(
							formatSubscriptionPausedError({
								quote: creditQuote,
								availableCredits,
								stageLabel: "membuat PRD",
							}),
							{ status: 403 },
						);
					}

					if (availableCredits < creditQuote.maximumCredits) {
						if (createdProjectId) {
							await rollbackStreamInserts(
								user.id,
								createdConversationId,
								createdProjectId,
							).catch(() => {});
						}
						return Response.json(
							formatInsufficientCreditsError({
								quote: creditQuote,
								availableCredits,
								stageLabel: "membuat PRD",
							}),
							{ status: 403 },
						);
					}

					const idempotencyKey =
						callerIdempotencyKey ||
						`${projectIdToUse}:prd:${callerAttempt ?? 1}`;

					try {
						// A reused key whose operation already terminated cannot
						// generate again: mint a fresh attempt instead of
						// regenerating for free (settled) or against a dead
						// reservation. Genuine in-flight retries keep joining.
						reservation = await reserveActiveCreditOperation({
							userId: user.id,
							projectId: projectIdToUse,
							stage: "prd",
							operation: "prd_generation",
							metrics,
							idempotencyKey,
							quote: creditQuote,
						});
					} catch (err) {
						console.error("[chat] reserveCreditOperation failed:", err);
						if (createdProjectId) {
							await rollbackStreamInserts(
								user.id,
								createdConversationId,
								createdProjectId,
							).catch(() => {});
						}
						return Response.json(
							formatInsufficientCreditsError({
								quote: creditQuote,
								availableCredits,
								stageLabel: "membuat PRD",
							}),
							{ status: 403 },
						);
					}
				}

				const modelsToTry = selectModels();
				// projectLanguage settled after the project lookup above; rebuild PRD
				// prompt with localized sub-headings now that the value is known.
				if (mode !== "revise")
					systemPrompt = PRD_SYSTEM_PROMPT(projectLanguage);
				systemPrompt += `\n${depthDirective("prd")}`;
				systemPrompt += `\n${getLanguageDirective(projectLanguage, "prd")}`;

				// ponytail: server-only grounding, dynamically imported so it never
				// enters the client bundle. groundStack() returns "" on any failure;
				// the import itself is wrapped so a module-load error can't 500 the route.
				try {
					const { groundStack } = await import("@/lib/grounding");
					systemPrompt += await groundStack(groundingSource);
				} catch {
					/* ponytail: optional grounding must never block generation */
				}
				// Task 8: same grounding boundary — "" for greenfield (no-op).
				systemPrompt += codebaseBlock;

				let fullMessages: Array<{
					role: "system" | "user" | "assistant";
					content: string;
				}> = [];
				if (mode === "resume" && partialContent) {
					fullMessages = [
						{ role: "system", content: systemPrompt },
						...conversationHistory,
						{ role: "user", content: message },
						{ role: "assistant", content: partialContent },
						{
							role: "user",
							content:
								"Koneksi terputus. Lanjutkan penulisan dokumen tepat dari bagian terakhir teks di atas tanpa mengulang kalimat sebelumnya.",
						},
					];
				} else {
					fullMessages = [
						{ role: "system", content: systemPrompt },
						...conversationHistory,
						{ role: "user" as const, content: message },
					];
				}

				const stream = new ReadableStream({
					async start(controller) {
						const encoder = new TextEncoder();
						let fullResponse = "";
						let eventStarted = false;
						let eventDone = false;
						let eventErrored = false;
						let isSettled = false;
						let isReleased = false;
						let isQuarantined = false;

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
								console.error("Failed to release credit operation:", e);
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
								console.error("Failed to quarantine credit operation:", e);
							}
						};

						const emit = (payload: Record<string, unknown>) => {
							try {
								controller.enqueue(
									encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
								);
							} catch {}
						};
						// ponytail: bare controller.enqueue at the two delta points threw when
						// the client disconnected (refresh), which fell into the catch and
						// deleted the project. Guard like emit() does; abort handling below.
						const enqueueDelta = (chunk: string) => {
							try {
								controller.enqueue(
									encoder.encode(
										`data: ${JSON.stringify({ type: "delta", content: chunk })}\n\n`,
									),
								);
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
						const safeDone = (extras: Record<string, unknown>) => {
							if (eventDone) return;
							eventDone = true;
							const isEn = normalizeLanguage(projectLanguage) === "en";
							emit({
								type: "done",
								summaryMessage: isEn
									? "Finished generating PRD."
									: "Selesai menyusun PRD.",
								...extras,
							});
							try {
								controller.close();
							} catch {}
						};
						const safeError = async (msg: string) => {
							if (eventDone || eventErrored) return;
							eventErrored = true;
							await safeRelease(msg);
							emit({ type: "error", error: msg });
							try {
								controller.close();
							} catch {}
						};

						if (!eventStarted) {
							eventStarted = true;
							if (mode === "generate" && reservation) {
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
									emit({
										type: "error",
										error: "PRD sedang digenerate. Tunggu hingga selesai.",
									});
									try {
										controller.close();
									} catch {}
									return;
								}
							}
							emit({
								type: "started",
								model: modelsToTry[0],
								quote: creditQuote,
							});
							if (creditQuote) {
								emit({ type: "quote", quote: creditQuote });
							}
						}

						try {
							const { generator, firstChunk, outcome } =
								await tryStreamWithFallback(
									modelsToTry,
									fullMessages,
									request.signal,
									undefined,
									enqueueThinking,
								);

							if (!conversationIdToUse) {
								try {
									const result = await ensureConversation(
										user.id,
										projectIdToUse,
										deriveProjectNameSync(message),
										preferences || null,
									);
									conversationIdToUse = result.conversationId;
									projectIdToUse = result.projectId;
									createdConversationId = result.createdConversationId;
									createdProjectId = result.createdProjectId;
								} catch (error) {
									if (error instanceof ConversationProjectOwnershipError) {
										await safeRelease("conversation ownership mismatch");
										await safeError("Project not found or unauthorized");
										return;
									}
									throw error;
								}
							}

							fullResponse += firstChunk;
							enqueueDelta(firstChunk);

							for await (const chunk of generator) {
								fullResponse += chunk;
								enqueueDelta(chunk);
							}

							let assistantReply: string;
							if (mode === "revise") {
								const preamble = fullResponse
									.split(":::UPDATE_SECTION")[0]
									.trim();
								assistantReply = preamble || "Revisi berhasil diterapkan.";
							} else if (mode === "generate" || mode === "resume") {
								assistantReply = "Selesai menyusun PRD awal.";
							} else {
								assistantReply = fullResponse;
							}

							// ponytail: only genuine conversation modes persist chat bubbles.
							// generate/resume originate from the home prompt, persisting them
							// here leaked the seed prompt + "Selesai menyusun PRD awal." into
							// the chat panel after the loader repopulated the store on refresh.
							// PRD content itself is saved via savePrdVersion below; the chat
							// panel is for follow-up Q&A only.
							if (
								conversationIdToUse &&
								(mode === "chat" || mode === "revise")
							) {
								await saveMessages(
									conversationIdToUse,
									displayMessage || message,
									assistantReply,
									modelsToTry[0],
								);
							}

							let finalPrdToSave: string | undefined;
							if (
								(mode === "generate" ||
									mode === "revise" ||
									mode === "resume") &&
								conversationIdToUse
							) {
								if (isTruncatedGeneration(fullResponse, outcome.finishReason)) {
									await safeRelease("generation truncated");
									await safeError(
										"Generasi PRD terputus di tengah jalan dan tidak disimpan. Coba generate ulang.",
									);
									return;
								}
								finalPrdToSave =
									mode === "resume" && partialContent
										? partialContent + fullResponse
										: fullResponse;

								if (mode === "revise" && projectIdToUse) {
									const currentPrd = selectedVersionNum
										? await getPrdVersionContent(
												projectIdToUse,
												selectedVersionNum,
											)
										: await getLatestPrdContent(projectIdToUse);
									if (currentPrd) {
										finalPrdToSave = currentPrd;
										const updateRegex =
											/:::UPDATE_SECTION\[(.*?)\]:::\s*([\s\S]*?)(?:\s*:::END_UPDATE:::|$)/g;
										let mergedPrd = currentPrd;
										let isMerged = false;

										for (const match of fullResponse.matchAll(updateRegex)) {
											const sectionName = match[1].trim();
											const newSectionContent = match[2].trim();
											const escapedSectionName = sectionName.replace(
												/[.*+?^${}()|[\]\\]/g,
												"\\$&",
											);
											const openingTag = `<!-- SECTION: ${escapedSectionName} -->`;

											let sectionRegex = new RegExp(
												`${openingTag}[\\s\\S]*?<!-- \\/SECTION -->`,
												"g",
											);
											if (sectionRegex.test(mergedPrd)) {
												sectionRegex.lastIndex = 0;
												mergedPrd = mergedPrd.replace(
													sectionRegex,
													`${openingTag}\n${newSectionContent}\n<!-- /SECTION -->`,
												);
												isMerged = true;
												continue;
											}

											const ALL_SECTION_NAMES = [
												"Overview",
												"Goals & Success Metrics",
												"Requirements",
												"Core Features",
												"User Flow",
												"Architecture & Tech Stack",
												"Database Schema",
												"Design & Technical Constraints",
											];
											const sectionIdx = ALL_SECTION_NAMES.indexOf(sectionName);
											// Unknown/mismatched section name (e.g. numbered "1. Overview") — skip
											// this update rather than falling through to a wildcard EOF match that
											// would destroy the rest of the document.
											if (sectionIdx === -1) continue;
											const nextSection =
												sectionIdx < ALL_SECTION_NAMES.length - 1
													? ALL_SECTION_NAMES[sectionIdx + 1]
													: null;
											const endBoundary = nextSection
												? `(?:[\\s\\S]*?<!-- SECTION: ${nextSection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} -->)`
												: "(?:[\\s\\S]*|$)";
											sectionRegex = new RegExp(
												`${openingTag}[\\s\\S]*?${endBoundary}`,
												"g",
											);
											if (sectionRegex.test(mergedPrd)) {
												sectionRegex.lastIndex = 0;
												const endMarker = nextSection
													? `\n\n<!-- SECTION: ${nextSection} -->`
													: "";
												mergedPrd = mergedPrd.replace(
													sectionRegex,
													`${openingTag}\n${newSectionContent}${endMarker}`,
												);
												isMerged = true;
											}
										}

										if (isMerged) finalPrdToSave = mergedPrd;
									}
								}

								const { FEATURES } = await import("@/types/database");
								const allowShare = FEATURES[plan].shareLink !== false;
								const targetId = conversationIdToUse || projectIdToUse;
								if (!targetId) {
									await safeRelease("target id missing");
									await safeError("Project or conversation ID is missing");
									return;
								}
								const saveResult = await savePrdVersion(
									targetId,
									finalPrdToSave,
									message,
									mode === "resume" ? "generate" : mode,
									allowShare,
								);

								// Task 8: link snapshot identity (non-fatal, no
								// credit change: generate burns 1, revision free).
								if (codebaseSnapshotId && projectIdToUse) {
									await linkGenerationContext(
										projectIdToUse,
										codebaseSnapshotId,
										codebaseAnalysisId,
									);
								}

								// AI rename of project (cosmetic only)
								void (async () => {
									try {
										if (mode !== "generate" || !projectIdToUse) return;
										if (hasExplicitProductName(message)) return;
										const better = await deriveProjectName(message);
										if (!better || better === "Project Baru") return;
										await db
											.update(projects)
											.set({ name: better })
											.where(eq(projects.id, projectIdToUse));
									} catch (e) {
										console.warn("AI project rename skipped:", e);
									}
								})();

								// AI one-liner for history preview
								void (async () => {
									try {
										if (
											(mode !== "generate" && mode !== "resume") ||
											!projectIdToUse ||
											!finalPrdToSave
										)
											return;
										const { generateProjectSummary } = await import(
											"@/lib/services/project-summary"
										);
										const summary = await generateProjectSummary({
											prdContent: finalPrdToSave,
											ideaPrompt: message,
										});
										if (!summary) return;
										await db
											.update(projects)
											.set({ description: summary })
											.where(eq(projects.id, projectIdToUse));
									} catch (e) {
										console.warn("AI project summary skipped:", e);
									}
								})();

								if (mode === "generate" && reservation) {
									if (!saveResult?.prdVersionId) {
										await safeRelease("savePrdVersion failed");
										await safeError("PRD gagal disimpan. Coba generate ulang.");
										return;
									}
									const actualMetrics = buildPrdMetrics({
										prompt: message,
										promptChars: message.length,
										hasCodebaseContext: Boolean(codebaseSnapshotId),
										codebase: codebaseSnapshotInfo,
									});
									try {
										await settleCreditOperation({
											userId: user.id,
											operationId: reservation.id,
											artifactId: saveResult.prdVersionId,
											actualMetrics,
										});
										isSettled = true;
									} catch (err) {
										// The version is durable but unpaid: quarantine
										// for manual reconciliation instead of
										// releasing the charge into thin air.
										console.error("PRD credit settlement failed:", err);
										await safeQuarantine("settlement error");
										await safeError(
											"PRD tersimpan, namun settlement kredit gagal. Hubungi dukungan.",
										);
										return;
									}
								}
							}

							const resolvedProject = await resolveProjectId(
								projectIdToUse,
								conversationIdToUse,
							);
							const donePayload: Record<string, unknown> = {
								conversationId: conversationIdToUse,
								projectId: resolvedProject || undefined,
								summaryMessage: assistantReply,
							};
							if (mode === "revise" && finalPrdToSave)
								donePayload.content = finalPrdToSave;
							safeDone(donePayload);
						} catch (error) {
							await safeRelease(
								error instanceof Error ? error.message : "stream error",
							);
							const errMsg =
								error instanceof Error ? error.message : String(error);
							const errName = error instanceof Error ? error.name : "";
							const isClientAbort =
								errName === "AbortError" ||
								/aborted|Invalid state: The stream closed|Controller is already closed|ReadableStream/i.test(
									errMsg,
								);

							// ponytail: a client disconnect mid-stream (refresh, tab close,
							// network blip) is normal, NOT a reason to delete the just-created
							// project + conversation. Roll back only on a real generation error
							// that produced no content yet. A project with a partial/no PRD is
							// recoverable; a deleted project loses the user's entry entirely.
							if (isClientAbort && fullResponse.length > 0) {
								console.warn(
									"Chat stream: client disconnected mid-generation; kept project + conversation.",
								);
							} else if (isClientAbort) {
								console.warn(
									"Chat stream: client disconnected before content; kept project for retry.",
								);
							} else if (fullResponse.length === 0) {
								try {
									await rollbackStreamInserts(
										user.id,
										createdConversationId,
										createdProjectId,
									);
								} catch (rollbackError) {
									console.error(
										"Failed to roll back chat stream inserts:",
										rollbackError,
									);
								}
								safeError(sanitizeErrorForClient(error));
							} else {
								console.error(
									"Chat stream errored after content; kept partial state:",
									errMsg,
								);
								safeError(sanitizeErrorForClient(error));
							}
						} finally {
							try {
								if (!eventDone && !eventErrored) controller.close();
							} catch {}
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
