import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "@/db";
import {
	accounts,
	sessions,
	subscriptions,
	users,
	verifications,
} from "@/db/schema";
import { PLAN_CREDITS } from "@/types/database";

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "pg",
		usePlural: true,
		schema: {
			users,
			sessions,
			accounts,
			verifications,
		},
	}),
	databaseHooks: {
		user: {
			create: {
				after: async (user) => {
					const { addDays } = await import("@/lib/billing");
					const { ADAPTIVE_CREDIT_PRICING, BILLING_PERIOD_DAYS } = await import(
						"@/lib/constants"
					);
					const { creditLedgerEntries } = await import("@/db/schema");
					const now = new Date();
					const subId = crypto.randomUUID();
					await db.insert(subscriptions).values({
						id: subId,
						userId: user.id,
						plan: "free",
						status: "active",
						credits: PLAN_CREDITS.free,
						creditsUsed: 0,
						creditsReserved: 0,
						currentPeriodStart: now,
						currentPeriodEnd: addDays(now, BILLING_PERIOD_DAYS),
						reminderCount: 0,
					});
					await db.insert(creditLedgerEntries).values({
						id: crypto.randomUUID(),
						userId: user.id,
						operationId: null,
						amount: PLAN_CREDITS.free,
						entryType: "grant",
						sourceCategory: "system_grant",
						pricingVersion: ADAPTIVE_CREDIT_PRICING.version,
						metadata: {
							reason: "initial_signup_grant",
						},
					});
				},
			},
		},
		session: {
			create: {
				after: async (session: { userId?: string; user?: { id?: string } }) => {
					try {
						const adminEmails = (process.env.ADMIN_EMAILS ?? "")
							.split(",")
							.map((e) => e.trim().toLowerCase())
							.filter(Boolean);
						if (adminEmails.length === 0) return;

						const userId = session?.userId || session?.user?.id;
						if (!userId) return;

						const { db } = await import("@/db");
						const { users } = await import("@/db/schema");
						const { eq } = await import("drizzle-orm");

						const [userRecord] = await db
							.select({
								id: users.id,
								email: users.email,
								isAdmin: users.isAdmin,
							})
							.from(users)
							.where(eq(users.id, userId))
							.limit(1);

						if (
							userRecord?.email &&
							adminEmails.includes(userRecord.email.toLowerCase()) &&
							!userRecord.isAdmin
						) {
							await db
								.update(users)
								.set({ isAdmin: true })
								.where(eq(users.id, userRecord.id));
						}
					} catch (err) {
						console.error(
							"[auth] Failed to auto-promote admin in session hook:",
							err,
						);
					}
				},
			},
		},
	},
	emailAndPassword: {
		enabled: false,
	},
	socialProviders: {
		google: {
			clientId: process.env.GOOGLE_CLIENT_ID || "",
			clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
		},
		// ponytail: placeholder: gh CLI token lacks OAuth-App scope to auto-provision.
		// Create at github.com/settings/developers, then fill real values in .env.
		github: {
			clientId: process.env.GITHUB_CLIENT_ID || "placeholder",
			clientSecret: process.env.GITHUB_CLIENT_SECRET || "placeholder",
		},
	},
	user: {
		additionalFields: {
			fullName: { type: "string", required: false, input: true },
			company: { type: "string", required: false, input: true },
			role: { type: "string", required: false, input: false },
			isAdmin: {
				type: "boolean",
				required: false,
				input: false,
				defaultValue: false,
			},
			bannedAt: { type: "date", required: false, input: false },
		},
	},
	session: {
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60, // 5 min - skip DB query per request
		},
	},
	rateLimit: {
		enabled: true,
		window: 60,
		max: 100,
	},
	trustedOrigins: [
		"http://localhost:3000",
		"http://127.0.0.1:3000",
		...(process.env.APP_URL ? [process.env.APP_URL] : []),
		...(process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : []),
	],
	// tanstackStartCookies MUST be last plugin
	plugins: [tanstackStartCookies()],
});
