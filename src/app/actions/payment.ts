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
	.validator((orderId: string) => {
		if (
			typeof orderId !== "string" ||
			!/^[A-Za-z0-9_-]{1,128}$/.test(orderId)
		) {
			throw new Error("Invalid order ID format");
		}
		return orderId;
	})
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
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 10_000);
		let response: Response;
		try {
			response = await fetch(
				`${gateway.apiBaseUrl}/${encodeURIComponent(orderId)}/status`,
				{
					headers: {
						Authorization: `Basic ${authString}`,
						"Content-Type": "application/json",
					},
					signal: controller.signal,
				},
			);
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") {
				throw new Error("Midtrans status request timed out");
			}
			throw err;
		} finally {
			clearTimeout(timeout);
		}
		if (!response.ok) throw new Error("Failed to fetch status from Midtrans");

		const statusData = await response.json();
		if (["settlement", "capture"].includes(statusData.transaction_status)) {
			// Mirror the webhook guards: the notified amount must match the
			// stored order, and a capture still under fraud review must not
			// grant until Midtrans confirms it.
			if (Number(statusData.gross_amount) !== payment.amount) {
				throw new Error("Amount mismatch with payment provider");
			}
			if (
				statusData.transaction_status === "capture" &&
				statusData.fraud_status &&
				statusData.fraud_status !== "accept"
			) {
				return {
					success: false,
					status: statusData.transaction_status as string,
				};
			}
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

		const result = await db.transaction(async (tx) => {
			const [row] = await tx
				.select({ id: subscriptions.id })
				.from(subscriptions)
				.where(eq(subscriptions.userId, user.id))
				.orderBy(desc(subscriptions.createdAt))
				.for("update")
				.limit(1);
			if (!row)
				return { success: false, message: "Langganan tidak ditemukan." };

			await tx
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
		});

		return result;
	},
);
