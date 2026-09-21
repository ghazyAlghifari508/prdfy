import { createHash, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions, users } from "@/db/schema";
import {
	pausedReminderEmail,
	preExpiryNoticeEmail,
	sendEmail,
} from "@/lib/email";
import {
	type BillingCandidateRow,
	selectBillingEmailTargets,
} from "@/lib/services/billing-emails";

/** Constant-time string compare via SHA-256 digests (length-safe). */
function secretsMatch(provided: string, secret: string): boolean {
	const a = createHash("sha256").update(provided).digest();
	const b = createHash("sha256").update(secret).digest();
	return timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/cron/billing")({
	server: {
		handlers: {
			GET: async ({ request }: { request: Request }) => {
				const secret =
					process.env.CRON_BILLING_SECRET ?? process.env.CRON_SECRET;
				const header = request.headers.get("authorization") ?? "";
				const match = /^Bearer\s+(.+)$/i.exec(header);
				const provided = match?.[1]?.trim() ?? "";
				if (!secret || !provided || !secretsMatch(provided, secret)) {
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				}

				// Loose candidate filter; exact scheduling happens in the pure
				// selector. One row per user is the current invariant (single
				// subscriptions row mutated in place since signup).
				const candidates = await db
					.select({
						subscriptionId: subscriptions.id,
						userId: subscriptions.userId,
						email: users.email,
						plan: subscriptions.plan,
						currentPeriodEnd: subscriptions.currentPeriodEnd,
						reminderCount: subscriptions.reminderCount,
					})
					.from(subscriptions)
					.innerJoin(users, eq(users.id, subscriptions.userId))
					.where(
						and(
							inArray(subscriptions.plan, ["pro", "hengker"]),
							eq(subscriptions.status, "active"),
							isNotNull(subscriptions.currentPeriodEnd),
							lte(
								subscriptions.currentPeriodEnd,
								sql`now() + interval '3 days'`,
							),
						),
					);

				const rows: BillingCandidateRow[] = candidates.flatMap((r) =>
					r.currentPeriodEnd
						? [{ ...r, currentPeriodEnd: r.currentPeriodEnd }]
						: [],
				);

				const targets = selectBillingEmailTargets(rows, new Date());
				let sent = 0;

				for (const t of targets) {
					try {
						const candidate = candidates.find((c) => c.userId === t.userId);
						const endDate = candidate?.currentPeriodEnd ?? null;
						const mail =
							t.kind === "pre_expiry"
								? preExpiryNoticeEmail(t.plan, endDate ?? new Date())
								: pausedReminderEmail(t.plan, t.daysLate);

						const ok = await sendEmail({
							to: t.email,
							subject: mail.subject,
							html: mail.html,
						});
						if (!ok) continue; // best-effort: skip, never abort the batch

						sent += 1;
						if (candidate?.subscriptionId) {
							await db
								.update(subscriptions)
								.set({
									reminderCount: sql`${subscriptions.reminderCount} + 1`,
									updatedAt: new Date(),
								})
								.where(eq(subscriptions.id, candidate.subscriptionId));
						}
					} catch (targetErr) {
						console.error(
							`[cron/billing] failed sending reminder to ${t.email}:`,
							targetErr,
						);
					}
				}

				return Response.json({ ok: true, sent });
			},
		},
	},
});
