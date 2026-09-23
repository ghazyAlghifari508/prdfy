import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/codebases")({
	component: () => <Outlet />,
});
