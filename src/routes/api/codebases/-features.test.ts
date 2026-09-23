import { describe, expect, it } from "vitest";
import {
	buildFeatureProjectValues,
	resolveAnalysisFeaturePrompt,
} from "./$codebaseId/features";

describe("buildFeatureProjectValues", () => {
	it("creates an existing-codebase project bound to the codebase", () => {
		const values = buildFeatureProjectValues({
			id: "p1",
			userId: "u1",
			name: "Wishlist",
			codebaseId: "c1",
			language: "id",
		});
		expect(values).toMatchObject({
			id: "p1",
			userId: "u1",
			name: "Wishlist",
			projectMode: "existing_codebase",
			codebaseId: "c1",
			language: "id",
			status: "draft",
		});
	});
});

describe("resolveAnalysisFeaturePrompt", () => {
	it("prefers the user's own feature prompt over the derived name", () => {
		expect(
			resolveAnalysisFeaturePrompt({
				handoffPrompt: "tambahkan algoritma rekomendasi film",
				projectName: "Movie App",
				projectId: "p1",
			}),
		).toBe("tambahkan algoritma rekomendasi film");
	});

	it("trims the stored prompt", () => {
		expect(
			resolveAnalysisFeaturePrompt({
				handoffPrompt: "  ada spasi  ",
				projectName: "Movie App",
				projectId: "p1",
			}),
		).toBe("ada spasi");
	});

	it("falls back to the project name when no prompt was stored", () => {
		expect(
			resolveAnalysisFeaturePrompt({
				handoffPrompt: null,
				projectName: "Movie App",
				projectId: "p1",
			}),
		).toBe("Movie App");
		expect(
			resolveAnalysisFeaturePrompt({
				handoffPrompt: "   ",
				projectName: "Movie App",
				projectId: "p1",
			}),
		).toBe("Movie App");
	});

	it("falls back to the project id when neither is usable", () => {
		expect(
			resolveAnalysisFeaturePrompt({
				handoffPrompt: null,
				projectName: "",
				projectId: "p1",
			}),
		).toBe("p1");
	});
});
