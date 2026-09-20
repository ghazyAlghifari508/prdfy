import { sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";
import { RATE_LIMIT_WINDOW_MS, RATE_LIMITS } from "@/lib/constants";

export type RateLimitAction = "ai_generate" | "api_call";

export function getRateLimitWindowStart(
	date: Date,
	windowSizeMs: number = RATE_LIMIT_WINDOW_MS,
): Date {
	return new Date(Math.floor(date.getTime() / windowSizeMs) * windowSizeMs);
}

export async function checkRateLimit(
	userId: string,
	plan: string,
	action: RateLimitAction,
): Promise<{ allowed: boolean; remaining: number }> {
	const limit =
		action === "api_call"
			? RATE_LIMITS.general
			: RATE_LIMITS[plan as keyof typeof RATE_LIMITS] || RATE_LIMITS.free;

	const windowStart = getRateLimitWindowStart(new Date());

	try {
		const [row] = await db
			.insert(rateLimits)
			.values({
				id: crypto.randomUUID(),
				userId,
				action,
				windowStart,
				count: 1,
			})
			.onConflictDoUpdate({
				target: [rateLimits.userId, rateLimits.action, rateLimits.windowStart],
				set: { count: sql`${rateLimits.count} + 1` },
				where: sql`${rateLimits.count} < ${limit}`,
			})
			.returning({ count: rateLimits.count });

		const used = row?.count ?? limit;
		return { allowed: Boolean(row), remaining: Math.max(0, limit - used) };
	} catch (error) {
		// Fail closed: DB down → don't let users bypass rate limits.
		console.error("Rate limit check error:", error);
		return { allowed: false, remaining: 0 };
	}
}
