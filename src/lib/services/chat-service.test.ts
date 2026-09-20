import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("ensureConversation contract", () => {
	it("verifies project ownership inside the transaction before inserting a conversation", async () => {
		const source = await readFile(
			new URL("./chat-service.ts", import.meta.url),
			"utf8",
		);
		const body = source.slice(
			source.indexOf("export async function ensureConversation"),
			source.indexOf("export async function saveMessages"),
		);

		const transactionIndex = body.indexOf("db.transaction");
		const ownershipIndex = body.indexOf("eq(projects.userId, userId)");
		const throwIndex = body.indexOf(
			"throw new ConversationProjectOwnershipError()",
		);
		const insertConvIndex = body.indexOf("insert(conversations)");

		expect(transactionIndex).toBeGreaterThan(-1);
		// A supplied projectId must be ownership-checked before ANY insert,
		// so a foreign id can never create an orphan conversation.
		expect(ownershipIndex).toBeGreaterThan(transactionIndex);
		expect(throwIndex).toBeGreaterThan(ownershipIndex);
		expect(insertConvIndex).toBeGreaterThan(throwIndex);
	});
});

describe("chat route contract", () => {
	it("maps ownership failures on the eager generate path to 403", async () => {
		const source = await readFile(
			new URL("../../routes/api/chat.ts", import.meta.url),
			"utf8",
		);
		const errorIndex = source.indexOf(
			"error instanceof ConversationProjectOwnershipError",
		);
		const forbiddenIndex = source.indexOf(
			'"Project not found or unauthorized"',
			errorIndex,
		);

		expect(errorIndex).toBeGreaterThan(-1);
		expect(forbiddenIndex).toBeGreaterThan(errorIndex);
	});
});
