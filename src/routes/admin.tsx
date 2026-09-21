import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AdminClient } from "@/components/admin/admin-client";
import { ForbiddenPage } from "@/components/ui/forbidden-page";
import { requireAdminServer } from "@/lib/session";

export const Route = createFileRoute("/admin")({
	beforeLoad: async () => {
		try {
			await requireAdminServer();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg === "Unauthorized") {
				throw redirect({ to: "/login" });
			}
			if (msg === "Forbidden") {
				if (typeof window === "undefined") {
					try {
						const { setResponseStatus } = await import(
							"@tanstack/react-start/server"
						);
						setResponseStatus(403);
					} catch {}
				}
				throw new Error("FORBIDDEN");
			}
			throw err;
		}
	},
	errorComponent: ({ error }) => {
		const msg = error instanceof Error ? error.message : String(error);
		if (msg === "FORBIDDEN" || msg === "Forbidden") {
			return <ForbiddenPage />;
		}
		return (
			<ForbiddenPage
				title="Terjadi Kesalahan"
				description="Gagal memuat halaman admin. Coba kembali ke workspace."
			/>
		);
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
