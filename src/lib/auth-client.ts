import { customSessionClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type { auth } from "@/lib/auth";

// Explicit public auth origin wins: assuming page origin === auth API
// origin misroutes credentials when the UI is served from a separate
// domain or behind a proxy. Same-origin default applies only in the
// browser (where the app and its API are served together); server-side
// rendering requires BETTER_AUTH_URL, falling back to localhost for dev.
function resolveAuthBaseUrl(): string {
	const configured = (process.env.NEXT_PUBLIC_AUTH_URL || "").trim();
	if (configured) return configured.replace(/\/+$/, "");
	if (typeof window !== "undefined") return window.location.origin;
	return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(
		/\/+$/,
		"",
	);
}

export const authClient = createAuthClient({
	baseURL: resolveAuthBaseUrl(),
	plugins: [customSessionClient<typeof auth>()],
});

export const { signIn, signOut, useSession } = authClient;
