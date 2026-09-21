import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { projects, prdVersions, subscriptions } from "@/db/schema";
import {
	askHandoffSchema,
	buildCodebasePromptBlock,
	getAskHandoff,
	getProjectGenerationContext,
	resolveActiveSnapshotId,
	saveAskHandoff,
} from "@/lib/codebase-generation-context";
import { isTruncatedGeneration, shouldMarkQuestionStep } from "@/lib/flow-progress";
import { getLanguageDirective, normalizeLanguage } from "@/lib/language";
import { ASK_OPTIONS_GENERATION_PROMPT } from "@/lib/prompts-ask";
import { MAX_PROMPT_LENGTH } from "@/lib/constants";
import { checkRateLimit } from "@/lib/rate-limit";
import {
	selectModels,
	tryStreamWithFallback,
} from "@/lib/services/ai-orchestrator";
import { parseAskOptionsJson } from "@/lib/services/ask-service";
import { sanitizeErrorForClient } from "@/lib/services/error-sanitizer";
import { extractJson } from "@/lib/services/json-extract";
import { sanitizeModelOutput } from "@/lib/services/prd-service";
import { requireUser } from "@/lib/session";
import type { Plan } from "@/types/database";

export const Route = createFileRoute("/api/ask/options")({
	server: {
		handlers: {
			POST: async ({ request }: { request: Request }) => {
				let user: { id: string };
				try {
					user = await requireUser(request.headers);
				} catch {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}

				const body = (await request.json().catch(() => ({}))) as {
					projectId?: string;
					prompt?: string;
					platform?: string;
					language?: string;
					action?: string;
					handoff?: unknown;
				};
				const {
					projectId,
					prompt,
					platform,
					language: reqLang,
					action,
					handoff,
				} = body;
				if (!projectId)
					return Response.json(
						{ error: "Project ID required" },
						{ status: 400 },
					);
				const isHandoffAction =
					action === "save-handoff" || action === "get-handoff";
				if (!isHandoffAction) {
					if (
						!prompt ||
						typeof prompt !== "string" ||
						prompt.trim().length < 3
					) {
						return Response.json({ error: "Prompt required" }, { status: 400 });
					}
					// Documented upper bound (same contract as the home input):
					// unbounded prompts exhaust model context and inflate cost.
					if (prompt.length > MAX_PROMPT_LENGTH) {
						return Response.json(
							{
								error: `Prompt terlalu panjang (maksimal ${MAX_PROMPT_LENGTH} karakter).`,
							},
							{ status: 400 },
						);
					}
				}

				const [sub] = await db
					.select({ plan: subscriptions.plan })
					.from(subscriptions)
					.where(eq(subscriptions.userId, user.id))
					.orderBy(desc(subscriptions.createdAt))
					.limit(1);
				const rawPlan = sub?.plan || "free";
				const plan: Plan = ["free", "pro", "hengker"].includes(rawPlan)
					? (rawPlan as Plan)
					: "free";

				const [project] = await db
					.select({
						id: projects.id,
						name: projects.name,
						language: projects.language,
						projectMode: projects.projectMode,
					})
					.from(projects)
					.where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
					.limit(1);
				if (!project)
					return Response.json({ error: "Project not found" }, { status: 404 });

				// Rate-limit AFTER the ownership check so failed guesses and
				// 404s never consume the caller's quota.
				const rateCheck = await checkRateLimit(user.id, plan, "api_call");
				if (!rateCheck.allowed)
					return Response.json(
						{ error: "Too many requests", retryAfter: 60 },
						{ status: 429 },
					);

				// Ask handoff: authoritative server-side copy of answers, prompt,
				// and questions so refresh, History navigation, and multi-device
				// access keep state. Survives tab close. Greenfield & existing modes.
				if (action === "save-handoff") {
					const parsed = askHandoffSchema.safeParse({
						...(typeof handoff === "object" && handoff !== null ? handoff : {}),
						projectId,
					});
					if (!parsed.success)
						return Response.json(
							{ error: "Handoff tidak valid" },
							{ status: 400 },
						);
					try {
						// Snapshot write-through: stamp the handoff with the snapshot
						// that is active at submit time for existing-codebase traceability.
						// A client-supplied snapshotId is never trusted blindly: it
						// must belong to this project or it is dropped in favor of
						// the server-resolved active snapshot.
						let activeSnapshotId: string | null = null;
						if (project.projectMode === "existing_codebase") {
							const candidate = parsed.data.snapshotId;
							if (candidate) {
								const { db: verifyDb } = await import("@/db");
								const { codebaseSnapshots } = await import("@/db/schema");
								const [owned] = await verifyDb
									.select({ id: codebaseSnapshots.id })
									.from(codebaseSnapshots)
									.where(
										and(
											eq(codebaseSnapshots.id, candidate),
											eq(codebaseSnapshots.projectId, projectId),
										),
									)
									.limit(1);
								if (owned) activeSnapshotId = owned.id;
							}
							activeSnapshotId ??=
								await resolveActiveSnapshotId(projectId);
						}
						await saveAskHandoff(user.id, {
							...parsed.data,
							...(activeSnapshotId ? { snapshotId: activeSnapshotId } : {}),
						});
					} catch (e) {
						console.error("ask handoff save failed:", e);
						return Response.json(
							{ error: "Gagal menyimpan handoff" },
							{ status: 500 },
						);
					}
					return Response.json({ saved: true });
				}
				if (action === "get-handoff") {
					let saved: Awaited<ReturnType<typeof getAskHandoff>> | null;
					try {
						saved = await getAskHandoff(projectId, user.id);
					} catch (e) {
						console.error("ask handoff read failed:", e);
						return Response.json(
							{ error: "Gagal memuat handoff" },
							{ status: 500 },
						);
					}
					if (!saved) {
						// Fallback for projects pre-dating handoff persistence:
						// synthesize minimal state using project name so Ask flow does not bounce.
						saved = {
							projectId,
							answers: [],
							state: {
								prompt: project.name,
								platform: "web",
								session: 1,
								questions: [],
							},
						};
					}
					return Response.json({ handoff: saved });
				}

				const projectLanguage = normalizeLanguage(reqLang || project.language);
				const platformLabel = platform === "mobile" ? "Mobile App" : "Web App";
				// Task 8 contextual questions: snapshot-bound context is appended
				// only for existing-codebase projects with ready analysis. Null
				// (greenfield) appends "" so the prompt stays byte-identical.
				let codebaseBlock = "";
				if (project.projectMode === "existing_codebase") {
					try {
						codebaseBlock = buildCodebasePromptBlock(
							await getProjectGenerationContext(projectId),
						);
					} catch (e) {
						console.warn("ask codebase context skipped:", e);
					}
				}
				const systemPrompt = `${ASK_OPTIONS_GENERATION_PROMPT}\n${getLanguageDirective(projectLanguage, "ask")}${codebaseBlock}`;
				const messages: Array<{
					role: "system" | "user" | "assistant";
					content: string;
				}> = [
					{ role: "system", content: systemPrompt },
					{
						role: "user",
						content: `Platform: ${platformLabel}\n\nPrompt awal:\n${prompt}`,
					},
				];

				const modelsToTry = selectModels();

				try {
					// ponytail: non-stream: payload is 5-7 short questions, progressive
					// reveal buys no UX here. Collect fully, then parse once.
					// 12000 (not 4000): every model here is reasoning:true (model-config.ts)
					// and reasoning tokens spend from the same maxOutputTokens budget before
					// any JSON content is emitted — 4000 left too little headroom and the
					// JSON got cut off mid-object on verbose reasoning runs.
					const { generator, firstChunk, abortController, outcome } =
						await tryStreamWithFallback(
							modelsToTry,
							messages,
							request.signal,
							12000,
						);
					// Bounded accumulation: abort the upstream generation if it
					// exceeds what the parser could ever need.
					const MAX_ASK_RESPONSE_CHARS = 200_000;
					let fullResponse = firstChunk;
					try {
						for await (const chunk of generator) {
							fullResponse += chunk;
							if (fullResponse.length > MAX_ASK_RESPONSE_CHARS) {
								abortController.abort();
								break;
							}
						}
					} catch (e) {
						if (e instanceof Error && e.name === "AbortError") {
							return Response.json(
								{ error: "Generasi pertanyaan dibatalkan." },
								{ status: 500 },
							);
						}
						throw e;
					}
					if (fullResponse.length > MAX_ASK_RESPONSE_CHARS) {
						return Response.json(
							{ error: "Respons AI melebihi batas. Coba lagi." },
							{ status: 500 },
						);
					}

					if (isTruncatedGeneration(fullResponse, outcome.finishReason)) {
						return Response.json(
							{
								error:
									"Generasi pertanyaan terputus di tengah jalan. Coba lagi.",
							},
							{ status: 500 },
						);
					}

					const questions = parseAskOptionsJson(
						extractJson(sanitizeModelOutput(fullResponse)),
					);
					if (!questions) {
						return Response.json(
							{ error: "AI menghasilkan JSON tidak valid. Coba lagi." },
							{ status: 500 },
						);
					}

					// Mark pre-artifact projects at question-stage server-side so
					// History routes them to /ask instead of the empty PRD page.
					// Guarded: only when no PRD version exists and the step has
					// not advanced past prd, so a concurrent or repeated Ask
					// call can never rewind an ac/task project. The UPDATE
					// predicate re-checks the step so a generation that
					// completes between the read and the write still wins.
					// ponytail: non-fatal - a failed marker write must not block the
					// questions the user just paid an AI call to generate.
					try {
						const [existing] = await db
							.select({ step: projects.step })
							.from(projects)
							.where(
								and(eq(projects.id, projectId), eq(projects.userId, user.id)),
							)
							.limit(1);
						const [prdRow] = await db
							.select({ id: prdVersions.id })
							.from(prdVersions)
							.where(eq(prdVersions.projectId, projectId))
							.limit(1);
						if (
							existing &&
							shouldMarkQuestionStep(existing.step, Boolean(prdRow))
						) {
							await db
								.update(projects)
								.set({ step: "question", updatedAt: new Date() })
								.where(
									and(
										eq(projects.id, projectId),
										eq(projects.userId, user.id),
										or(
											eq(projects.step, "question"),
											eq(projects.step, "prd"),
											isNull(projects.step),
										),
									),
								);
						}
					} catch (e) {
						console.error("ask step marker failed:", e);
					}

					return Response.json({ questions });
				} catch (err: unknown) {
					console.error("Ask options generate error:", err);
					return Response.json(
						{ error: sanitizeErrorForClient(err) },
						{ status: 500 },
					);
				}
			},
		},
	},
});
