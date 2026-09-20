import {
	FEEDBACK_MAX_MESSAGE_CHARS,
	FEEDBACK_TYPES,
} from "@/lib/constants";

export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export interface FeedbackPayload {
	message: string;
	type: FeedbackType;
}

export function parseFeedbackBody(body: unknown): FeedbackPayload {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new Error("Invalid feedback payload");
	}
	const { message, type } = body as { message?: unknown; type?: unknown };
	if (typeof message !== "string") throw new Error("Invalid feedback payload");
	const trimmed = message.trim();
	if (trimmed.length === 0 || trimmed.length > FEEDBACK_MAX_MESSAGE_CHARS) {
		throw new Error("Invalid feedback payload");
	}
	if (type === undefined || type === null) return { message: trimmed, type: "general" };
	if (typeof type !== "string") throw new Error("Invalid feedback payload");
	const normalized = type.trim() as FeedbackType;
	if (!(FEEDBACK_TYPES as readonly string[]).includes(normalized)) {
		throw new Error("Invalid feedback payload");
	}
	return { message: trimmed, type: normalized };
}
