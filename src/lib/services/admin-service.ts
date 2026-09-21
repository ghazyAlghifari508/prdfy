import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/session";
import {
	buildDateRangeSeries,
	type DailyTrendPoint,
	mergeTrendData,
} from "./admin-trend-utils";

export type { DailyTrendPoint } from "./admin-trend-utils";

export interface AdminTransactionItem {
	id: string;
	orderId: string;
	plan: string;
	amount: number;
	status: string;
	userName: string | null;
	userEmail: string | null;
	createdAt: Date | null;
}

export interface AdminProjectItem {
	id: string;
	name: string;
	description: string | null;
	status: string | null;
	step: string | null;
	acStatus: string | null;
	taskStatus: string | null;
	userId: string;
	userName: string | null;
	userEmail: string | null;
	createdAt: Date | null;
}

async function adminDb() {
	const { db } = await import("@/db");
	const {
		users,
		subscriptions,
		sessions,
		projects,
		prdVersions,
		acVersions,
		tasks,
		feedback,
		errorReports,
		payments,
	} = await import("@/db/schema");
	return {
		db,
		users,
		subscriptions,
		sessions,
		projects,
		prdVersions,
		acVersions,
		tasks,
		feedback,
		errorReports,
		payments,
	};
}

export interface AdminDashboardMetrics {
	usersCount: number;
	projectsCount: number;
	prdCount: number;
	acCount: number;
	tasksCount: number;
	feedbackCount: number;
	errorCount: number;
	totalRevenue: number;
	currentMonthRevenue: number;
	planDistribution: { plan: string; count: number }[];
	recentProjects: {
		id: string;
		name: string;
		step: string | null;
		userName: string | null;
		userEmail: string | null;
		createdAt: Date | null;
	}[];
	recentTransactions: AdminTransactionItem[];
	trendData: DailyTrendPoint[];
}

export const getAdminDashboardMetrics = createServerFn({
	method: "GET",
}).handler(async (): Promise<AdminDashboardMetrics> => {
	await requireAdmin(await getRequestHeaders());
	const {
		db,
		users,
		subscriptions,
		projects,
		prdVersions,
		acVersions,
		tasks,
		feedback,
		errorReports,
		payments,
	} = await adminDb();

	const now = new Date();
	const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
	const trendDays = 7;
	const trendStartDate = new Date(now);
	trendStartDate.setDate(trendStartDate.getDate() - (trendDays - 1));
	trendStartDate.setHours(0, 0, 0, 0);
	const dateSeries = buildDateRangeSeries(trendDays);

	const [
		[userRow],
		[projectRow],
		[prdRow],
		[acRow],
		[taskRow],
		[fbRow],
		[errRow],
		[paymentRow],
		[currentMonthPaymentRow],
		planRows,
		recentProjects,
		recentTransactions,
		trendRevenueRows,
		trendUserRows,
	] = await Promise.all([
		db.select({ count: sql<number>`count(*)` }).from(users),
		db.select({ count: sql<number>`count(*)` }).from(projects),
		db.select({ count: sql<number>`count(*)` }).from(prdVersions),
		db.select({ count: sql<number>`count(*)` }).from(acVersions),
		db.select({ count: sql<number>`count(*)` }).from(tasks),
		db.select({ count: sql<number>`count(*)` }).from(feedback),
		db.select({ count: sql<number>`count(*)` }).from(errorReports),
		db
			.select({
				total: sql<number>`coalesce(sum(${payments.amount}), 0)`,
			})
			.from(payments)
			.where(eq(payments.status, "success")),
		db
			.select({
				total: sql<number>`coalesce(sum(${payments.amount}), 0)`,
			})
			.from(payments)
			.where(
				and(
					eq(payments.status, "success"),
					gte(payments.createdAt, currentMonthStart),
				),
			),
		db
			.select({
				plan: subscriptions.plan,
				count: sql<number>`count(*)`,
			})
			.from(subscriptions)
			.groupBy(subscriptions.plan),
		db
			.select({
				id: projects.id,
				name: projects.name,
				step: projects.step,
				userName: users.name,
				userEmail: users.email,
				createdAt: projects.createdAt,
			})
			.from(projects)
			.leftJoin(users, eq(users.id, projects.userId))
			.orderBy(desc(projects.createdAt))
			.limit(5),
		db
			.select({
				id: payments.id,
				orderId: payments.orderId,
				plan: payments.plan,
				amount: payments.amount,
				status: payments.status,
				userName: users.name,
				userEmail: users.email,
				createdAt: payments.createdAt,
			})
			.from(payments)
			.leftJoin(users, eq(users.id, payments.userId))
			.orderBy(desc(payments.createdAt))
			.limit(5),
		db
			.select({
				day: sql<string>`to_char(${payments.createdAt}, 'YYYY-MM-DD')`,
				total: sql<number>`coalesce(sum(${payments.amount}), 0)`,
			})
			.from(payments)
			.where(
				and(
					eq(payments.status, "success"),
					gte(payments.createdAt, trendStartDate),
				),
			)
			.groupBy(sql`to_char(${payments.createdAt}, 'YYYY-MM-DD')`),
		db
			.select({
				day: sql<string>`to_char(${users.createdAt}, 'YYYY-MM-DD')`,
				count: sql<number>`count(*)`,
			})
			.from(users)
			.where(gte(users.createdAt, trendStartDate))
			.groupBy(sql`to_char(${users.createdAt}, 'YYYY-MM-DD')`),
	]);

	return {
		usersCount: Number(userRow?.count ?? 0),
		projectsCount: Number(projectRow?.count ?? 0),
		prdCount: Number(prdRow?.count ?? 0),
		acCount: Number(acRow?.count ?? 0),
		tasksCount: Number(taskRow?.count ?? 0),
		feedbackCount: Number(fbRow?.count ?? 0),
		errorCount: Number(errRow?.count ?? 0),
		totalRevenue: Number(paymentRow?.total ?? 0),
		currentMonthRevenue: Number(currentMonthPaymentRow?.total ?? 0),
		planDistribution: planRows.map((p) => ({
			plan: p.plan,
			count: Number(p.count),
		})),
		recentProjects: recentProjects.map((p) => ({
			...p,
			createdAt: p.createdAt ? new Date(p.createdAt) : null,
		})),
		recentTransactions: recentTransactions.map((t) => ({
			id: t.id,
			orderId: t.orderId,
			plan: t.plan,
			amount: Number(t.amount ?? 0),
			status: t.status ?? "pending",
			userName: t.userName,
			userEmail: t.userEmail,
			createdAt: t.createdAt ? new Date(t.createdAt) : null,
		})),
		trendData: mergeTrendData(
			dateSeries,
			trendRevenueRows.map((r) => ({ day: r.day, total: Number(r.total) })),
			trendUserRows.map((u) => ({ day: u.day, count: Number(u.count) })),
		),
	};
});

