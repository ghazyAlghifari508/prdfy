/**
 * Config reader/writer for ~/.prdfy/config
 * Falls back to legacy ~/.novaplan/config for existing installs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".prdfy");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const LEGACY_CONFIG_FILE = join(homedir(), ".novaplan", "config.json");

interface CliConfig {
	apiKey?: string;
	apiUrl?: string;
}

export function getConfig(): CliConfig {
	const file = existsSync(CONFIG_FILE) ? CONFIG_FILE : LEGACY_CONFIG_FILE;
	if (!existsSync(file)) return {};
	try {
		return JSON.parse(readFileSync(file, "utf-8"));
	} catch {
		return {};
	}
}

export function saveConfig(config: CliConfig): void {
	if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
	const existing = getConfig();
	writeFileSync(
		CONFIG_FILE,
		JSON.stringify({ ...existing, ...config }, null, 2),
		{ mode: 0o600 },
	);
}

export function getApiKey(): string {
	const config = getConfig();
	if (!config.apiKey) {
		throw new Error("API key not configured. Run: prdfy login");
	}
	return config.apiKey;
}

export function getApiUrl(): string {
	return getConfig().apiUrl || "http://localhost:3000";
}

/**
 * Resolve the API base URL for a single command invocation without
 * persisting anything: explicit flag wins, then `PRDFY_API_URL`, then the
 * global config file. Sync tokens must never be stored — pass them
 * in-memory to the sync client instead of `saveConfig`.
 */
export function resolveApiUrl(explicit?: string): string {
	return explicit || process.env.PRDFY_API_URL || getApiUrl();
}
