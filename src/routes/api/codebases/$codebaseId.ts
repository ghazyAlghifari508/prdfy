import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { codebases, projects } from "@/db/schema";
import { deletionTimestamp } from "@/lib/project-deletion";
import { requireUser } from "@/lib/session";
import { purgeProjectArtifacts } from "@/routes/api/projects/$id";

export function decideCodebaseDeletion(input: {
	featureCount: number;
	confirm?: boolean;
}): { allow: true } | { allow: false; code: "CODEBASE_HAS_FEATURES" } {
	if (input.featureCount > 0 && input.confirm !== true) {
		return { allow: false, code: "CODEBASE_HAS_FEATURES" };
	}
	return { allow: true };
}

export const Route = createFileRoute("/api/codebases/$codebaseId")({
	server: {
		handlers: {
			DELETE: async ({
				request,
				params,
			}: {
				request: Request;
				params: { codebaseId: string };
			}) => {
				let user: { id: string };
				try {
					user = await requireUser(request.headers);
				} catch {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}

				const { codebaseId } = params;
				if (!codebaseId) {
					return Response.json(
						{ error: "Codebase ID is required", code: "CODEBASE_NOT_FOUND" },
						{ status: 400 },
					);
				}

				const body = (await request.json().catch(() => ({}))) as {
					confirm?: boolean;
				};

				try {
					const result = await db.transaction(async (tx) => {
						const [ownCodebase] = await tx
							.select({ id: codebases.id })
							.from(codebases)
							.where(
								and(
									eq(codebases.id, codebaseId),
									eq(codebases.userId, user.id),
								),
							)
							.limit(1)
							.for("update");

						if (!ownCodebase) return { kind: "not_found" as const };

						const activeProjects = await tx
							.select({ id: projects.id })
							.from(projects)
							.where(
								and(
									eq(projects.codebaseId, codebaseId),
									eq(projects.userId, user.id),
									isNull(projects.deletedAt),
								),
							);

						const decision = decideCodebaseDeletion({
							featureCount: activeProjects.length,
							confirm: body.confirm,
						});

						if (!decision.allow) {
							return {
								kind: "conflict" as const,
								featureCount: activeProjects.length,
							};
						}

						// Clean up each feature project: purge user-facing artifacts and
						// tombstone the project row (with codebaseId set to null so the
						// subsequent codebase deletion FK cascade doesn't touch retained
						// project accounting rows).
						for (const proj of activeProjects) {
							await purgeProjectArtifacts(tx, proj.id);
							await tx
								.update(projects)
								.set({
									deletedAt: deletionTimestamp(),
									shareToken: null,
									lastUrl: null,
									codebaseId: null,
									updatedAt: deletionTimestamp(),
								})
								.where(
									and(
										eq(projects.id, proj.id),
										eq(projects.userId, user.id),
										isNull(projects.deletedAt),
									),
								);
						}

						// Unlink any remaining projects (including previously tombstoned
						// ones) so the codebase deletion cascade does not attempt to
						// destroy retained accounting rows.
						await tx
							.update(projects)
							.set({ codebaseId: null })
							.where(
								and(
									eq(projects.codebaseId, codebaseId),
									eq(projects.userId, user.id),
								),
							);

						// Delete the codebase row. Sessions, snapshots, files, idempotency
						// keys, and analyses cascade via the FKs added in Task 1.
						await tx
							.delete(codebases)
							.where(
								and(
									eq(codebases.id, codebaseId),
									eq(codebases.userId, user.id),
								),
							);

						return { kind: "deleted" as const };
					});

					if (result.kind === "not_found") {
						return Response.json(
							{ error: "Codebase tidak ditemukan", code: "CODEBASE_NOT_FOUND" },
							{ status: 404 },
						);
					}

					if (result.kind === "conflict") {
						return Response.json(
							{
								error: `Codebase memiliki ${result.featureCount} fitur aktif. Konfirmasi penghapusan diperlukan.`,
								code: "CODEBASE_HAS_FEATURES",
								featureCount: result.featureCount,
							},
							{ status: 409 },
						);
					}

					return Response.json({ success: true, deleted: true });
				} catch (error) {
					console.error(
						`[codebases/delete] failed for codebase ${codebaseId} (user ${user.id}):`,
						error,
					);
					return Response.json(
						{
							error: "Gagal menghapus codebase.",
							code: "CODEBASE_DELETE_FAILED",
						},
						{ status: 500 },
					);
				}
			},
		},
	},
});