export const listUsers = createServerFn({ method: "GET" })
	.validator(
		(data: { limit?: number; offset?: number; search?: string } = {}) =>
			data ?? {},
	)
	.handler(async ({ data }) => {
		await requireAdmin(await getRequestHeaders());
		const { db, users, subscriptions } = await adminDb();
		const rows = await db
			.select({
				user: users,
				sub: subscriptions,
			})
			.from(users)
			.leftJoin(subscriptions, eq(subscriptions.userId, users.id))
			.orderBy(desc(users.createdAt))
			.limit(data.limit ?? 50)
			.offset(data.offset ?? 0);
		return rows;
	});

export const updateUserPlan = createServerFn({ method: "POST" })
	.validator(
		(data: { userId: string; plan: "free" | "pro" | "hengker" }) => data,
	)
	.handler(async ({ data }) => {
		await requireAdmin(await getRequestHeaders());
		const { db, subscriptions } = await adminDb();
		const [updated] = await db
			.update(subscriptions)
			.set({ plan: data.plan, status: "active", updatedAt: new Date() })
			.where(eq(subscriptions.userId, data.userId))
			.returning({ id: subscriptions.id });
		if (!updated) {
			throw new Error("Subscription not found for user");
		}
	});

export const setUserBanned = createServerFn({ method: "POST" })
	.validator((data: { userId: string; banned: boolean }) => data)
	.handler(async ({ data }) => {
		const adminUser = await requireAdmin(await getRequestHeaders());
		if (adminUser.id === data.userId && data.banned) {
			throw new Error("Cannot ban your own account");
		}
		const { db, users, sessions } = await adminDb();
		await db.transaction(async (tx) => {
			const [updated] = await tx
				.update(users)
				.set({
					bannedAt: data.banned ? new Date() : null,
					updatedAt: new Date(),
				})
				.where(eq(users.id, data.userId))
				.returning({ id: users.id });
			if (!updated) {
				throw new Error("User not found");
			}
			if (data.banned) {
				await tx.delete(sessions).where(eq(sessions.userId, data.userId));
			}
		});
	});

