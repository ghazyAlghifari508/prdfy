import { describe, expect, it } from "vitest";
import {
	askHandoffSchema,
	sanitizeAskHandoff,
	sanitizeAskHandoffState,
} from "@/lib/codebase-generation-context";

describe("Ask handoff restore logic", () => {
	it("restores greenfield in-flight state with partial answers", () => {
		const parsed = askHandoffSchema.safeParse({
			projectId: "greenfield_1",
			state: {
				prompt: "Aplikasi invoice otomatis",
				platform: "web",
				session: 1,
				questions: [
					{
						id: "q1",
						question: "Siapa target pengguna?",
						type: "select",
						options: ["Freelancer", "UMKM", "Enterprise"],
					},
				],
				nonTechAnswers: {
					q1: { value: "Freelancer", isCustom: false, skipped: false },
				},
				techAnswers: {
					frontend: "Next.js",
				},
				skippedTech: [],
			},
		});

		expect(parsed.success).toBe(true);
		if (parsed.success) {
			const clean = sanitizeAskHandoff(parsed.data);
			expect(clean.state?.prompt).toBe("Aplikasi invoice otomatis");
			expect(clean.state?.questions?.length).toBe(1);
			expect(clean.state?.nonTechAnswers?.q1?.value).toBe("Freelancer");
			expect(clean.state?.techAnswers?.frontend).toBe("Next.js");
		}
	});

	it("handles legacy project fallback without questions", () => {
		const legacyState = sanitizeAskHandoffState({
			prompt: "Midtrans Laporan Export PDF",
			platform: "web",
			session: 1,
			questions: [],
		});

		expect(legacyState.prompt).toBe("Midtrans Laporan Export PDF");
		expect(legacyState.questions).toEqual([]);
		expect(legacyState.session).toBe(1);
	});
});
