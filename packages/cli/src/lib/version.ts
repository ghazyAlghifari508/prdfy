/**
 * Single source for the CLI version: read from the package `version` field
 * so `prdfy --version` and the sync handshake floor can never drift apart.
 * Resolved relative to this module, so it works from both `src/` (vitest)
 * and `dist/` (built/published CLI).
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version?: string };

/** Current CLI version (mirrors `packages/cli/package.json`). */
export const CLI_VERSION: string = pkg.version ?? "0.0.0";
