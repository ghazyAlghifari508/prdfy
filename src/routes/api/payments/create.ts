import { randomBytes } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { canPurchaseTopUp, remainingTopUpQuota } from "@/lib/billing";
import { TOPUP_SKU } from "@/lib/constants";
import { getCreditBalance } from "@/lib/credits";
import { isValidHistoryUrl } from "@/lib/flow-progress";
import { getMidtransConfig, midtransAuthHeader } from "@/lib/midtrans";
import { prdFyPlans } from "@/lib/pricing-data";
import { getTopUpCreditsUsedThisPeriod } from "@/lib/services/payment-service";
import { requireUser } from "@/lib/session";
import { PLAN_CREDITS } from "@/types/database";

const ALLOWED_ORIGINS = [
	"https://prdfy.vercel.app",
	"https://prdfy-git-main-ghazy-alghifaris-projects.vercel.app",
	"http://localhost:3000",
];

export const Route = createFileRoute("/api/payments/create")({
	server: {
		handlers: {
			POST: async ({ request }: { request: Request }) => {
				const user = await requireUser(getRequestHeaders());
				let gateway: ReturnType<typeof getMidtransConfig>;
				try {
					gateway = getMidtransConfig();
				} catch {
					return Response.json(
						{ error: "Pembayaran belum dikonfigurasi." },
						{ status: 500 },
					);
				}
				const { planId, returnUrl, projectId } = (await request.json()) as {
					planId: string;
					returnUrl?: string;
					projectId?: string;
				};

				// Two product kinds share this endpoint (spec §6.1): a monthly plan
				// subscription (SET semantics) and a mid-period credit top-up
				// (additive credits, period untouched). Gates differ accordingly.
				const isTopUp = planId === TOPUP_SKU.id;

				let amount: number;
				let planCredits: number;
				let itemLabel: string;

				if (isTopUp) {
					// STRICT gates at checkout time (spec §5.3 point 4): eligibility
					// and quota are enforced HERE; grant time stays tolerant.
					const balance = await getCreditBalance(user.id);
					// CreditBalance and EffectiveSubscription carry the same facts under
					// different field names (subscriptionState/state, plan/effectivePlan);
					// this adapter keeps canPurchaseTopUp pure over its own shape.
					const eff = {
						state: balance.subscriptionState,
						effectivePlan: balance.plan,
						remaining: balance.remaining,
						currentPeriodEnd: balance.currentPeriodEnd,
					};
					if (!canPurchaseTopUp(eff)) {
						return Response.json(
							{
								error:
									"Top up hanya tersedia untuk langganan Pro/Hengker yang sedang aktif.",
							},
							{ status: 403 },
						);
					}
					const used = await getTopUpCreditsUsedThisPeriod(user.id);
					if (
						remainingTopUpQuota({ plan: balance.plan, usedThisPeriod: used }) <
						TOPUP_SKU.credits
					) {
						return Response.json(
							{
								error: `Kuota top-up periode ini sudah habis (maksimal ${PLAN_CREDITS[balance.plan]} kredit). Kuota reset saat periode berikutnya.`,
							},
							{ status: 400 },
						);
					}
					amount = TOPUP_SKU.priceIdr;
					planCredits = TOPUP_SKU.credits;
					itemLabel = `Top Up ${TOPUP_SKU.credits} Kredit PrdFy`;
				} else {
					const plan = prdFyPlans.find((p) => p.id === planId);
					if (!plan)
						return Response.json(
							{ error: "Plan tidak ditemukan." },
							{ status: 404 },
						);
					if (plan.price === 0)
						return Response.json(
							{ error: "Plan gratis tidak memerlukan pembayaran." },
							{ status: 400 },
						);

					// ponytail: no plan-hierarchy guard - buying the same or a lower
					// tier again is a legitimate renewal/switch (SET semantics).
					amount = plan.price;
					planCredits = plan.credits;
					itemLabel = `Paket ${plan.name} - ${plan.credits} kredit/bulan`;
				}

				// Clean up stale pending payments for this user (>5 min) before
				// creating a new one. Prevents stacking abandoned checkouts.
				const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
				await db
					.update(payments)
					.set({ status: "failed" })
					.where(
						and(
							eq(payments.userId, user.id),
							eq(payments.status, "pending"),
							lt(payments.createdAt, fiveMinAgo),
						),
					);

				const orderId = `${isTopUp ? "TOPUP" : "ORDER"}-${Date.now()}-${randomBytes(4).toString("hex")}`;
				await db.insert(payments).values({
					id: crypto.randomUUID(),
					userId: user.id,
					orderId,
					// Stored SKU doubles as the completion router (see
					// applyOrderSuccess) and the per-period cap counter input.
					plan: isTopUp ? TOPUP_SKU.id : planId,
					amount,
					status: "pending",
				});

			const origin = request.headers.get("origin") || "";
			const safeOrigin = ALLOWED_ORIGINS.includes(origin)
				? origin
				: ALLOWED_ORIGINS[0];
			const authString = midtransAuthHeader(gateway.serverKey);

				const parameters = {
					transaction_details: { order_id: orderId, gross_amount: amount },
					customer_details: {
						first_name: user.name || "Customer",
						email: user.email,
					},
					item_details: [
						{
							id: planId,
							price: amount,
							quantity: 1,
							name: itemLabel,
						},
					],
					custom_field1: planId,
					custom_field2: String(planCredits),
					custom_field3: user.id,
					callbacks: {
						finish: (() => {
							const finishPath =
								returnUrl &&
								projectId &&
								isValidHistoryUrl(returnUrl, projectId)
									? returnUrl
									: "/pricing";
							return `${safeOrigin}${finishPath}${finishPath.includes("?") ? "&" : "?"}payment=success&order_id=${orderId}`;
						})(),
					},
				};

			try {
				const response = await fetch(
					`${gateway.snapBaseUrl}/transactions`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Accept: "application/json",
							Authorization: `Basic ${authString}`,
							"X-Override-Notification": `${safeOrigin}/api/payments/webhook`,
						},
						body: JSON.stringify(parameters),
					},
				);
				if (!response.ok) throw new Error(await response.text());
				const transaction = await response.json();
				return Response.json({
					redirect_url: transaction.redirect_url,
					token: transaction.token,
				});
			} catch (error) {
				console.error("Midtrans/System Error:", error);
				// Keep the row as a failed attempt instead of deleting it: the
				// gateway may still have accepted the order, and a later
				// webhook retry must find its audit record.
				await db
					.update(payments)
					.set({ status: "failed", updatedAt: new Date() })
					.where(eq(payments.orderId, orderId));
				return Response.json(
					{
						error:
							"Terjadi kesalahan pada sistem pembayaran. Silakan coba lagi.",
					},
					{ status: 500 },
				);
			}
			},
		},
	},
});
