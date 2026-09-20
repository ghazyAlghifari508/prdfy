import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { ProfileForm } from "@/components/settings/profile-form";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUserServer } from "@/lib/session";

// ponytail: server-only db logic - loader runs on client too, must not import db there.
const loadProfile = createServerFn({ method: "GET" }).handler(async () => {
	const user = await requireUserServer();
	const [profile] = await db
		.select({ fullName: users.fullName, image: users.image, role: users.role })
		.from(users)
		.where(eq(users.id, user.id))
		.limit(1);
	return { profile, email: user.email };
});

export const Route = createFileRoute("/settings/profile")({
	loader: async () => {
		try {
			return await loadProfile();
		} catch (e) {
			if (e instanceof Error && e.message === "Unauthorized")
				throw redirect({ to: "/login" });
			throw e;
		}
	},
	component: ProfilePage,
});

function ProfilePage() {
	const { profile, email } = Route.useLoaderData();
	return (
		<div
			className="rounded-xl border border-[var(--border-subtle)] p-6"
			style={{ background: "var(--bg-elevated)" }}
		>
			<h2
				className="mb-6 font-inter font-[510] text-xl font-bold"
				style={{ color: "var(--text-primary)" }}
			>
				Edit Profil
			</h2>
			<ProfileForm
				profile={{
					full_name: profile?.fullName ?? null,
					avatar_url: profile?.image ?? null,
					email,
					role: profile?.role ?? null,
				}}
			/>
		</div>
	);
}
