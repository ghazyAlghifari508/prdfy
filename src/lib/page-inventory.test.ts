import { describe, expect, it } from "vitest";
import {
	extractPageInventory,
	findUnknownSurfaces,
	normalizePageName,
} from "./page-inventory";

const USER_FLOW_WITH_INVENTORY = [
	"<!-- SECTION: User Flow -->",
	"## 5. User Flow",
	"### 5.1 Flow Utama",
	"User membuka katalog lalu memilih produk.",
	"### 5.2 Flow Tambahan",
	"Admin memperbarui stok.",
	"### 5.3 Pages & Screens",
	"#### Product List",
	"- Tujuan: menelusuri katalog",
	"- Aktor: Customer",
	"#### Product Detail",
	"- Tujuan: melihat informasi lengkap produk",
	"#### Admin Stock Manager",
	"- Tujuan: memperbarui stok",
	"<!-- /SECTION -->",
	"",
	"<!-- SECTION: Architecture & Tech Stack -->",
	"## 6. Architecture & Tech Stack",
	"### 6.3 Struktur Folder",
	"#### src/routes",
	"#### components",
	"<!-- /SECTION -->",
].join("\n");

describe("extractPageInventory", () => {
	it("reads page names declared under Pages & Screens", () => {
		expect(extractPageInventory(USER_FLOW_WITH_INVENTORY)).toEqual([
			"Product List",
			"Product Detail",
			"Admin Stock Manager",
		]);
	});

	it("does not leak headings from other sections into the inventory", () => {
		const inventory = extractPageInventory(USER_FLOW_WITH_INVENTORY);
		expect(inventory).not.toContain("src/routes");
		expect(inventory).not.toContain("components");
		expect(inventory).not.toContain("Struktur Folder");
	});

	it("returns an empty inventory for a legacy PRD without the subsection", () => {
		const legacy = [
			"<!-- SECTION: User Flow -->",
			"## 5. User Flow",
			"### 5.1 Flow Utama",
			"User membuka katalog.",
			"### 5.2 Flow Tambahan",
			"Admin memperbarui stok.",
			"<!-- /SECTION -->",
		].join("\n");
		expect(extractPageInventory(legacy)).toEqual([]);
	});

	it("accepts an unnumbered subsection heading", () => {
		const doc = [
			"## 5. User Flow",
			"### Pages & Screens",
			"#### Checkout",
			"#### Order Confirmation",
		].join("\n");
		expect(extractPageInventory(doc)).toEqual([
			"Checkout",
			"Order Confirmation",
		]);
	});

	it("keeps a simple project at one page and a complex project at many", () => {
		const simple = [
			"### 5.3 Pages & Screens",
			"#### Landing Page",
			"- Tujuan: memperkenalkan produk",
		].join("\n");
		expect(extractPageInventory(simple)).toEqual(["Landing Page"]);

		const complexPages = Array.from(
			{ length: 24 },
			(_, i) => `#### Surface ${i + 1}`,
		);
		const complex = ["### 5.3 Pages & Screens", ...complexPages].join("\n");
		expect(extractPageInventory(complex)).toHaveLength(24);
	});

	it("strips numbering and markdown emphasis from page names", () => {
		const doc = [
			"### 5.3 Pages & Screens",
			"#### 1. Login",
			"#### 2) **Dashboard**",
			"#### `Settings`",
		].join("\n");
		expect(extractPageInventory(doc)).toEqual([
			"Login",
			"Dashboard",
			"Settings",
		]);
	});

	it("de-duplicates repeated surfaces case-insensitively", () => {
		const doc = [
			"### 5.3 Pages & Screens",
			"#### Cart",
			"#### cart",
			"#### CART",
		].join("\n");
		expect(extractPageInventory(doc)).toEqual(["Cart"]);
	});

	it("drops empty page entries instead of inventing names", () => {
		const doc = [
			"### 5.3 Pages & Screens",
			"#### ",
			"#### 1.",
			"#### Dashboard",
		].join("\n");
		expect(extractPageInventory(doc)).toEqual(["Dashboard"]);
	});

	it("stops at the end of the subsection", () => {
		const doc = [
			"### 5.3 Pages & Screens",
			"#### Login",
			"### 5.4 Catatan",
			"#### Bukan Halaman",
			"## 6. Architecture & Tech Stack",
			"#### Juga Bukan Halaman",
		].join("\n");
		expect(extractPageInventory(doc)).toEqual(["Login"]);
	});

	it("returns an empty inventory for empty input", () => {
		expect(extractPageInventory("")).toEqual([]);
	});
});

describe("normalizePageName", () => {
	it("compares names case-insensitively and ignores numbering", () => {
		expect(normalizePageName("  1. Product   List ")).toBe("product list");
		expect(normalizePageName("product list")).toBe("product list");
	});
});

describe("findUnknownSurfaces", () => {
	it("returns nothing when every surface is declared by the PRD", () => {
		expect(
			findUnknownSurfaces(
				["Product List", "product detail"],
				["Product List", "Product Detail"],
			),
		).toEqual([]);
	});

	it("reports surfaces the PRD never defines", () => {
		expect(
			findUnknownSurfaces(
				["Product List", "Random Admin Dashboard"],
				["Product List", "Product Detail"],
			),
		).toEqual(["Random Admin Dashboard"]);
	});

	it("skips validation when there is no authoritative inventory", () => {
		expect(findUnknownSurfaces(["Anything"], [])).toEqual([]);
	});

	it("ignores empty entries and reports each unknown surface once", () => {
		expect(findUnknownSurfaces(["", "  ", "Ghost", "Ghost"], ["Real"])).toEqual(
			["Ghost"],
		);
	});
});
