import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { CODEBASE_CLI_VERSION } from "./sync-client.js";
import { CLI_VERSION } from "./version.js";

describe("CLI version single source", () => {
	it("matches the package.json version field", () => {
		const require = createRequire(import.meta.url);
		const pkg = require("../../package.json") as { version: string };
		expect(CLI_VERSION).toBe(pkg.version);
		expect(CODEBASE_CLI_VERSION).toBe(pkg.version);
		expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
	});
});
