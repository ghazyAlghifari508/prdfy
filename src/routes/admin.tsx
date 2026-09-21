import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AdminClient } from "@/components/admin/admin-client";
import { requireAdminServer } from "@/lib/session";

export const Route = createFileRoute("/admin")({
	beforeLoad: async () => {
		try {
			await requireAdminServer();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg === "Unauthorized" || msg === "Forbidden") {
				throw redirect({ to: "/login" });
			}
			throw err;
		}
	},
	component: AdminLayout,
});

function AdminLayout() {
	return (
		<AdminClient>
			<Outlet />
		</AdminClient>
	);
}
