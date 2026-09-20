import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, ne } from "drizzle-orm";
import { AlertTriangle, CalendarClock, Trash2 } from "lucide-react";
import { useState } from "react";
import { cancelSubscription } from "@/app/actions/payment";
import {
	type CreditOperationItem,
	CreditUsageSection,
} from "@/components/settings/credit-usage";
import { db } from "@/db";
import {
	creditOperations,
	payments,
	projects,
	subscriptions,
} from "@/db/schema";
import { TOPUP_SKU } from "@/lib/constants";
import { requireUserServer } from "@/lib/session";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useUIStore } from "@/store";

export interface BillingSubscription {
	id: string;
	userId: string;
	plan: string;
	status: string;
	midtransOrderId: string | null;
	currentPeriodStart: string | null;
	currentPeriodEnd: string | null;
	cancelledAt: string | null;
	reminderCount: number;
	credits: number;
	creditsUsed: number;
	creditsReserved: number;
	createdAt: string | null;
	updatedAt: string | null;
}

export interface BillingPaymentItem {
	id: string;
	userId: string;
	amount: number;
	status: string;
	plan: string | null;
	snapToken: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	midtransResponse: object | null;
}

export interface BillingCreditUsage {
	availableCredits: number;
	reservedCredits: number;
	totalCreditsUsed: number;
	operations: CreditOperationItem[];
}

// ponytail: server-only db logic - loader runs on client too, must not import db there.
const loadBilling = createServerFn({ method: "GET" }).handler(async () => {
	const user = await requireUserServer();

	const [subRows, paymentRows, operationRows] = await Promise.all([
		db
			.select()
			.from(subscriptions)
			.where(eq(subscriptions.userId, user.id))
			.orderBy(desc(subscriptions.createdAt))
			.limit(1),
		// ponytail: exclude pending - internal Midtrans state, user doesn't need to see
		// abandoned checkouts (accidental pricing page clicks, browser back, etc.)
		db
			.select()
			.from(payments)
			.where(and(eq(payments.userId, user.id), ne(payments.status, "pending")))
			.orderBy(desc(payments.createdAt))
			.limit(10),
		db
			.select({
				id: creditOperations.id,
				projectId: creditOperations.projectId,
				projectName: projects.name,
				kind: creditOperations.kind,
				stage: creditOperations.stage,
				state: creditOperations.state,
				estimatedCredits: creditOperations.estimatedCredits,
				reservedCredits: creditOperations.reservedCredits,
				maximumCredits: creditOperations.maximumCredits,
				finalCharge: creditOperations.finalCharge,
				pricingVersion: creditOperations.pricingVersion,
				metrics: creditOperations.metrics,
				capApplied: creditOperations.capApplied,
				createdAt: creditOperations.createdAt,
				settledAt: creditOperations.settledAt,
			})
			.from(creditOperations)
			.leftJoin(
				projects,
				and(
					eq(projects.id, creditOperations.projectId),
					eq(projects.userId, user.id),
				),
			)
			.where(eq(creditOperations.userId, user.id))
			.orderBy(desc(creditOperations.createdAt))
			.limit(50),
	]);

	// ponytail: server fn boundary rejects Date + unknown - coerce to plain JSON.
	const subscription: BillingSubscription | undefined = subRows[0]
		? {
				id: subRows[0].id,
				userId: subRows[0].userId,
				plan: subRows[0].plan,
				status: subRows[0].status,
				midtransOrderId: subRows[0].midtransOrderId ?? null,
				currentPeriodStart:
					subRows[0].currentPeriodStart?.toISOString() ?? null,
				currentPeriodEnd: subRows[0].currentPeriodEnd?.toISOString() ?? null,
				cancelledAt: subRows[0].cancelledAt?.toISOString() ?? null,
				reminderCount: subRows[0].reminderCount,
				credits: subRows[0].credits,
				creditsUsed: subRows[0].creditsUsed,
				creditsReserved: subRows[0].creditsReserved,
				createdAt: subRows[0].createdAt?.toISOString() ?? null,
				updatedAt: subRows[0].updatedAt?.toISOString() ?? null,
			}
		: undefined;

	const paymentsList: BillingPaymentItem[] = paymentRows.map((p) => ({
		id: p.id,
		userId: p.userId,
		amount: p.amount ?? 0,
		status: p.status ?? "pending",
		plan: p.plan ?? "pro",
		snapToken: null,
		createdAt: p.createdAt?.toISOString() ?? null,
		updatedAt: p.updatedAt?.toISOString() ?? null,
		midtransResponse: p.midtransResponse as object | null,
	}));

	const operationsList: CreditOperationItem[] = operationRows.map((op) => ({
		id: op.id,
		projectId: op.projectId,
		projectName: op.projectName ?? null,
		kind: op.kind,
		stage: op.stage,
		state: op.state,
		estimatedCredits: op.estimatedCredits,
		reservedCredits: op.reservedCredits,
		maximumCredits: op.maximumCredits,
		finalCharge: op.finalCharge,
		pricingVersion: op.pricingVersion,
		metrics: op.metrics,
		capApplied: op.capApplied,
		createdAt: op.createdAt?.toISOString() ?? null,
		settledAt: op.settledAt?.toISOString() ?? null,
	}));

	const credits = subscription?.credits ?? 0;
	const creditsUsed = subscription?.creditsUsed ?? 0;
	const creditsReserved = subscription?.creditsReserved ?? 0;
	const availableCredits = Math.max(0, credits - creditsUsed - creditsReserved);

	const creditUsage: BillingCreditUsage = {
		availableCredits,
		reservedCredits: creditsReserved,
		totalCreditsUsed: creditsUsed,
		operations: operationsList,
	};

	return { subscription, payments: paymentsList, creditUsage };
});

