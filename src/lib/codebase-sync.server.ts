// Server-only sync helpers (imports node:crypto).
//
// Never import this module from client/isomorphic code: `codebase-sync.ts`
// stays bundle-safe (Zod + pure helpers only) while credential hashing lives
// here. Route handlers import this file directly.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// === Credential hashing ===
// The server persists only the SHA-256 hex of a sync credential; the raw
// credential is exposed once in the prompt payload and never stored.

export function hashSyncToken(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

// === Credential generation ===
// Cryptographically random 256-bit credential, hex-encoded. The caller must
// persist only `hashSyncToken(raw)` and return the raw value once inside the
// `SyncPromptPayload`. Never log it or echo it in errors.

export function generateSyncToken(): string {
	return randomBytes(32).toString("hex");
}

// === Uploaded content verification (Task 5) ===
// Verifies that base64 chunk/file content hashes to the manifest SHA-256 hex.
// Strictly validates the base64 shape first (Buffer.from is lenient and would
// silently accept garbage), then compares digests in constant time. Returns
// false (never throws) on any malformed input so routes fail closed with
// SNAPSHOT_HASH_MISMATCH.

const STRICT_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/i;

export function decodeBase64ByteLength(base64Data: string): number | null {
	if (typeof base64Data !== "string" || base64Data.length === 0) return null;
	const clean = base64Data.replace(/\s+/g, "");
	if (clean.length === 0 || clean.length % 4 !== 0) return null;
	if (!STRICT_BASE64.test(clean)) return null;
	// Canonical form only: re-encode the decoded bytes and require an exact
	// match, so non-canonical encodings (e.g. "Zh==" for byte 0x66) fail
	// closed instead of silently decoding to different layers' values.
	if (Buffer.from(clean, "base64").toString("base64") !== clean) return null;
	try {
		return Buffer.from(clean, "base64").length;
	} catch {
		return null;
	}
}

export function verifyFileContentHash(
	base64Data: string,
	expectedHashHex: string,
): boolean {
	try {
		if (!SHA256_HEX.test(expectedHashHex)) return false;
		const clean = (base64Data ?? "").replace(/\s+/g, "");
		if (clean.length === 0 || clean.length % 4 !== 0) return false;
		if (!STRICT_BASE64.test(clean)) return false;
		const bytes = Buffer.from(clean, "base64");
		if (bytes.toString("base64") !== clean) return false;
		const actual = createHash("sha256").update(bytes).digest();
		const expected = Buffer.from(expectedHashHex, "hex");
		return (
			actual.length === expected.length && timingSafeEqual(actual, expected)
		);
	} catch {
		return false;
	}
}
