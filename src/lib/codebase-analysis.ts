import { z } from "zod";

// === Codebase analysis (validated advisory output) ===
// The analysis is advisory: uncertain detections must stay labeled as
// uncertainty/verification items and must never be presented as fact.

export const codebaseAnalysisFindingSchema = z.object({
	title: z.string().min(1),
	detail: z.string().min(1),
	uncertainty: z.string().min(1).optional(),
	relevantPaths: z.array(z.string().min(1)).optional(),
});

export type CodebaseAnalysisFinding = z.infer<
	typeof codebaseAnalysisFindingSchema
>;

export const codebaseAnalysisSchema = z.object({
	projectId: z.string().min(1),
	snapshotId: z.string().min(1),
	framework: z.string().min(1).optional(),
	language: z.string().min(1).optional(),
	packageManager: z.string().min(1).optional(),
	dependencies: z.array(z.string().min(1)).optional(),
	database: z.string().min(1).nullable().optional(),
	auth: z.string().min(1).nullable().optional(),
	moduleMap: z
		.array(
			z.object({
				path: z.string().min(1),
				summary: z.string().min(1),
			}),
		)
		.optional(),
	relevantFiles: z.array(z.string().min(1)).optional(),
	impactAreas: z.array(z.string().min(1)).optional(),
	limitations: z.array(z.string().min(1)).optional(),
	findings: z.array(codebaseAnalysisFindingSchema).optional(),
});

export type CodebaseAnalysis = z.infer<typeof codebaseAnalysisSchema>;

export function parseCodebaseAnalysis(input: unknown): CodebaseAnalysis {
	return codebaseAnalysisSchema.parse(input);
}

export function safeParseCodebaseAnalysis(input: unknown) {
	return codebaseAnalysisSchema.safeParse(input);
}
