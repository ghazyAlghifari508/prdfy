// Server-only sync helpers (imports node:crypto).
//
// Never import this module from client/isomorphic code: `codebase-sync.ts`
// stays bundle-safe (Zod + pure helpers only) while credential hashing lives
// here. Route handlers import this file directly.

import { createHash, randomBytes } from "node:crypto";

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
