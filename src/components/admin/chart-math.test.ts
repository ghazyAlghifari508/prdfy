import { describe, expect, it } from "vitest";
import {
	calculateYScale,
	generateAreaPath,
	generateSplinePath,
} from "./chart-math";

describe("Chart Geometry Math", () => {
	it("generates smooth SVG cubic bezier path string", () => {
		const points = [
			{ x: 0, y: 100 },
			{ x: 50, y: 50 },
			{ x: 100, y: 0 },
		];
		const path = generateSplinePath(points);
		expect(path).toContain("M 0 100");
		expect(path).toContain("C");
	});

	it("generates closed SVG area path for gradient fill", () => {
		const points = [
			{ x: 0, y: 100 },
			{ x: 100, y: 50 },
		];
		const area = generateAreaPath(points, 200);
		expect(area).toContain("M 0 100");
		expect(area).toContain("L 100 200");
		expect(area).toContain("L 0 200 Z");
	});

	it("calculates balanced Y-axis scale and tick marks with safe minimum ceil", () => {
		const scaleInfo = calculateYScale([0, 150000, 299700], 200, 20, 30);
		expect(scaleInfo.ticks).toHaveLength(5);
		expect(scaleInfo.ticks[0]).toBe(0);
		expect(scaleInfo.ticks[4]).toBeGreaterThanOrEqual(300000);
		expect(scaleInfo.scale(0)).toBe(170); // 200 - 30
		expect(scaleInfo.scale(scaleInfo.ticks[4])).toBe(20);
	});

	it("handles edge cases: single point and empty points in spline", () => {
		expect(generateSplinePath([])).toBe("");
		expect(generateSplinePath([{ x: 10, y: 20 }])).toBe("M 10 20");
		expect(generateAreaPath([{ x: 10, y: 20 }], 200)).toBe("");
	});

	it("handles zero values with fallback minCeil", () => {
		const scaleInfo = calculateYScale([0, 0, 0], 200, 20, 30, 4);
		expect(scaleInfo.ticks).toEqual([0, 1, 2, 3, 4]);
		expect(scaleInfo.scale(0)).toBe(170);
		expect(scaleInfo.scale(4)).toBe(20);
	});

	it("filters non-finite points in spline path", () => {
		const points = [
			{ x: 0, y: 100 },
			{ x: Number.NaN, y: 50 },
			{ x: 100, y: Number.POSITIVE_INFINITY },
			{ x: 50, y: 50 },
		];
		const path = generateSplinePath(points);
		expect(path).not.toContain("NaN");
		expect(path).not.toContain("Infinity");
	});

	it("safely handles large datasets and non-finite values in calculateYScale", () => {
		const large = Array.from({ length: 20_000 }, (_, i) =>
			i % 2 === 0 ? i : Number.NaN,
		);
		const scaleInfo = calculateYScale(large, 200, 20, 30);
		expect(scaleInfo.ticks[4]).toBeGreaterThan(10000);
	});
});
