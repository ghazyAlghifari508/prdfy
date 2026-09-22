import { describe, expect, it } from "vitest";
import {
	buildCoverageReport,
	canonicalAcId,
	extractAcIds,
	extractReferencedAcIds,
} from "./ac-coverage";

describe("extractAcIds", () => {
	it("collects identifiers declared by headings, in document order", () => {
		const ac = [
			"# Acceptance Criteria - Demo",
			"",
			"## 1. Fitur Satu (FR-01)",
			"### AC-1.1 Judul Pertama",
			"Prosa testable.",
			"### AC-1.2 Judul Kedua",
			"## 2. Fitur Dua (FR-02)",
			"### AC-2.1 Judul Ketiga",
		].join("\n");
		expect(extractAcIds(ac)).toEqual(["AC-1.1", "AC-1.2", "AC-2.1"]);
	});

	it("ignores identifiers that only appear in prose", () => {
		const ac = [
			"## 1. Fitur Satu",
			"### AC-1.1 Judul",
			"Skenario ini melengkapi AC-1.9 yang dibahas di dokumen lain.",
		].join("\n");
		expect(extractAcIds(ac)).toEqual(["AC-1.1"]);
	});

	it("deduplicates repeated headings and handles multi-digit sections", () => {
		const ac = [
			"### AC-1.1 A",
			"### AC-1.1 A",
			"### AC-12.3 B",
			"### AC-12.4 C",
		].join("\n");
		expect(extractAcIds(ac)).toEqual(["AC-1.1", "AC-12.3", "AC-12.4"]);
	});

	it("returns an empty list for a document with no identifiers", () => {
		expect(extractAcIds("## Fitur tanpa penomoran\nProsa saja.")).toEqual([]);
		expect(extractAcIds("")).toEqual([]);
	});
});

describe("extractReferencedAcIds", () => {
	it("collects identifiers anywhere in the text", () => {
		expect(extractReferencedAcIds("lihat AC-1.1, ac-1.2, dan AC-3.4")).toEqual([
			"AC-1.1",
			"AC-1.2",
			"AC-3.4",
		]);
	});

	it("normalizes case and de-duplicates", () => {
		expect(extractReferencedAcIds("AC-2.1 ac-2.1 AC-2.1")).toEqual(["AC-2.1"]);
	});
});

describe("canonicalAcId", () => {
	it("uppercases identifiers", () => {
		expect(canonicalAcId("ac-1.1")).toBe("AC-1.1");
	});
});

describe("buildCoverageReport", () => {
	const defined = ["AC-1.1", "AC-1.2", "AC-2.1"];

	it("accepts complete coverage", () => {
		const report = buildCoverageReport({
			defined,
			declared: ["AC-1.1", "AC-1.2", "AC-2.1"],
		});
		expect(report.complete).toBe(true);
		expect(report.missing).toEqual([]);
		expect(report.unknown).toEqual([]);
		expect(report.covered).toEqual(defined);
	});

	it("reports missing requirements", () => {
		const report = buildCoverageReport({ defined, declared: ["AC-1.1"] });
		expect(report.complete).toBe(false);
		expect(report.missing).toEqual(["AC-1.2", "AC-2.1"]);
	});

	it("reports references to requirements that do not exist", () => {
		const report = buildCoverageReport({
			defined,
			declared: ["AC-1.1", "AC-1.2", "AC-2.1", "AC-9.9"],
		});
		expect(report.complete).toBe(false);
		expect(report.unknown).toEqual(["AC-9.9"]);
	});

	it("treats duplicate coverage as one covered requirement", () => {
		const report = buildCoverageReport({
			defined,
			declared: ["AC-1.1", "AC-1.1", "ac-1.2", "AC-2.1"],
		});
		expect(report.complete).toBe(true);
		expect(report.covered).toEqual(defined);
	});

	it("matches identifiers case-insensitively", () => {
		const report = buildCoverageReport({
			defined: ["ac-1.1"],
			declared: ["AC-1.1"],
		});
		expect(report.complete).toBe(true);
	});

	it("flags every requirement when nothing is declared", () => {
		const report = buildCoverageReport({ defined, declared: [] });
		expect(report.complete).toBe(false);
		expect(report.missing).toEqual(defined);
	});

	it("is complete for a document with no requirements and no claims", () => {
		const report = buildCoverageReport({ defined: [], declared: [] });
		expect(report.complete).toBe(true);
	});

	it("preserves defined order in covered and missing", () => {
		const report = buildCoverageReport({
			defined: ["AC-3.1", "AC-1.1", "AC-2.1"],
			declared: ["AC-2.1", "AC-3.1"],
		});
		expect(report.covered).toEqual(["AC-3.1", "AC-2.1"]);
		expect(report.missing).toEqual(["AC-1.1"]);
	});
});
