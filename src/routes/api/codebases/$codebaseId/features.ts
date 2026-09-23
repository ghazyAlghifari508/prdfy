import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
	codebaseSnapshots,
	codebases,
	projects,
	subscriptions,
} from "@/db/schema";
import { saveAskHandoff } from "@/lib/codebase-generation-context";
import {
	CODEBASE_SYNC_RATE_LIMIT_ACTION,
	SNAPSHOT_CONTEXT_STATUSES,
} from "@/lib/codebase-sync";
import { normalizeLanguage } from "@/lib/language";
import { checkRateLimit } from "@/lib/rate-limit";
import { deriveProjectNameSync } from "@/lib/services/prd-service";
import { requireUser } from "@/lib/session";
import type { Plan } from "@/types/database";

export function buildFeatureProjectValues(input: {
	id: string;
	userId: string;
	name: string;
	codebaseId: string;
	language: string;
}): typeof projects.$inferInsert {
	return {
		id: input.id,
		userId: input.userId,
		name: input.name,
		status: "draft",
		mode: "ai_auto",
		projectMode: "existing_codebase",
		codebaseId: input.codebaseId,
		language: input.language,
	};
}

export function resolveAnalysisFeaturePrompt(input: {
	handoffPrompt: string | null | undefined;
	projectName: string;
	projectId: string;
}): string {
	const prompt = input.handoffPrompt?.trim();
	if (prompt) return prompt;
	const name = input.projectName.trim();
	return name || input.projectId;
}

function resolvePlan(rawPlan: string | undefined): Plan {
	if (rawPlan === "pro" || rawPlan === "hengker") return rawPlan;
	return "free";
}

export const Route = createFileRoute("/api/codebases/$codebaseId/features")({
	server: {
		handlers: {
			POST: async ({
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

				const [subscription] = await db
					.select({ plan: subscriptions.plan })
					.from(subscriptions)
					.where(eq(subscriptions.userId, user.id))
					.orderBy(desc(subscriptions.createdAt))
					.limit(1);
				const rateCheck = await checkRateLimit(
					user.id,
					resolvePlan(subscription?.plan),
					CODEBASE_SYNC_RATE_LIMIT_ACTION,
				);
				if (!rateCheck.allowed) {
					return Response.json(
						{ error: "Terlalu banyak permintaan", retryAfter: 60 },
						{ status: 429 },
					);
				}

				const [codebase] = await db
					.select({ id: codebases.id })
					.from(codebases)
					.where(
						and(
							eq(codebases.id, params.codebaseId),
							eq(codebases.userId, user.id),
						),
					)
					.limit(1);
				if (!codebase) {
					return Response.json(
						{ error: "Codebase tidak ditemukan" },
						{ status: 404 },
					);
				}

				const [snapshot] = await db
					.select({ id: codebaseSnapshots.id })
					.from(codebaseSnapshots)
					.where(
						and(
							eq(codebaseSnapshots.codebaseId, codebase.id),
							inArray(codebaseSnapshots.status, [...SNAPSHOT_CONTEXT_STATUSES]),
						),
					)
					.limit(1);
				if (!snapshot) {
					return Response.json(
						{
							error: "Codebase belum selesai disinkronkan",
							code: "CODEBASE_NOT_SYNCED",
						},
						{ status: 400 },
					);
				}

				const body: unknown = await request.json().catch(() => null);
				const message =
					typeof body === "object" && body !== null && "message" in body
						? body.message
						: undefined;
				if (typeof message !== "string" || message.length < 3) {
					return Response.json(
						{ error: "Prompt harus diisi minimal 3 karakter" },
						{ status: 400 },
					);
				}
				const language =
					typeof body === "object" && body !== null && "language" in body
						? normalizeLanguage(body.language)
						: normalizeLanguage(undefined);
				const name = deriveProjectNameSync(message);
				const id = crypto.randomUUID();
				const [project] = await db.transaction((tx) =>
					tx
						.insert(projects)
						.values(
							buildFeatureProjectValues({
								id,
								userId: user.id,
								name,
								codebaseId: codebase.id,
								language,
							}),
						)
						.returning({ id: projects.id, name: projects.name }),
				);
				if (!project) {
					return Response.json(
						{ error: "Gagal membuat project" },
						{ status: 500 },
					);
				}

				await saveAskHandoff(user.id, {
					projectId: project.id,
					answers: [],
					snapshotId: snapshot.id,
					state: {
						prompt: message,
						session: 1,
						questions: [],
					},
				});
				return Response.json({ projectId: project.id, name: project.name });
			},
		},
	},
});
