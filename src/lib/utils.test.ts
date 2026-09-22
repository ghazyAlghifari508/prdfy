import { describe, expect, it } from "vitest";
import { cn, formatCurrency, formatDate, formatDateTime } from "./utils";

describe("cn", () => {
	it("merges class names", () => {
		expect(cn("foo", "bar")).toBe("foo bar");
	});

	it("filters falsy values", () => {
		expect(cn("foo", false, undefined, null, "bar")).toBe("foo bar");
	});

	it("returns empty string for no args", () => {
		expect(cn()).toBe("");
	});
});

describe("formatDate", () => {
	it("formats date string in Indonesian", () => {
		const result = formatDate("2026-01-15");
		expect(result).toContain("Januari");
		expect(result).toContain("2026");
	});

	// Regression: payments are stored as `timestamp without time zone` and were
	// written by both SQL now() and JS Dates, so the same event could render a
	// day late. Dates must be formatted in the project timezone regardless of
	// the host/browser timezone.
	it("renders the calendar day in Asia/Jakarta, not the host timezone", () => {
		// 2026-09-22 17:30 UTC is 2026-09-23 00:30 in Jakarta: the next day.
		const lateEveningUtc = new Date("2026-09-22T17:30:00.000Z");
		expect(formatDate(lateEveningUtc)).toBe("23 September 2026");
	});

	it("keeps a Jakarta-morning instant on the same calendar day", () => {
		// 2026-09-22 23:30 UTC is 2026-09-23 06:30 in Jakarta: still the 23rd.
		expect(formatDate(new Date("2026-09-22T23:30:00.000Z"))).toBe(
			"23 September 2026",
		);
	});

	it("does not shift an instant that is already late in Jakarta", () => {
		// 2026-09-23 16:59 UTC is 2026-09-23 23:59 in Jakarta: still the 23rd.
		expect(formatDate(new Date("2026-09-23T16:59:00.000Z"))).toBe(
			"23 September 2026",
		);
		// One minute later Jakarta rolls over to the 24th.
		expect(formatDate(new Date("2026-09-23T17:00:00.000Z"))).toBe(
			"24 September 2026",
		);
	});

	it("returns an em dash for invalid input", () => {
		expect(formatDate("not-a-date")).toBe("—");
	});
});

describe("formatDateTime", () => {
	it("includes the Jakarta time of day", () => {
		// 2026-09-22 17:30 UTC -> 00:30 on the 23rd in Jakarta.
		const result = formatDateTime(new Date("2026-09-22T17:30:00.000Z"));
		expect(result).toContain("23 September 2026");
		expect(result).toContain("00.30");
	});
});

describe("formatCurrency", () => {
	it("formats IDR", () => {
		const result = formatCurrency(25000);
		expect(result).toContain("Rp");
		expect(result).toContain("25.000");
	});

	it("formats zero", () => {
		const result = formatCurrency(0);
		expect(result).toContain("Rp");
		expect(result).toContain("0");
	});
});
