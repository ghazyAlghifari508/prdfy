/**
 * Pure selection of who should receive a billing email right now (spec §7.2).
 * ponytail: no db imports — the cron endpoint (Task 13) fetches candidates and
 * delegates ALL timing decisions here so the schedule is unit-testable.
 */
import {
	PRE_EXPIRY_NOTICE_DAYS,
	REMINDER_SCHEDULE_DAYS,
} from "@/lib/constants";

export interface BillingCandidateRow {
	userId: string;
	email: string;
	plan: string;
	currentPeriodEnd: Date;
	reminderCount: number;
}

export type PaidPlan = "pro" | "hengker";

export type BillingEmailTarget =
	| { userId: string; email: string; plan: PaidPlan; kind: "pre_expiry" }
	| {
			userId: string;
			email: string;
			plan: PaidPlan;
			kind: "paused_reminder";
			daysLate: number;
	  };

const DAY_MS = 24 * 60 * 60 * 1000;

function asPaidPlan(plan: string): PaidPlan | null {
	return plan === "pro" || plan === "hengker" ? plan : null;
}

/**
 * Counter contract (single writer: /api/cron/billing, atomic claim per
 * send): `reminderCount` counts consumed reminder stages. 0 = none sent.
 * The pre-expiry notice consumes stage 0, so post-expiry indexing subtracts
 * one: count 1 → first post-expiry stage, count 0 post-expiry (pre-expiry
 * never due/sent) → also the first post-expiry stage, never a later one.
 */
export function selectBillingEmailTargets(
	rows: BillingCandidateRow[],
	now: Date,
): BillingEmailTarget[] {
	const targets: BillingEmailTarget[] = [];

	for (const row of rows) {
		const plan = asPaidPlan(row.plan);
		const end = row.currentPeriodEnd;
		if (!plan || end == null) continue; // free rows & legacy grandfathered never email

		if (now.getTime() <= end.getTime()) {
			const msLeft = end.getTime() - now.getTime();
			if (
				row.reminderCount === 0 &&
				msLeft <= PRE_EXPIRY_NOTICE_DAYS * DAY_MS
			) {
				targets.push({
					userId: row.userId,
					email: row.email,
					plan,
					kind: "pre_expiry",
				});
			}
			continue;
		}

		const daysLate = Math.floor((now.getTime() - end.getTime()) / DAY_MS);
		const sentPostExpiry = Math.max(
			0,
			Math.min(row.reminderCount - 1, REMINDER_SCHEDULE_DAYS.length),
		);
		if (
			sentPostExpiry < REMINDER_SCHEDULE_DAYS.length &&
			daysLate >= REMINDER_SCHEDULE_DAYS[sentPostExpiry]
		) {
			targets.push({
				userId: row.userId,
				email: row.email,
				plan,
				kind: "paused_reminder",
				daysLate,
			});
		}
	}

	return targets;
}
