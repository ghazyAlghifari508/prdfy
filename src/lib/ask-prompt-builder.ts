export interface TechAnswers {
	frontend?: string;
	backend?: string;
	fullstackFramework?: string;
	database?: string;
	deployment?: string;
}

export interface NonTechQuestionLine {
	question: string;
	answer?: string;
	skipped?: boolean;
}

export interface BuildCompiledAskPromptParams {
	platform: "web" | "mobile";
	language: "id" | "en";
	rawPrompt: string;
	nonTechQuestions: NonTechQuestionLine[];
	techAnswers: TechAnswers;
	skippedTech?: Set<string> | string[];
}

/**
 * Builds the compiled prompt transferred from Ask-flow into PRD generation.
 * Distinguishes intentional unselected fields (e.g. Frontend-only with no backend/DB)
 * from explicit "Let AI decide" requests.
 */
export function buildCompiledAskPrompt(
	params: BuildCompiledAskPromptParams,
): string {
	const isEn = params.language === "en";
	const skippedSet =
		params.skippedTech instanceof Set
			? params.skippedTech
			: new Set(params.skippedTech || []);

	const aiDecide = isEn ? "Let AI decide" : "Biarkan AI yang memilih";
	const fullstackDefault = isEn
		? "Not used / Let AI decide"
		: "Tidak dipakai / Biarkan AI yang memilih";

	const hasFrontend = Boolean(params.techAnswers.frontend);
	const hasBackend = Boolean(params.techAnswers.backend);
	const hasFullstack = Boolean(params.techAnswers.fullstackFramework);
	const hasDatabase = Boolean(params.techAnswers.database);

	const backendAskedAI = skippedSet.has("backend");
	const databaseAskedAI = skippedSet.has("database");
	const frontendAskedAI = skippedSet.has("frontend");

	// An intentional Frontend-only project: user chose standalone frontend, did not choose
	// a backend, and did not explicitly delegate backend to AI.
	const isFrontendOnly =
		hasFrontend && !hasFullstack && !hasBackend && !backendAskedAI;

	let backendChoice: string;
	if (hasBackend) {
		backendChoice = params.techAnswers.backend ?? aiDecide;
	} else if (backendAskedAI) {
		backendChoice = aiDecide;
	} else if (isFrontendOnly) {
		backendChoice = isEn
			? "None (Client-side only / External APIs)"
			: "Tidak ada (Murni Frontend / Client-side)";
	} else {
		backendChoice = aiDecide;
	}

	let databaseChoice: string;
	if (hasDatabase) {
		databaseChoice = params.techAnswers.database ?? aiDecide;
	} else if (databaseAskedAI) {
		databaseChoice = aiDecide;
	} else if (isFrontendOnly) {
		databaseChoice = isEn
			? "None (Client-side state / External API)"
			: "Tidak ada (Client-side state / External API)";
	} else {
		databaseChoice = aiDecide;
	}

	let frontendChoice: string;
	if (hasFrontend) {
		frontendChoice = params.techAnswers.frontend ?? aiDecide;
	} else if (frontendAskedAI) {
		frontendChoice = aiDecide;
	} else if (hasBackend && !hasFullstack) {
		frontendChoice = isEn
			? "None (Backend / API Service Only)"
			: "Tidak ada (Layanan Backend / API Saja)";
	} else {
		frontendChoice = aiDecide;
	}

	let fullstackChoice: string;
	if (hasFullstack) {
		fullstackChoice = params.techAnswers.fullstackFramework ?? fullstackDefault;
	} else if (hasFrontend || hasBackend) {
		fullstackChoice = isEn ? "Not used" : "Tidak dipakai";
	} else {
		fullstackChoice = fullstackDefault;
	}

	const deploymentChoice = params.techAnswers.deployment || aiDecide;

	const skipLabel = isEn ? "(Let AI decide)" : "(Biarkan AI yang memilih)";
	const nonTechLines = params.nonTechQuestions.map((q) => {
		if (!q || q.skipped || !q.answer) return `- ${q.question}: ${skipLabel}`;
		return `- ${q.question}: ${q.answer}`;
	});

	const platformLabel = params.platform === "mobile" ? "Mobile App" : "Web App";

	if (isEn) {
		return `Please generate a PRD with the following specifications:

[Platform: ${platformLabel}]
${params.rawPrompt}

--- Non-Technical Preferences ---
${nonTechLines.join("\n")}

--- Technical Preferences ---
Frontend: ${frontendChoice}
Backend: ${backendChoice}
Fullstack Framework: ${fullstackChoice}
Database: ${databaseChoice}
Deployment: ${deploymentChoice}`;
	}

	return `Tolong buatkan PRD dengan spesifikasi berikut:

[Platform: ${platformLabel}]
${params.rawPrompt}

--- Preferensi Non-Teknis ---
${nonTechLines.join("\n")}

--- Preferensi Teknis ---
Frontend: ${frontendChoice}
Backend: ${backendChoice}
Fullstack Framework: ${fullstackChoice}
Database: ${databaseChoice}
Deployment: ${deploymentChoice}`;
}
