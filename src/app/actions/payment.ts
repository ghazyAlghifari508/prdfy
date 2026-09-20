/**
 * Midtrans payment sync - TanStack server fn. Imported by the client pricing-card,
 * so this module must stay client-safe: the createServerFn compiler strips the
 * handler body (and its server-only imports) from the browser bundle. Keep all
 * db/Buffer logic in payment-service.ts (imported only inside the handler).
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import type { Plan } from "@/types/database";

export const syncPaymentStatus = createServerFn({ method: "POST" })
	.validator((orderId: string) => orderId)
	.handler(async ({ data: orderId }) => {
		const user = await requireUser(getRequestHeaders());
		const { db } = await import("@/db");
		const { payments, subscriptions } = await import("@/db/schema");
		const { applyOrderSuccess } = await import(
			"@/lib/services/payment-service"
		);

		const [payment] = await db
			.select()
			.from(payments)
			.where(eq(payments.orderId, orderId))
			.limit(1);
		if (!payment) throw new Error("Payment not found");
		if (payment.userId !== user.id) throw new Error("Unauthorized");

		if (payment.status === "success") {
			const [sub] = await db
				.select({ plan: subscriptions.plan })
				.from(subscriptions)
				.where(eq(subscriptions.userId, user.id))
				.orderBy(desc(subscriptions.createdAt))
				.limit(1);
			return {
				success: true,
				plan: (sub?.plan ?? "pro") as Plan,
				message: "Already synced",
			};
		}

		// Verify with Midtrans before applying.
		const { getMidtransConfig, midtransAuthHeader } = await import(
			"@/lib/midtrans"
		);
		const gateway = getMidtransConfig();
		const authString = midtransAuthHeader(gateway.serverKey);
		const response = await fetch(`${gateway.apiBaseUrl}/${orderId}/status`, {
			headers: {
				Authorization: `Basic ${authString}`,
				"Content-Type": "application/json",
			},
		});
		if (!response.ok) throw new Error("Failed to fetch status from Midtrans");

		const statusData = await response.json();
		if (["settlement", "capture"].includes(statusData.transaction_status)) {
			const result = await applyOrderSuccess(orderId);
			return { success: true, updated: true, plan: result?.plan };
		}
		return { success: false, status: statusData.transaction_status as string };
	});

/**
 * Cancel flow (spec §6.2): downgrades the latest subscription row to a normal
 * Free account with a fresh monthly period. Payment history stays intact in
 * the payments table. Idempotent: cancelling a free account is a no-op reset.
 */
export const cancelSubscription = createServerFn({ method: "POST" }).handler(
	async () => {
		const user = await requireUser(getRequestHeaders());
		const { db } = await import("@/db");
		const { subscriptions } = await import("@/db/schema");
		const { computeFreeRolloverPeriod } = await import("@/lib/billing");
		const { PLAN_CREDITS } = await import("@/types/database");

		const now = new Date();
		const period = computeFreeRolloverPeriod(now);

		const [row] = await db
			.select({ id: subscriptions.id })
			.from(subscriptions)
			.where(eq(subscriptions.userId, user.id))
			.orderBy(desc(subscriptions.createdAt))
			.limit(1);
		if (!row) return { success: false, message: "Langganan tidak ditemukan." };

		await db
			.update(subscriptions)
			.set({
				plan: "free",
				status: "active",
				cancelledAt: now,
				currentPeriodStart: period.start,
				currentPeriodEnd: period.end,
				credits: PLAN_CREDITS.free,
				creditsUsed: 0,
				updatedAt: now,
			})
			.where(eq(subscriptions.id, row.id));

		return {
			success: true,
			message: "Langganan dibatalkan. Akunmu kembali ke paket Free.",
		};
	},
);
