import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { projects, subscriptions } from "@/db/schema";
import {
	buildCodebasePromptBlock,
	getProjectGenerationContext,
	linkGenerationContext,
} from "@/lib/codebase-generation-context";
import { CLAIM_POLL_MS, CLAIM_RETRY_MS } from "@/lib/constants";
import { checkCredits, consumeCredit, hasFullWorkflow } from "@/lib/credits";
import { isTruncatedGeneration } from "@/lib/flow-progress";
import { getLanguageDirective, normalizeLanguage } from "@/lib/language";
import { depthDirective } from "@/lib/prompt-depth";
import { AC_GENERATION_PROMPT } from "@/lib/prompts-ac";
import { checkRateLimit, recordRequest } from "@/lib/rate-limit";
import { saveAcVersion } from "@/lib/services/ac-service";
import {
	selectModels,
	tryStreamWithFallback,
} from "@/lib/services/ai-orchestrator";
import { sanitizeErrorForClient } from "@/lib/services/error-sanitizer";
import { getLatestPrdContent } from "@/lib/services/prd-service";
import { requireUser } from "@/lib/session";

export const Route = createFileRoute("/api/ac/generate")({
	server: {
		handlers: {
			POST: async ({ request }: { request: Request }) => {
				const user = await requireUser(request.headers);

				const { projectId } = await request
					.json()
					.catch(() => ({ projectId: undefined }));
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
						currentPeriodStart: subscriptions.currentPeriodStart,
						currentPeriodEnd: subscriptions.currentPeriodEnd,
						cancelledAt: subscriptions.cancelledAt,
					})
					.from(subscriptions)
					.where(eq(subscriptions.userId, user.id))
					.orderBy(desc(subscriptions.createdAt))
					.limit(1);
				const eff = resolveSubscriptionState(sub, new Date());

				if (eff.state === "paused") {
					return Response.json(
						{
							error:
								"Masa aktif langgananmu sudah habis. Perpanjang di halaman Pricing untuk generate AC.",
							code: "SUBSCRIPTION_PAUSED",
						},
						{ status: 403 },
					);
				}

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

				const creditCheck = await checkCredits(user.id);
				if (!creditCheck.allowed) {
					return Response.json(
						{
							error: "Kredit kamu sudah habis. Beli kredit untuk generate AC.",
							code: "NO_CREDITS",
							plan: creditCheck.plan,
							remaining: creditCheck.remaining,
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
				await recordRequest(user.id, "api_call");

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
					// Abort unwind is instant and safeError awaits the claim
					// release, so this window rarely matters — kept bounded as a
					// safety net for StrictMode double-mount retries racing the
					// teardown of a dead generation.
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
						let fullResponse = "";
						// Task 8 snapshot identity, filled when the system
						// prompt is built and read back in safeDone.
						let codebaseSnapshotId: string | undefined;
						let codebaseAnalysisId: string | undefined;

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
								await safeError(
									"Generasi AC terputus di tengah jalan dan tidak disimpan. Coba generate ulang.",
								);
								return;
							}
							eventDone = true;
							let saved = false;
							try {
								// saveAcVersion also flips acStatus → "completed" + advances step
								// (overwrite-v1 semantics preserved — no version change).
								await saveAcVersion(
									projectId,
									fullResponse,
									"Initial AC generation",
								);
								saved = true;
								// Task 8: link snapshot identity (non-fatal, no
								// credit change — AC generate still burns 1).
								if (codebaseSnapshotId) {
									await linkGenerationContext(
										projectId,
										codebaseSnapshotId,
										codebaseAnalysisId,
									);
								}
								await consumeCredit(user.id);
								emit({ type: "done" });
							} catch (e) {
								if (!saved) {
									// Save failed: release the claim BEFORE the terminal
									// event, mirroring task/generate.ts — otherwise acStatus
									// stays 'generating' and every retry answers 409 forever.
									console.error("saveAcVersion failed:", e);
									await db
										.update(projects)
										.set({ acStatus: "pending" })
										.where(eq(projects.id, projectId))
										.catch((err) =>
											console.error("ac_status reset failed:", err),
										);
									emit({
										type: "error",
										error: "Gagal menyimpan AC. Coba generate ulang.",
									});
								} else {
									// Save succeeded (acStatus is 'completed') — do NOT reset
									// it here, only report the credit burn failure.
									console.error("AC credit burn failed:", e);
									emit({
										type: "error",
										error:
											"AC tersimpan, namun terjadi kesalahan saat memotong kredit.",
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
							// ponytail: release the claim BEFORE the terminal event reaches
							// the client — an immediate StrictMode remount retry must see
							// acStatus='pending', never inherit this dead generation's lock.
							try {
								await db
									.update(projects)
									.set({ acStatus: "pending" })
									.where(eq(projects.id, projectId));
							} catch (e) {
								console.error("ac_status reset failed:", e);
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
							emit({ type: "started", model: modelsToTry[0] });

							let grounded = "";
							try {
								const { groundStack } = await import("@/lib/grounding");
								const { raceWithAbort } = await import("@/lib/abort-utils");
								// Grounding is signal-deaf for up to its own 6s budget; racing
								// it against the abort signal lets a disconnected client free
								// the claim instantly instead of after the budget expires.
								grounded = await raceWithAbort(
									groundStack(prdContent),
									request.signal,
								);
							} catch (e) {
								if (e instanceof Error && e.name === "AbortError") throw e;
								/* ponytail: optional grounding must never block generation */
							}
							// Task 8: bounded snapshot-bound context via the shared
							// builder. "" for greenfield/not-ready (no-op).
							// Consumes no credits.
							let codebaseBlock = "";
							if (project.projectMode === "existing_codebase") {
								try {
									const generationContext =
										await getProjectGenerationContext(projectId);
									if (generationContext) {
										codebaseBlock = buildCodebasePromptBlock(generationContext);
										codebaseSnapshotId = generationContext.snapshotId;
										codebaseAnalysisId =
											generationContext.analysisId ?? undefined;
									}
								} catch (e) {
									if (e instanceof Error && e.name === "AbortError") throw e;
									/* ponytail: optional context must never block generation */
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
