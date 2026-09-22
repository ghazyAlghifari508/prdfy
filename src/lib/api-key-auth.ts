/**
 * API Key auth for /api/v1/* routes. Bearer token → SHA-256 hash → lookup in
 * api_keys. Schema: `key` (hash) col, `scopes` text[].
 */
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, projects } from "@/db/schema";

export interface ApiKeyAuthResult {
	userId: string;
	scopes: string[];
	keyId: string;
}

export interface ApiKeyAuthError {
	error: string;
	status: 401 | 403 | 429;
}

export async function apiKeyAuth(
	req: Request,
): Promise<ApiKeyAuthResult | ApiKeyAuthError> {
	const authHeader = req.headers.get("Authorization");
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return {
			error: "Missing or invalid Authorization header. Use: Bearer <api_key>",
			status: 401,
		};
	}
	const rawKey = authHeader.slice(7).trim();
	if (!rawKey) return { error: "API key required", status: 401 };

	const keyHash = createHash("sha256").update(rawKey).digest("hex");
	// Brute-force throttle before the DB lookup, bucketed by key
	// fingerprint (the full hash never leaves this function). Fail-closed
	// like the shared limiter: a limiter outage denies auth, exactly as the
	// key lookup itself would when the database is unreachable.
	const { checkRateLimit } = await import("@/lib/rate-limit");
	const throttled = await checkRateLimit(
		`apikey:${keyHash.slice(0, 16)}`,
		"free",
		"api_key_auth",
	);
	if (!throttled.allowed) {
		return { error: "Too many authentication attempts", status: 429 };
	}
	const [keyRecord] = await db
		.select({
			id: apiKeys.id,
			userId: apiKeys.userId,
			scopes: apiKeys.scopes,
			expiresAt: apiKeys.expiresAt,
		})
		.from(apiKeys)
		.where(eq(apiKeys.key, keyHash))
		.limit(1);

	if (!keyRecord) return { error: "Invalid API key", status: 401 };
	if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
		return { error: "API key expired", status: 401 };
	}

	const scopes = keyRecord.scopes ?? [];

	// Non-blocking last_used_at stamp.
	db.update(apiKeys)
		.set({ lastUsedAt: new Date() })
		.where(eq(apiKeys.id, keyRecord.id))
		.catch(() => {});

	return { userId: keyRecord.userId, scopes, keyId: keyRecord.id };
}

export function hasScope(
	auth: ApiKeyAuthResult,
	requiredScope: string,
): boolean {
	return (
		auth.scopes.includes(requiredScope) ||
		auth.scopes.includes("admin") ||
		auth.scopes.includes("*")
	);
}

export async function verifyProjectOwnership(
	userId: string,
	projectId: string,
): Promise<boolean> {
	const [row] = await db
		.select({ id: projects.id })
		.from(projects)
		.where(
			and(
				eq(projects.id, projectId),
				eq(projects.userId, userId),
				// A deleted project is not operable through the CLI/public API:
				// its artifacts are purged, so the id must stop resolving.
				isNull(projects.deletedAt),
			),
		)
		.limit(1);
	return Boolean(row);
}
