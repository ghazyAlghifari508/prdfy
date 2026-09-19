import { createFileRoute } from "@tanstack/react-router";
import { db } from "@/db";
import { codebaseSyncSessions, projects } from "@/db/schema";
import { saveAskHandoff } from "@/lib/codebase-generation-context";
import {
	buildSyncCommand,
	type ExistingCodebaseProjectMode,
	existingCodebaseProjectModeSchema,
	type SyncPromptPayload,
} from "@/lib/codebase-sync";
import { generateSyncToken, hashSyncToken } from "@/lib/codebase-sync.server";
import {
	CODEBASE_CLI_MIN_VERSION,
	CODEBASE_SYNC_SESSION_EXPIRY_MS,
} from "@/lib/constants";
import { normalizeLanguage } from "@/lib/language";
import { deriveProjectNameSync } from "@/lib/services/prd-service";
import { requireUser } from "@/lib/session";

// Project mode validation for Home creation. A missing mode defaults to
// greenfield so legacy clients keep byte-identical behavior; any other
// non-member value is rejected (unit-tested in ./-project-mode.test.ts).
export function parseProjectModeInput(
	value: unknown,
): ExistingCodebaseProjectMode {
	if (value === undefined || value === null) return "greenfield";
	const parsed = existingCodebaseProjectModeSchema.safeParse(value);
	if (!parsed.success) throw new Error("INVALID_PROJECT_MODE");
	return parsed.data;
}

export const Route = createFileRoute("/api/projects/")({
	server: {
		handlers: {
			POST: async ({ request }: { request: Request }) => {
				let user: { id: string };
				try {
					user = await requireUser(request.headers);
				} catch {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}
				const body = await request.json().catch(() => null);
				const message = body?.message;
				const language = normalizeLanguage(body?.language);

				if (!message || typeof message !== "string" || message.length < 3) {
					return Response.json(
						{ error: "Prompt harus diisi minimal 3 karakter" },
						{ status: 400 },
					);
				}

				let projectMode: ExistingCodebaseProjectMode;
				try {
					projectMode = parseProjectModeInput(body?.projectMode);
				} catch {
					return Response.json(
						{ error: "Mode proyek tidak valid" },
						{ status: 400 },
					);
				}

				const id = crypto.randomUUID();
				// ponytail: sync regex-only name, skip AI call. chat.ts calls
				// deriveProjectName (with AI) again inside the SSE stream, so the
				// final name is AI-quality — user never sees the rough one.
				const projectName = deriveProjectNameSync(message);
				const platform =
					body?.platform === "mobile" ||
					(typeof message === "string" &&
						message.includes("[Platform: Mobile App]"))
						? "mobile"
						: "web";

				const initHandoff = async (projId: string) => {
					try {
						await saveAskHandoff(user.id, {
							projectId: projId,
							answers: [],
							state: {
								prompt: message,
								platform,
								session: 1,
								questions: [],
							},
						});
					} catch (e) {
						console.error("Failed to initialize ask handoff:", e);
					}
				};

				if (projectMode === "greenfield") {
					const [project] = await db
						.insert(projects)
						.values({
							id,
							userId: user.id,
							name: projectName,
							status: "draft",
							mode: "ai_auto",
							projectMode,
							language,
						})
						.returning({ id: projects.id, name: projects.name });

					if (!project)
						return Response.json(
							{ error: "Gagal membuat project" },
							{ status: 500 },
						);
					await initHandoff(project.id);
					return Response.json({
						id: project.id,
						name: project.name,
						projectMode,
					});
				}

				// Existing-codebase: the project and its first short-lived sync
				// session are created atomically. The raw credential is returned
				// once inside the sync payload; only its hash is persisted.
				const rawCredential = generateSyncToken();
				const expiresAt = new Date(
					Date.now() + CODEBASE_SYNC_SESSION_EXPIRY_MS,
				);
				const created = await db.transaction(async (tx) => {
					const [project] = await tx
						.insert(projects)
						.values({
							id,
							userId: user.id,
							name: projectName,
							status: "draft",
							mode: "ai_auto",
							projectMode,
							language,
						})
						.returning({ id: projects.id, name: projects.name });
					if (!project) return null;
					const [session] = await tx
						.insert(codebaseSyncSessions)
						.values({
							id: crypto.randomUUID(),
							projectId: id,
							userId: user.id,
							credentialHash: hashSyncToken(rawCredential),
							status: "waiting_for_cli",
							expiresAt,
							cliMinVersion: CODEBASE_CLI_MIN_VERSION,
							attempt: 1,
						})
						.returning({
							expiresAt: codebaseSyncSessions.expiresAt,
							cliMinVersion: codebaseSyncSessions.cliMinVersion,
						});
					if (!session) return null;
					return { project, session };
				});

				if (!created)
					return Response.json(
						{ error: "Gagal membuat project" },
						{ status: 500 },
					);
				await initHandoff(created.project.id);
				const sync: SyncPromptPayload = {
					projectId: id,
					apiBaseUrl: new URL(request.url).origin,
					syncToken: rawCredential,
					cliMinVersion: created.session.cliMinVersion,
					syncCommand: buildSyncCommand(id),
					expiresAt: created.session.expiresAt.toISOString(),
				};
				return Response.json({
					id: created.project.id,
					name: created.project.name,
					projectMode,
					sync,
				});
			},
		},
	},
});
