import { describe, expect, it } from "vitest";
import {
	buildDateRangeSeries,
	formatDateKey,
	formatDateLabel,
	mergeTrendData,
} from "./admin-trend-utils";

describe("Admin Trend Utils", () => {
	it("formats date key as YYYY-MM-DD", () => {
		const d = new Date(2026, 7, 27); // Month 7 is August (0-indexed)
		expect(formatDateKey(d)).toBe("2026-08-27");
	});

	it("formats date label as DD MMM in Indonesian", () => {
		const d = new Date(2026, 7, 27);
		expect(formatDateLabel(d)).toBe("27 Agu");
	});

	it("builds a continuous date range series of length N", () => {
		const series = buildDateRangeSeries(7);
		expect(series).toHaveLength(7);
		expect(series[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(series[0].label).toBeTruthy();
		expect(series[6].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it("merges database rows into continuous series with 0-padding for missing dates", () => {
		const series = [
			{ date: "2026-08-20", label: "20 Agu" },
			{ date: "2026-08-21", label: "21 Agu" },
			{ date: "2026-08-22", label: "22 Agu" },
		];
		const revenueRows = [{ day: "2026-08-21", total: 150000 }];
		const userRows = [
			{ day: "2026-08-20", count: 2 },
			{ day: "2026-08-21", count: 5 },
		];

		const merged = mergeTrendData(series, revenueRows, userRows);
		expect(merged).toHaveLength(3);
		expect(merged[0]).toEqual({
			date: "2026-08-20",
			label: "20 Agu",
			revenue: 0,
			newUsers: 2,
		});
		expect(merged[1]).toEqual({
			date: "2026-08-21",
			label: "21 Agu",
			revenue: 150000,
			newUsers: 5,
		});
		expect(merged[2]).toEqual({
			date: "2026-08-22",
			label: "22 Agu",
			revenue: 0,
			newUsers: 0,
		});
	});

	it("handles empty database rows gracefully", () => {
		const series = [{ date: "2026-08-20", label: "20 Agu" }];
		const merged = mergeTrendData(series, [], []);
		expect(merged).toEqual([
			{
				date: "2026-08-20",
				label: "20 Agu",
				revenue: 0,
				newUsers: 0,
			},
		]);
	});

	it("throws RangeError on non-positive or excessive days in buildDateRangeSeries", () => {
		expect(() => buildDateRangeSeries(0)).toThrow(RangeError);
		expect(() => buildDateRangeSeries(-5)).toThrow(RangeError);
		expect(() => buildDateRangeSeries(400)).toThrow(RangeError);
		expect(() => buildDateRangeSeries(Number.NaN)).toThrow(RangeError);
	});

	it("aggregates duplicate date rows and safely skips non-finite values", () => {
		const series = [{ date: "2026-08-20", label: "20 Agu" }];
		const revenueRows = [
			{ day: "2026-08-20", total: 100000 },
			{ day: "2026-08-20", total: 50000 },
			{ day: "2026-08-20", total: Number.NaN },
		];
		const userRows = [
			{ day: "2026-08-20", count: 2 },
			{ day: "2026-08-20", count: 3 },
		];
		const merged = mergeTrendData(series, revenueRows, userRows);
		expect(merged[0].revenue).toBe(150000);
		expect(merged[0].newUsers).toBe(5);
	});
});
