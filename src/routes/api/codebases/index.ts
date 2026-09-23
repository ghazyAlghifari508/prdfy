import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, inArray } from "drizzle-orm";
// Server-import exception: top-level `@/db`, schema, and `.server` imports
// are correct here — server handlers only, no client component (neighboring
// `/api/codebases` pattern). Never import this module from client code.
import { db } from "@/db";
import {
	codebaseSnapshots,
	codebaseSyncSessions,
	codebases,
} from "@/db/schema";
import { buildSyncCommand, type SyncPromptPayload } from "@/lib/codebase-sync";
import { generateSyncToken, hashSyncToken } from "@/lib/codebase-sync.server";
import {
	CODEBASE_CLI_MIN_VERSION,
	CODEBASE_SYNC_SESSION_EXPIRY_MS,
} from "@/lib/constants";
import { deriveProjectNameSync } from "@/lib/services/prd-service";
import { requireUser } from "@/lib/session";

export const Route = createFileRoute("/api/codebases/")({
	server: {
		handlers: {
			// Browser list: codebases owned by the caller with their latest
			// snapshot. No project join — ownership flows via codebases.userId.
			GET: async ({ request }: { request: Request }) => {
				let user: { id: string };
				try {
					user = await requireUser(request.headers);
				} catch {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}

				const rows = await db
					.select({
						id: codebases.id,
						name: codebases.name,
						createdAt: codebases.createdAt,
					})
					.from(codebases)
					.where(eq(codebases.userId, user.id))
					.orderBy(desc(codebases.updatedAt));

				const ids = rows.map((row) => row.id);
				const snapshotRows =
					ids.length === 0
						? []
						: await db
								.select({
									id: codebaseSnapshots.id,
									codebaseId: codebaseSnapshots.codebaseId,
									createdAt: codebaseSnapshots.createdAt,
									commitSha: codebaseSnapshots.commitSha,
									fileCount: codebaseSnapshots.fileCount,
								})
								.from(codebaseSnapshots)
								.innerJoin(
									codebases,
									eq(codebaseSnapshots.codebaseId, codebases.id),
								)
								.where(
									and(
										inArray(codebaseSnapshots.codebaseId, ids),
										eq(codebases.userId, user.id),
									),
								)
								.orderBy(desc(codebaseSnapshots.createdAt));

				const latestByCodebase = new Map<
					string,
					{
						id: string;
						createdAt: string | null;
						commitSha: string | null;
						fileCount: number;
					}
				>();
				for (const snapshot of snapshotRows) {
					if (!snapshot.codebaseId) continue;
					if (latestByCodebase.has(snapshot.codebaseId)) continue;
					latestByCodebase.set(snapshot.codebaseId, {
						id: snapshot.id,
						createdAt: snapshot.createdAt?.toISOString() ?? null,
						commitSha: snapshot.commitSha,
						fileCount: snapshot.fileCount,
					});
				}

				return Response.json({
					codebases: rows.map((row) => ({
						id: row.id,
						name: row.name,
						createdAt: row.createdAt?.toISOString() ?? null,
						latestSnapshot: latestByCodebase.get(row.id) ?? null,
					})),
				});
			},

			// Browser create: the codebase and its first short-lived sync
			// session are created atomically. The raw credential is returned
			// once inside the sync payload; only its hash is persisted.
			// Accepts either an explicit `name` (codebase list input) or a
			// `message` (Home composer input, name derived the same way the
			// project branch derives it).
			POST: async ({ request }: { request: Request }) => {
				let user: { id: string };
				try {
					user = await requireUser(request.headers);
				} catch {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}
				const body = (await request.json().catch(() => null)) as {
					name?: unknown;
					message?: unknown;
				} | null;
				const rawName = typeof body?.name === "string" ? body.name.trim() : "";
				const rawMessage =
					typeof body?.message === "string" ? body.message : "";

				let codebaseName = rawName;
				if (!codebaseName) {
					if (!rawMessage || rawMessage.length < 3) {
						return Response.json(
							{ error: "Nama codebase harus diisi minimal 3 karakter" },
							{ status: 400 },
						);
					}
					codebaseName = deriveProjectNameSync(rawMessage);
				}
				if (!codebaseName) {
					return Response.json(
						{ error: "Nama codebase harus diisi minimal 3 karakter" },
						{ status: 400 },
					);
				}

				const id = crypto.randomUUID();
				const rawCredential = generateSyncToken();
				const expiresAt = new Date(
					Date.now() + CODEBASE_SYNC_SESSION_EXPIRY_MS,
				);
				const created = await db.transaction(async (tx) => {
					const [codebase] = await tx
						.insert(codebases)
						.values({
							id,
							userId: user.id,
							name: codebaseName,
						})
						.returning({ id: codebases.id, name: codebases.name });
					if (!codebase) return null;
					const [session] = await tx
						.insert(codebaseSyncSessions)
						.values({
							id: crypto.randomUUID(),
							codebaseId: id,
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
					return { codebase, session };
				});

				if (!created)
					return Response.json(
						{ error: "Gagal membuat codebase" },
						{ status: 500 },
					);
				const sync: SyncPromptPayload = {
					projectId: id,
					apiBaseUrl: new URL(request.url).origin,
					syncToken: rawCredential,
					cliMinVersion: created.session.cliMinVersion,
					syncCommand: buildSyncCommand(id),
					expiresAt: created.session.expiresAt.toISOString(),
				};
				return Response.json({
					id: created.codebase.id,
					name: created.codebase.name,
					sync,
				});
			},
		},
	},
});
