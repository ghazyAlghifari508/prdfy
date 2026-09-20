export function getSafeRedirectPath(value: unknown): string {
	if (typeof value !== "string" || !value.startsWith("/")) return "/";
	if (value.startsWith("//") || value.includes("\\")) return "/";
	const schemeSeparator = value.indexOf(":");
	if (schemeSeparator > 0 && schemeSeparator < value.indexOf("/")) return "/";
	try {
		const parsed = new URL(value, "https://prdfy.local");
		if (parsed.origin !== "https://prdfy.local") return "/";
	} catch {
		return "/";
	}
	return value;
}
