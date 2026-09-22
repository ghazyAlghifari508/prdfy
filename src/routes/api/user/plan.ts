import { createFileRoute } from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getCreditBalance } from "@/lib/credits";
import { getSessionFromHeaders } from "@/lib/session";

export const Route = createFileRoute("/api/user/plan")({
	server: {
		handlers: {
			GET: async () => {
				const session = await getSessionFromHeaders(getRequestHeaders());
				if (!session?.user)
					return Response.json({
						authenticated: false,
						plan: "free",
						credits: 0,
						creditsUsed: 0,
						remaining: 0,
						subscriptionState: "free_active",
						currentPeriodEnd: null,
						topUpEligible: false,
						creditsExhausted: false,
					});

				const balance = await getCreditBalance(session.user.id);
				return Response.json({ authenticated: true, ...balance });
			},
		},
	},
});
