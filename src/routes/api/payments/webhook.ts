import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { getMidtransConfig } from "@/lib/midtrans";
import { applyOrderSuccess } from "@/lib/services/payment-service";

export const Route = createFileRoute("/api/payments/webhook")({
	server: {
		handlers: {
			POST: async ({ request }: { request: Request }) => {
				const body = await request.json();
				const { order_id, transaction_status, status_code, gross_amount } =
					body;

			let serverKey: string;
			try {
				serverKey = getMidtransConfig().serverKey;
			} catch {
				return Response.json(
					{ error: "Server misconfiguration" },
					{ status: 500 },
				);
			}
			const signatureKey = `${order_id}${status_code}${gross_amount}${serverKey}`;
				const expected = createHash("sha512")
					.update(signatureKey)
					.digest("hex");

				if (body.signature_key !== expected)
					return Response.json({ error: "Invalid signature" }, { status: 401 });

				if (["settlement", "capture"].includes(transaction_status)) {
					// A capture still under fraud review must not grant until
					// Midtrans confirms it (mirrors syncPaymentStatus): challenge
					// stays pending so a later accept notification can grant.
					if (
						transaction_status === "capture" &&
						body.fraud_status &&
						body.fraud_status !== "accept"
					) {
						return Response.json({ status: "ok" });
					}
					// Verify the notified amount against what we charged. Midtrans sends
					// gross_amount as a decimal string ("49000.00"), hence Number().
					const [stored] = await db
						.select({ amount: payments.amount })
						.from(payments)
						.where(eq(payments.orderId, order_id))
						.limit(1);
					if (!stored)
						return Response.json({ error: "Unknown order" }, { status: 404 });
					if (Number(gross_amount) !== stored.amount) {
						console.error(
							`Webhook amount mismatch for ${order_id}: got ${gross_amount}, expected ${stored.amount}`,
						);
						return Response.json({ error: "Amount mismatch" }, { status: 400 });
					}

					try {
						await applyOrderSuccess(order_id);
					} catch (err) {
						console.error("Webhook processing error:", err);
						return Response.json(
							{ status: "error", message: "Processing failed, will retry" },
							{ status: 500 },
						);
					}
				}

			// Terminal non-success states, including post-settlement
			// reversals (deny/refund/chargeback). Only non-success rows move,
			// so a delayed reversal can never overwrite a settled grant's
			// success marker; grant compensation stays a manual step.
			if (
				[
					"expire",
					"cancel",
					"deny",
					"refund",
					"chargeback",
					"partial_refund",
					"partial_chargeback",
				].includes(transaction_status)
			) {
				await db
					.update(payments)
					.set({ status: "failed" })
					.where(
						and(
							eq(payments.orderId, order_id),
							ne(payments.status, "success"),
						),
					);
			}

				return Response.json({ status: "ok" });
			},
		},
	},
});