const deletePayment = createServerFn({ method: "POST" })
	.validator((paymentId: string) => paymentId)
	.handler(async ({ data: paymentId }) => {
		const user = await requireUserServer();
		await db
			.delete(payments)
			.where(and(eq(payments.id, paymentId), eq(payments.userId, user.id)));
		return { success: true };
	});

export const Route = createFileRoute("/settings/billing")({
	loader: async () => {
		try {
			return await loadBilling();
		} catch (e) {
			if ((e as Error).message === "Unauthorized")
				throw redirect({ to: "/login" });
			throw e;
		}
	},
	component: BillingPage,
});

function BillingPage() {
	const {
		subscription,
		payments: initialPayments,
		creditUsage,
	} = Route.useLoaderData();
	const [paymentsList, setPaymentsList] = useState(initialPayments);
	const [deleteId, setDeleteId] = useState<string | null>(null);
	const [cancelOpen, setCancelOpen] = useState(false);
	const [cancelling, setCancelling] = useState(false);

	const handleCancel = async () => {
		setCancelling(true);
		try {
			const res = await cancelSubscription();
			showToast(res.message, res.success ? "success" : "error");
			if (res.success) window.location.reload();
		} catch {
			showToast("Gagal membatalkan langganan. Coba lagi.", "error");
		} finally {
			setCancelling(false);
			setCancelOpen(false);
		}
	};

	// Derived subscription display state (server truth via loader dates).
	const planLabel = subscription?.plan || "free";
	const isPaidPlan = planLabel === "pro" || planLabel === "hengker";
	const periodEndDate = subscription?.currentPeriodEnd
		? new Date(subscription.currentPeriodEnd)
		: null;
	const isPaused =
		isPaidPlan &&
		periodEndDate !== null &&
		periodEndDate.getTime() < Date.now();
	const statusText = isPaidPlan
		? isPaused
			? "Pause — masa aktif habis"
			: periodEndDate
				? `Aktif s.d. ${formatDate(periodEndDate.toISOString())}`
				: "Aktif (paket lama, tanpa masa aktif)"
		: "Gratis";
	const showToast = useUIStore((s) => s.showToast);
	const credits = subscription?.credits ?? 0;
	const creditsUsed = subscription?.creditsUsed ?? 0;
	const creditsReserved = subscription?.creditsReserved ?? 0;
	const remaining = Math.max(0, credits - creditsUsed - creditsReserved);

	const handleDelete = async (id: string) => {
		try {
			await deletePayment({ data: id });
			setPaymentsList((prev) => prev.filter((p) => p.id !== id));
			showToast("Riwayat pembayaran berhasil dihapus", "success");
		} catch {
			showToast("Gagal menghapus riwayat pembayaran", "error");
		} finally {
			setDeleteId(null);
		}
	};

	return (
		<div className="flex flex-col gap-6">
			<div className="grid gap-6 lg:grid-cols-2 h-full">
				<div className="rounded-xl border border-(--border-subtle) bg-(--bg-card) p-6">
					<h2 className="mb-6 font-inter font-[510] text-xl font-bold">
						Billing & Kredit
					</h2>
					<div className="flex items-center justify-between">
						<div>
							<span className="text-3xl font-bold capitalize">
								{planLabel}
								{isPaidPlan && !periodEndDate ? (
									<span className="ml-2 align-middle rounded-full bg-(--bg-surface) px-2 py-0.5 text-xs font-medium text-(--text-secondary)">
										legacy
									</span>
								) : null}
							</span>
							<p
								className={`mt-1 flex items-center gap-1.5 text-sm ${
									isPaused
										? "text-amber-600 dark:text-amber-400"
										: "text-(--text-secondary)"
								}`}
							>
								{isPaused ? (
									<AlertTriangle size={14} />
								) : (
									<CalendarClock size={14} />
								)}
								{statusText}
							</p>
						</div>
						<div className="flex items-center gap-2">
							{isPaidPlan && !isPaused && (
								<button
									type="button"
									onClick={() => setCancelOpen(true)}
									className="rounded-lg border border-(--border-subtle) px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-500/10"
								>
									Cancel Langganan
								</button>
							)}
							<Link
								to="/pricing"
								className="rounded-lg border border-(--border-subtle) px-4 py-2 text-sm font-medium hover:bg-(--bg-surface)"
							>
								{isPaused ? "Perpanjang" : "Beli Paket"}
							</Link>
						</div>
					</div>

					<div className="mt-6 rounded-lg bg-(--bg-surface) p-4">
						<div className="mb-2 flex justify-between text-sm">
							<span className="text-(--text-secondary)">Kredit digunakan</span>
							<span className="font-medium">
								{creditsUsed} / {credits}
								{creditsReserved > 0 && (
									<span className="ml-1 text-xs text-amber-400 font-normal">
										({creditsReserved} direservasi)
									</span>
								)}
							</span>
						</div>
						<div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-(--bg-card)">
							<div
								className="h-full rounded-full bg-indigo transition-all"
								style={{
									width: `${credits > 0 ? (creditsUsed / credits) * 100 : 0}%`,
								}}
							/>
						</div>
						<p className="mt-2 text-xs text-(--text-secondary)">
							{isPaused
								? "Masa aktif habis — sisa kredit periode lama hangus. Perpanjang untuk dapat kredit segar."
								: remaining > 0
									? `Sisa ${remaining} kredit periode ini.${creditsReserved > 0 ? ` (${creditsReserved} sedang direservasi).` : ""} Kredit reset setiap 30 hari.`
									: "Kredit periode ini habis. Perpanjang atau tunggu reset berikutnya."}
						</p>
						{!isPaused &&
							remaining === 0 &&
							isPaidPlan &&
							periodEndDate != null && (
								<p className="mt-1 text-xs text-(--text-secondary)">
									<Link
										to="/pricing"
										hash="topup"
										className="font-medium underline underline-offset-2"
									>
										Atau top up {TOPUP_SKU.credits} kredit (Rp{" "}
										{(TOPUP_SKU.priceIdr as number).toLocaleString("id-ID")})
										tanpa menambah masa aktif
									</Link>
								</p>
							)}
					</div>
				</div>

				<div className="rounded-xl border border-(--border-subtle) bg-(--bg-card) p-6">
					<h2 className="mb-6 font-inter font-[510] text-xl font-bold">
						Riwayat Pembayaran
					</h2>
					{paymentsList.length === 0 ? (
						<p className="text-sm text-(--text-secondary)">
							Belum ada pembayaran
						</p>
					) : (
						<div className="space-y-3">
							{paymentsList.map((p) => (
								<div
									key={p.id}
									className="flex items-center justify-between rounded-lg border border-(--border-subtle) p-4 text-sm"
								>
									<div>
										<div className="font-medium">
											{formatCurrency(p.amount ?? 0)}
										</div>
										<div className="mt-1 text-xs text-(--text-secondary)">
											{formatDate(p.createdAt ?? "")}
										</div>
									</div>
									<div className="flex items-center gap-2">
										<span
											className={`rounded-full px-3 py-1 text-xs font-medium ${
												p.status === "success"
													? "bg-green-100 text-green-800"
													: "bg-red-100 text-red-800"
											}`}
										>
											{p.status === "success" ? "Berhasil" : "Gagal"}
										</span>
										<button
											type="button"
											onClick={() => setDeleteId(p.id)}
											className="rounded p-1.5 text-fog hover:bg-red-500/10 hover:text-red-400 transition-colors"
											aria-label="Hapus riwayat"
										>
											<Trash2 size={14} />
										</button>
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Credit Usage Section */}
			<CreditUsageSection operations={creditUsage.operations} />

			{/* Cancel subscription confirmation */}
			{cancelOpen && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
					<div className="w-full mx-4 max-w-sm rounded-xl border border-(--border-subtle) bg-(--bg-card) p-6">
						<h3 className="mb-2 font-inter font-[510] text-lg">
							Batalkan Langganan?
						</h3>
						<p className="mb-6 text-sm text-(--text-secondary)">
							Akunmu akan kembali ke paket Free (2 kredit PRD per bulan) dan
							sisa kredit {planLabel} kamu hangus. Riwayat pembayaran tetap
							tersimpan. Tindakan ini langsung berlaku.
						</p>
						<div className="flex justify-end gap-3">
							<button
								type="button"
								onClick={() => setCancelOpen(false)}
								className="rounded-lg px-4 py-2 text-sm font-medium hover:bg-(--bg-surface)"
							>
								Kembali
							</button>
							<button
								type="button"
								disabled={cancelling}
								onClick={handleCancel}
								className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
							>
								{cancelling ? "Memproses..." : "Ya, Batalkan"}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Delete confirmation dialog */}
			{deleteId && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
					<div className="rounded-xl border border-(--border-subtle) bg-(--bg-card) p-6 max-w-sm w-full mx-4">
						<h3 className="font-inter font-[510] text-lg mb-2">
							Hapus Riwayat?
						</h3>
						<p className="text-sm text-(--text-secondary) mb-6">
							Riwayat pembayaran ini akan dihapus permanen. Tindakan ini tidak
							dapat dibatalkan.
						</p>
						<div className="flex justify-end gap-3">
							<button
								type="button"
								onClick={() => setDeleteId(null)}
								className="rounded-lg px-4 py-2 text-sm font-medium hover:bg-(--bg-surface)"
							>
								Batal
							</button>
							<button
								type="button"
								onClick={() => handleDelete(deleteId)}
								className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
							>
								Hapus
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