export const resetUserCredit = createServerFn({ method: "POST" })
	.validator((data: { userId: string }) => data)
	.handler(async ({ data }) => {
		await requireAdmin(await getRequestHeaders());
		const { db, subscriptions } = await adminDb();
		const [updated] = await db
			.update(subscriptions)
			.set({ creditsUsed: 0, updatedAt: new Date() })
			.where(eq(subscriptions.userId, data.userId))
			.returning({ id: subscriptions.id });
		if (!updated) {
			throw new Error("Subscription not found for user");
		}
	});

export const setUserAdmin = createServerFn({ method: "POST" })
	.validator((data: { userId: string; isAdmin: boolean }) => data)
	.handler(async ({ data }) => {
		const adminUser = await requireAdmin(await getRequestHeaders());
		if (adminUser.id === data.userId && !data.isAdmin) {
			throw new Error("Cannot revoke admin privileges from your own account");
		}
		const { db, users, sessions } = await adminDb();
		await db.transaction(async (tx) => {
			const [updated] = await tx
				.update(users)
				.set({ isAdmin: data.isAdmin, updatedAt: new Date() })
				.where(eq(users.id, data.userId))
				.returning({ id: users.id });
			if (!updated) {
				throw new Error("User not found");
			}
			if (!data.isAdmin) {
				await tx.delete(sessions).where(eq(sessions.userId, data.userId));
			}
		});
	});

export const listFeedback = createServerFn({ method: "GET" })
	.validator((data: { type?: string } = {}) => data ?? {})
	.handler(async ({ data }) => {
		await requireAdmin(await getRequestHeaders());
		const { db, feedback, users } = await adminDb();
		const rows = await db
			.select({
				id: feedback.id,
				message: feedback.message,
				type: feedback.type,
				createdAt: feedback.createdAt,
				userEmail: users.email,
				userName: users.name,
			})
			.from(feedback)
			.leftJoin(users, eq(users.id, feedback.userId))
			.where(data.type ? eq(feedback.type, data.type) : undefined)
			.orderBy(desc(feedback.createdAt));
		return rows;
	});

export const listErrorReports = createServerFn({ method: "GET" }).handler(
	async () => {
		await requireAdmin(await getRequestHeaders());
		const { db, errorReports, users } = await adminDb();
		const rows = await db
			.select({
				id: errorReports.id,
				errorMessage: errorReports.errorMessage,
				context: errorReports.context,
				createdAt: errorReports.createdAt,
				userEmail: users.email,
				userName: users.name,
			})
			.from(errorReports)
			.leftJoin(users, eq(users.id, errorReports.userId))
			.orderBy(desc(errorReports.createdAt));
		return rows;
	},
);

export const countUsers = createServerFn({ method: "GET" }).handler(
	async () => {
		await requireAdmin(await getRequestHeaders());
		const { db, users } = await adminDb();
		const [row] = await db.select({ count: sql<number>`count(*)` }).from(users);
		return Number(row?.count ?? 0);
	},
);

export const getAdminTrendMetrics = createServerFn({ method: "GET" })
	.validator((data: { days?: number } = {}) => ({
		days: Math.min(Math.max(data?.days ?? 7, 1), 90),
	}))
	.handler(async ({ data }): Promise<DailyTrendPoint[]> => {
		await requireAdmin(await getRequestHeaders());
		const { db, users, payments } = await adminDb();

		const days = data.days || 7;
		const dateSeries = buildDateRangeSeries(days);
		const now = new Date();
		const startDate = new Date(now);
		startDate.setDate(startDate.getDate() - (days - 1));
		startDate.setHours(0, 0, 0, 0);

		const [revenueRows, userRows] = await Promise.all([
			db
				.select({
					day: sql<string>`to_char(${payments.createdAt}, 'YYYY-MM-DD')`,
					total: sql<number>`coalesce(sum(${payments.amount}), 0)`,
				})
				.from(payments)
				.where(
					and(
						eq(payments.status, "success"),
						gte(payments.createdAt, startDate),
					),
				)
				.groupBy(sql`to_char(${payments.createdAt}, 'YYYY-MM-DD')`),
			db
				.select({
					day: sql<string>`to_char(${users.createdAt}, 'YYYY-MM-DD')`,
					count: sql<number>`count(*)`,
				})
				.from(users)
				.where(gte(users.createdAt, startDate))
				.groupBy(sql`to_char(${users.createdAt}, 'YYYY-MM-DD')`),
		]);

		return mergeTrendData(
			dateSeries,
			revenueRows.map((r) => ({ day: r.day, total: Number(r.total) })),
			userRows.map((u) => ({ day: u.day, count: Number(u.count) })),
		);
	});

