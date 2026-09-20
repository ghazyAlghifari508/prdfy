import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { SettingsClient } from "@/components/settings/settings-client";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUserServer } from "@/lib/session";

// ponytail: server-only db logic - loader runs on client too, must not import db there.
const loadSettings = createServerFn({ method: "GET" }).handler(async () => {
	const user = await requireUserServer();
	const [profile] = await db
		.select({ id: users.id, name: users.name, email: users.email, image: users.image })
		.from(users)
		.where(eq(users.id, user.id))
		.limit(1);
	return { profile };
});

export const Route = createFileRoute("/settings")({
	loader: async () => {
		try {
			return await loadSettings();
		} catch (e) {
			if (e instanceof Error && e.message === "Unauthorized")
				throw redirect({ to: "/login" });
			throw e;
		}
	},
	component: SettingsLayout,
});

function SettingsLayout() {
	const { profile } = Route.useLoaderData();
	return (
		<SettingsClient profile={profile}>
			<Outlet />
		</SettingsClient>
	);
}
