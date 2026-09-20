import {
	ERROR_REPORT_MAX_CONTEXT_CHARS,
	ERROR_REPORT_MAX_MESSAGE_CHARS,
} from "@/lib/constants";

export interface ErrorReportPayload {
	errorMessage: string;
	context: string | null;
}

export function parseErrorReportBody(body: unknown): ErrorReportPayload {
	if (typeof body === "undefined") {
		return { errorMessage: "Unknown error", context: null };
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new Error("Invalid error report payload");
	}
	const { error, context } = body as { error?: unknown; context?: unknown };

	let errorMessage = "Unknown error";
	if (error !== undefined && error !== null) {
		if (typeof error !== "string") throw new Error("Invalid error report payload");
		const trimmed = error.trim();
		if (trimmed.length > ERROR_REPORT_MAX_MESSAGE_CHARS) {
			throw new Error("Invalid error report payload");
		}
		if (trimmed.length > 0) errorMessage = trimmed;
	}

	let reportContext: string | null = null;
	if (context !== undefined && context !== null) {
		if (typeof context !== "string") {
			throw new Error("Invalid error report payload");
		}
		const trimmed = context.trim();
		if (trimmed.length > ERROR_REPORT_MAX_CONTEXT_CHARS) {
			throw new Error("Invalid error report payload");
		}
		reportContext = trimmed.length > 0 ? trimmed : null;
	}

	return { errorMessage, context: reportContext };
}
