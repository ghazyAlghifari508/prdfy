/**
 * Chat DB ops - Drizzle. New schema: conversations(project_id, user_id),
 * messages(conversation_id, role, content, metadata jsonb).
 *
 * ponytail: projects has no `preferences` col → ensureConversation ignores the
 * preferences arg (mode derived from presence, but not persisted).
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, projects } from "@/db/schema";

export interface ConversationMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

const MAX_HISTORY_LIMIT = 100;

export async function getConversationHistory(
	conversationId: string,
	userId: string,
	limit = 20,
): Promise<{ messages: ConversationMessage[]; valid: boolean }> {
	// Clamp caller-controlled limits; newest-first then reversed so long
	// conversations keep the latest turns instead of the oldest ones.
	const take = Number.isSafeInteger(limit)
		? Math.min(Math.max(limit, 1), MAX_HISTORY_LIMIT)
		: 20;
	const [conv] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(
			and(
				eq(conversations.id, conversationId),
				eq(conversations.userId, userId),
			),
		)
		.limit(1);
	if (!conv) return { messages: [], valid: false };

	const rows = await db
		.select({ role: messages.role, content: messages.content })
		.from(messages)
		.where(eq(messages.conversationId, conversationId))
		.orderBy(desc(messages.createdAt))
		.limit(take);
	rows.reverse();

	return {
		valid: true,
		messages: rows.map((m) => ({
			role: m.role as ConversationMessage["role"],
			content: m.content,
		})),
	};
}

/** Thrown when a supplied projectId is not owned by the caller. */
export class ConversationProjectOwnershipError extends Error {
	readonly code = "CONVERSATION_PROJECT_FORBIDDEN" as const;

	constructor() {
		super("Conversation project ownership mismatch");
		this.name = "ConversationProjectOwnershipError";
	}
}

export async function ensureConversation(
	userId: string,
	projectId: string | undefined,
	projectName: string,
	preferences: Record<string, unknown> | null,
): Promise<{
	conversationId: string;
	projectId: string;
	createdConversationId?: string;
	createdProjectId?: string;
}> {
	const newConversationId = crypto.randomUUID();
	return db.transaction(async (tx) => {
		let projectIdToUse = projectId;
		let createdProjectId: string | undefined;

		if (projectIdToUse) {
			// Ownership gate BEFORE any insert: a foreign/stale projectId must
			// never create an orphan conversation in another tenant.
			const [owned] = await tx
				.select({ id: projects.id })
				.from(projects)
				.where(
					and(eq(projects.id, projectIdToUse), eq(projects.userId, userId)),
				)
				.limit(1);
			if (!owned) throw new ConversationProjectOwnershipError();
		} else {
			const [newProject] = await tx
				.insert(projects)
				.values({
					id: crypto.randomUUID(),
					userId,
					name: projectName,
					status: "draft",
					mode: preferences ? "manual" : "ai_auto",
				})
				.returning({ id: projects.id });
			if (!newProject?.id) throw new Error("Failed to create project");
			projectIdToUse = newProject.id;
			createdProjectId = newProject.id;
		}

		const [newConv] = await tx
			.insert(conversations)
			.values({ id: newConversationId, userId, projectId: projectIdToUse })
			.returning({ id: conversations.id });
		if (!newConv?.id) throw new Error("Failed to create conversation");

		return {
			conversationId: newConv.id,
			projectId: projectIdToUse,
			createdConversationId: newConv.id,
			createdProjectId,
		};
	});
}

export async function saveMessages(
	conversationId: string,
	userMessage: string,
	assistantReply: string,
	modelId?: string,
): Promise<void> {
	await db.insert(messages).values([
		{
			id: crypto.randomUUID(),
			conversationId,
			role: "user",
			content: userMessage,
			metadata: {},
		},
		{
			id: crypto.randomUUID(),
			conversationId,
			role: "assistant",
			content: assistantReply,
			metadata: modelId ? { model: modelId } : {},
		},
	]);
}

export async function rollbackStreamInserts(
	userId: string,
	createdConversationId?: string,
	createdProjectId?: string,
): Promise<void> {
	if (createdConversationId) {
		await db
			.delete(conversations)
			.where(
				and(
					eq(conversations.id, createdConversationId),
					eq(conversations.userId, userId),
				),
			);
	}
	if (createdProjectId) {
		await db
			.delete(projects)
			.where(
				and(eq(projects.id, createdProjectId), eq(projects.userId, userId)),
			);
	}
}
