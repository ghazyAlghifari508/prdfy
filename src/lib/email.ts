/**
 * Resend email wrapper — best-effort delivery (spec §7.1).
 *
 * ponytail: dynamic import keeps the SDK out of any bundle that merely type-
 * references this module, consistent with db/pg handling. Callers must treat
 * `false` as "not sent, continue anyway" — email NEVER breaks a request path.
 */

export interface SendEmailArgs {
	to: string;
	subject: string;
	html: string;
}

// Billing/account timezone: expiry dates must render deterministically,
// never in the host process timezone.
export const BILLING_TIME_ZONE = "Asia/Jakarta";

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Validated absolute application URL for email CTAs. Returns null (once
 * warned) when unset or not an absolute http(s) URL — callers then render
 * plain text instead of a broken or attacker-shaped link.
 */
export function resolveAppUrl(): string | null {
	const raw = (process.env.APP_URL || "").trim();
	if (!raw) {
		console.warn("[email] APP_URL missing — email CTAs render without links");
		return null;
	}
	try {
		const parsed = new URL(raw);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			console.warn("[email] APP_URL has non-HTTP(S) scheme — ignoring");
			return null;
		}
		return parsed.origin;
	} catch {
		console.warn("[email] APP_URL is not a valid absolute URL — ignoring");
		return null;
	}
}

function ctaLink(appUrl: string | null, path: string, label: string): string {
	if (!appUrl) return `<p>${escapeHtml(label)} di halaman billing.</p>`;
	const href = escapeHtml(`${appUrl}${path}`);
	return `<p><a href="${href}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${escapeHtml(label)}</a></p>`;
}

export async function sendEmail(args: SendEmailArgs): Promise<boolean> {
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) {
		console.warn("[email] RESEND_API_KEY missing — skipping send");
		return false;
	}
	// The resend.dev sender is a provider testing address: fine for local
	// development, but production without an explicit EMAIL_FROM would
	// silently hurt deliverability while reporting success.
	const from =
		process.env.EMAIL_FROM ||
		(process.env.NODE_ENV === "production"
			? null
			: "PrdFy <onboarding@resend.dev>");
	if (!from) {
		console.error("[email] EMAIL_FROM missing in production — skipping send");
		return false;
	}
	try {
		const { Resend } = await import("resend");
		const client = new Resend(apiKey);
		const { error } = await client.emails.send({
			from,
			to: args.to,
			subject: args.subject,
			html: args.html,
		});
		if (error) {
			console.error("[email] resend rejected:", error);
			return false;
		}
		return true;
	} catch (err) {
		console.error("[email] send failed:", err);
		return false;
	}
}

function shell(title: string, bodyHtml: string): string {
	return `<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#1f2937">
<h2 style="margin:0 0 12px">${title}</h2>
${bodyHtml}
<p style="margin-top:24px;font-size:12px;color:#6b7280">Email otomatis dari PrdFy.</p>
</div>`;
}

export function preExpiryNoticeEmail(
	planName: string,
	endDate: Date,
): { subject: string; html: string } {
	const dateLabel = endDate.toLocaleDateString("id-ID", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: BILLING_TIME_ZONE,
	});
	const safePlan = escapeHtml(planName);
	return {
		subject: `Masa aktif ${safePlan} kamu berakhir ${dateLabel}`,
		html: shell(
			`Masa aktif ${safePlan} segera berakhir`,
			`<p>Halo!</p><p>Paket <b>${safePlan}</b> kamu akan berakhir pada <b>${dateLabel}</b>. Sisa kredit bulan ini hangus setelah periode berakhir.</p>
${ctaLink(resolveAppUrl(), "/pricing", "Perpanjang sekarang")}`,
		),
	};
}

export function pausedReminderEmail(
	planName: string,
	daysLate: number,
): { subject: string; html: string } {
	const safePlan = escapeHtml(planName);
	const safeDays = Number.isSafeInteger(daysLate) ? daysLate : 0;
	return {
		subject: `Akun ${safePlan} kamu sedang pause ${safeDays} hari`,
		html: shell(
			`Langganan ${safePlan} sedang pause`,
			`<p>Sudah <b>${safeDays} hari</b> sejak masa aktif ${safePlan} berakhir. Selama pause kamu masih bisa melihat semua proyek, tapi generate terkunci.</p>
<p>Pilih salah satu: <b>perpanjang</b> untuk lanjut full workflow, atau <b>batalkan</b> untuk kembali ke paket Free.</p>
${ctaLink(resolveAppUrl(), "/settings/billing", "Kelola langganan")}`,
		),
	};
}
