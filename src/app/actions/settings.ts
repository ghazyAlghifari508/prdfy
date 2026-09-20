/**
 * Account/profile settings - ported to TanStack server fns.
 *
 * Schema/stack forks from the old InsForge version:
 * - users has `image` (Better Auth), not `avatar_url`; `fullName`/`role` app-owned.
 * - email/password are Better Auth-owned → go through auth.api, not raw DB writes.
 * - deleteAccount cascades manually (schema FKs have no ON DELETE CASCADE yet).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/session";

const _updateProfile = createServerFn({ method: "POST" })
	.validator((d: { fullName: string; role: string }) => d)
	.handler(async ({ data }) => {
		const user = await requireUser(getRequestHeaders());
		const { parseProfileUpdate } = await import("@/lib/profile");
		const clean = parseProfileUpdate(data);
		const { db } = await import("@/db");
		const { users } = await import("@/db/schema");
		await db
			.update(users)
			.set({ fullName: clean.fullName, role: clean.role, updatedAt: new Date() })
			.where(eq(users.id, user.id));
	});

export async function updateProfile(formData: FormData) {
	await _updateProfile({
		data: {
			fullName: (formData.get("full_name") as string) ?? "",
			role: (formData.get("role") as string) ?? "",
		},
	});
}

const _deleteAccount = createServerFn({ method: "POST" })
	.validator((confirm: string) => {
		if (confirm !== "HAPUS")
			throw new Error("Konfirmasi penghapusan tidak valid.");
		return confirm;
	})
	.handler(async () => {
		const user = await requireUser(getRequestHeaders());
		const { db } = await import("@/db");
	const {
		acVersions,
		apiKeys,
		conversations,
		creditLedgerEntries,
		creditOperations,
		errorReports,
		feedback,
		messages,
		notificationPreferences,
		payments,
		prdVersions,
		projects,
		quotas,
		rateLimits,
		subscriptions,
		tasks,
		users,
	} = await import("@/db/schema");
		const { auth } = await import("@/lib/auth");

	// One transaction: any failure rolls everything back instead of
	// leaving a partially deleted account. FK-safe order: leaf rows
	// first (ledger→operations: composite FKs without cascade block
	// their parents), user row last. Tables with ON DELETE CASCADE
	// (sessions, accounts, codebase rows) follow automatically.
	await db.transaction(async (tx) => {
		await tx
			.delete(notificationPreferences)
			.where(eq(notificationPreferences.userId, user.id));
		await tx.delete(rateLimits).where(eq(rateLimits.userId, user.id));
		await tx.delete(apiKeys).where(eq(apiKeys.userId, user.id));
		await tx.delete(feedback).where(eq(feedback.userId, user.id));
		await tx.delete(errorReports).where(eq(errorReports.userId, user.id));

		const opRows = await tx
			.select({ id: creditOperations.id })
			.from(creditOperations)
			.where(eq(creditOperations.userId, user.id));
		const opIds = opRows.map((o) => o.id);
		if (opIds.length > 0) {
			await tx
				.delete(creditLedgerEntries)
				.where(inArray(creditLedgerEntries.operationId, opIds));
		}
		await tx
			.delete(creditOperations)
			.where(eq(creditOperations.userId, user.id));

		const userProjects = await tx
			.select({ id: projects.id })
			.from(projects)
			.where(eq(projects.userId, user.id));
		const projectIds = userProjects.map((p) => p.id);
		const convRows = await tx
			.select({ id: conversations.id })
			.from(conversations)
			.where(eq(conversations.userId, user.id));
		const convIds = convRows.map((c) => c.id);
		if (convIds.length > 0) {
			await tx
				.delete(messages)
				.where(inArray(messages.conversationId, convIds));
		}
		if (projectIds.length > 0) {
			await tx
				.delete(conversations)
				.where(inArray(conversations.projectId, projectIds));
			await tx
				.delete(prdVersions)
				.where(inArray(prdVersions.projectId, projectIds));
			await tx
				.delete(acVersions)
				.where(inArray(acVersions.projectId, projectIds));
			await tx.delete(tasks).where(inArray(tasks.projectId, projectIds));
		}
		await tx
			.delete(conversations)
			.where(eq(conversations.userId, user.id));
		await tx.delete(projects).where(eq(projects.userId, user.id));
		await tx.delete(payments).where(eq(payments.userId, user.id));
		await tx.delete(subscriptions).where(eq(subscriptions.userId, user.id));
		await tx.delete(quotas).where(eq(quotas.userId, user.id));
		await tx.delete(users).where(eq(users.id, user.id));
	});

	try {
		await auth.api.signOut({ headers: getRequestHeaders() });
	} catch (e) {
		// The user row is already gone, so the session is dead regardless.
		console.error("Sign out after account deletion failed:", e);
	}
	});

export async function deleteAccount(formData: FormData) {
	await _deleteAccount({ data: (formData.get("confirm") as string) ?? "" });
	window.location.assign("/");
}

export async function uploadAvatar(_formData: FormData) {
	// ponytail: old InsForge storage bucket has no replacement in the self-hosted
	// stack yet. Wire an object store (S3/local) + users.image update when ready.
	throw new Error("Upload avatar belum tersedia.");
}
