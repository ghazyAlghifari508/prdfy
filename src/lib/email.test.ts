import { describe, expect, it, vi } from "vitest";
import {
	pausedReminderEmail,
	preExpiryNoticeEmail,
	resolveAppUrl,
} from "./email";

describe("email template safety", () => {
	it("escapes plan names in subject and body", () => {
		const evil = 'pro"><script>alert(1)</script>';
		const { subject, html } = preExpiryNoticeEmail(
			evil,
			new Date("2026-03-02T00:00:00Z"),
		);
		expect(subject).not.toContain("<script>");
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});

	it("renders the WIB calendar date regardless of host timezone", () => {
		// 2026-03-01 18:00 UTC is 2026-03-02 01:00 WIB.
		const { subject } = preExpiryNoticeEmail(
			"pro",
			new Date("2026-03-01T18:00:00Z"),
		);
		expect(subject).toContain("2 Maret 2026");
	});

	it("omits links when APP_URL is missing or invalid", () => {
		vi.stubEnv("APP_URL", "");
		expect(resolveAppUrl()).toBeNull();
		expect(preExpiryNoticeEmail("pro", new Date()).html).not.toContain(
			"<a href=",
		);
		vi.stubEnv("APP_URL", "javascript:alert(1)");
		expect(resolveAppUrl()).toBeNull();
		vi.stubEnv("APP_URL", "https://prdfy.example/");
		expect(resolveAppUrl()).toBe("https://prdfy.example");
		expect(
			pausedReminderEmail("pro", 3).html,
		).toContain('href="https://prdfy.example/settings/billing"');
		vi.unstubAllEnvs();
	});
});