export const listAdminTransactions = createServerFn({ method: "GET" })
	.validator(
		(
			data: {
				limit?: number;
				offset?: number;
				search?: string;
				status?: string;
				plan?: string;
			} = {},
		) => data ?? {},
	)
	.handler(
		async ({
			data,
		}): Promise<{
			transactions: AdminTransactionItem[];
			totalCount: number;
		}> => {
			await requireAdmin(await getRequestHeaders());
			const { db, payments, users } = await adminDb();

			const conditions = [];

			if (data.status && data.status !== "all") {
				conditions.push(eq(payments.status, data.status));
			}
			if (data.plan && data.plan !== "all") {
				conditions.push(eq(payments.plan, data.plan));
			}
			if (data.search?.trim()) {
				const q = `%${data.search.trim()}%`;
				conditions.push(
					or(
						ilike(payments.orderId, q),
						ilike(users.name, q),
						ilike(users.email, q),
					),
				);
			}

			const whereClause =
				conditions.length > 0 ? and(...conditions) : undefined;

			const [rows, totalResult] = await Promise.all([
				db
					.select({
						id: payments.id,
						orderId: payments.orderId,
						plan: payments.plan,
						amount: payments.amount,
						status: payments.status,
						createdAt: payments.createdAt,
						userName: users.name,
						userEmail: users.email,
					})
					.from(payments)
					.leftJoin(users, eq(users.id, payments.userId))
					.where(whereClause)
					.orderBy(desc(payments.createdAt))
					.limit(data.limit ?? 50)
					.offset(data.offset ?? 0),
				db
					.select({ count: sql<number>`count(*)` })
					.from(payments)
					.leftJoin(users, eq(users.id, payments.userId))
					.where(whereClause),
			]);

			return {
				transactions: rows.map((r) => ({
					id: r.id,
					orderId: r.orderId,
					plan: r.plan,
					amount: Number(r.amount ?? 0),
					status: r.status ?? "pending",
					userName: r.userName,
					userEmail: r.userEmail,
					createdAt: r.createdAt ? new Date(r.createdAt) : null,
				})),
				totalCount: Number(totalResult[0]?.count ?? 0),
			};
		},
	);

export const listAdminProjects = createServerFn({ method: "GET" })
	.validator(
		(
			data: {
				limit?: number;
				offset?: number;
				search?: string;
				step?: string;
			} = {},
		) => data ?? {},
	)
	.handler(
		async ({
			data,
		}): Promise<{ projects: AdminProjectItem[]; totalCount: number }> => {
			await requireAdmin(await getRequestHeaders());
			const { db, projects, users } = await adminDb();

			const conditions = [];

			if (data.step && data.step !== "all") {
				conditions.push(eq(projects.step, data.step));
			}
			if (data.search?.trim()) {
				const q = `%${data.search.trim()}%`;
				conditions.push(
					or(
						ilike(projects.name, q),
						ilike(projects.description, q),
						ilike(users.name, q),
						ilike(users.email, q),
					),
				);
			}

			const whereClause =
				conditions.length > 0 ? and(...conditions) : undefined;

			const [rows, totalResult] = await Promise.all([
				db
					.select({
						id: projects.id,
						name: projects.name,
						description: projects.description,
						status: projects.status,
						step: projects.step,
						acStatus: projects.acStatus,
						taskStatus: projects.taskStatus,
						userId: projects.userId,
						createdAt: projects.createdAt,
						userName: users.name,
						userEmail: users.email,
					})
					.from(projects)
					.leftJoin(users, eq(users.id, projects.userId))
					.where(whereClause)
					.orderBy(desc(projects.createdAt))
					.limit(data.limit ?? 50)
					.offset(data.offset ?? 0),
				db
					.select({ count: sql<number>`count(*)` })
					.from(projects)
					.leftJoin(users, eq(users.id, projects.userId))
					.where(whereClause),
			]);

			return {
				projects: rows.map((p) => ({
					...p,
					createdAt: p.createdAt ? new Date(p.createdAt) : null,
				})),
				totalCount: Number(totalResult[0]?.count ?? 0),
			};
		},
	);
