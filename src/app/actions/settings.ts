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
			conversations,
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

		await db
			.delete(notificationPreferences)
			.where(eq(notificationPreferences.userId, user.id));
		await db.delete(rateLimits).where(eq(rateLimits.userId, user.id));

		const userProjects = await db
			.select({ id: projects.id })
			.from(projects)
			.where(eq(projects.userId, user.id));
		const projectIds = userProjects.map((p) => p.id);
		if (projectIds.length > 0) {
			const convRows = await db
				.select({ id: conversations.id })
				.from(conversations)
				.where(inArray(conversations.projectId, projectIds));
			const convIds = convRows.map((c) => c.id);
			if (convIds.length > 0) {
				await db
					.delete(messages)
					.where(inArray(messages.conversationId, convIds));
			}
			await db
				.delete(conversations)
				.where(inArray(conversations.projectId, projectIds));
			await db
				.delete(prdVersions)
				.where(inArray(prdVersions.projectId, projectIds));
			await db
				.delete(acVersions)
				.where(inArray(acVersions.projectId, projectIds));
			await db.delete(tasks).where(inArray(tasks.projectId, projectIds));
		}
		await db.delete(projects).where(eq(projects.userId, user.id));
		await db.delete(payments).where(eq(payments.userId, user.id));
		await db.delete(subscriptions).where(eq(subscriptions.userId, user.id));
		await db.delete(quotas).where(eq(quotas.userId, user.id));

		await auth.api.signOut({ headers: getRequestHeaders() });
		await db.delete(users).where(eq(users.id, user.id));
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
