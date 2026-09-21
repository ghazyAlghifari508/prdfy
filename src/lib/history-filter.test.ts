import { expect, test } from "vitest";
import { filterHistory, paginate } from "@/lib/history-filter";

const items = [
	{
		id: "1",
		name: "Toko Online",
		step: "prd",
		preview: "marketplace",
		updatedAt: new Date(),
	},
	{
		id: "2",
		name: "Habit Tracker",
		step: "ac",
		preview: "habit",
		updatedAt: new Date(),
	},
];
test("filter by query", () => {
	expect(filterHistory(items as any, "toko", null)).toHaveLength(1);
});
test("filter ignores surrounding whitespace in the query", () => {
	expect(filterHistory(items as any, "  toko  ", null)).toHaveLength(1);
});
test("filter by step", () => {
	expect(filterHistory(items as any, "", "ac")).toHaveLength(1);
});
test("paginate", () => {
	expect(paginate(items as any, 1, 1)).toHaveLength(1);
});
test("paginate normalizes invalid page and size", () => {
	expect(paginate(items as any, 0, 0)).toHaveLength(2);
	expect(paginate(items as any, -1, -5)).toHaveLength(2);
	expect(paginate(items as any, 1.5, 1.5)).toHaveLength(2);
	expect(paginate(items as any, 2, 1)).toHaveLength(1);
});
