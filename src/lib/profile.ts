import { PROFILE_MAX_NAME_CHARS, PROFILE_ROLES } from "@/lib/constants";

export type ProfileRole = (typeof PROFILE_ROLES)[number];

export interface ProfileUpdate {
	fullName: string;
	role: ProfileRole;
}

export function parseProfileUpdate(body: unknown): ProfileUpdate {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new Error("Invalid profile payload");
	}
	const { fullName, role } = body as { fullName?: unknown; role?: unknown };
	if (typeof fullName !== "string") throw new Error("Invalid profile payload");
	const name = fullName.trim();
	if (name.length === 0 || name.length > PROFILE_MAX_NAME_CHARS) {
		throw new Error("Invalid profile payload");
	}
	if (typeof role !== "string") throw new Error("Invalid profile payload");
	const normalized = role.trim() as ProfileRole;
	if (!(PROFILE_ROLES as readonly string[]).includes(normalized)) {
		throw new Error("Invalid profile payload");
	}
	return { fullName: name, role: normalized };
}
