/**
 * Single source for the CLI version: read from the package `version` field
 * so `prdfy --version` and the sync handshake floor can never drift apart.
 * Resolved relative to this module, so it works from both `src/` (vitest)
 * and `dist/` (built/published CLI).
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version?: unknown };

if (typeof pkg.version !== "string" || pkg.version.trim().length === 0) {
	throw new Error("Invalid or missing CLI version in package.json");
}

/** Current CLI version (mirrors `packages/cli/package.json`). */
export const CLI_VERSION: string = pkg.version;
