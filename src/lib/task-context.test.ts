import { describe, expect, it } from "vitest";
import { buildTaskPrdContext } from "./task-context";

const PRD = [
	"# PRD - Demo",
	"",
	"## 3. Requirements",
	"#### FR-01 · Checkout",
	"- Keranjang menyimpan item.",
	"",
	"## 4. Core Features",
	"### 4.1 Checkout multi-langkah",
	"Deskripsi fitur yang mendefinisikan scope produk.",
	"",
	"## 5. User Flow",
	"User membuka keranjang lalu membayar.",
	"",
	"## 6. Architecture & Tech Stack",
	"| Layer | Technology |",
	"| Database | PostgreSQL |",
	"",
	"## 7. Database Schema",
	"orders(id, total)",
].join("\n");

describe("buildTaskPrdContext", () => {
	it("injects the whole PRD without dropping sections", () => {
		const block = buildTaskPrdContext(PRD);
		expect(block).toContain("FR-01");
		expect(block).toContain("Checkout multi-langkah");
		expect(block).toContain("PostgreSQL");
		expect(block).toContain("orders(id, total)");
		expect(block).toContain("User membuka keranjang");
	});

	it("frames the PRD so the model knows it is product context", () => {
		const block = buildTaskPrdContext(PRD);
		expect(block).toContain("--- PRD (PRODUCT CONTEXT");
		expect(block).toContain("--- END PRD ---");
	});

	it("returns an empty string for an empty or whitespace-only PRD", () => {
		expect(buildTaskPrdContext("")).toBe("");
		expect(buildTaskPrdContext("   \n  \n")).toBe("");
	});

	it("preserves a non-standard PRD without headings", () => {
		const block = buildTaskPrdContext("Isi PRD tanpa heading.");
		expect(block).toContain("Isi PRD tanpa heading.");
	});
});
