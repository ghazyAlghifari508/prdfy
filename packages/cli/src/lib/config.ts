/**
 * Config reader/writer for ~/.prdfy/config
 * Falls back to legacy ~/.novaplan/config for existing installs.
 */

import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
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
		const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		const conf: CliConfig = {};
		const obj = parsed as Record<string, unknown>;
		if (typeof obj.apiKey === "string" && obj.apiKey.trim().length > 0) {
			conf.apiKey = obj.apiKey.trim();
		}
		if (typeof obj.apiUrl === "string" && obj.apiUrl.trim().length > 0) {
			conf.apiUrl = obj.apiUrl.trim();
		}
		return conf;
	} catch {
		return {};
	}
}

export function saveConfig(config: CliConfig): void {
	try {
		if (!existsSync(CONFIG_DIR)) {
			mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
		}
	} catch (err) {
		throw new Error(
			`Cannot create config directory "${CONFIG_DIR}": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	const existing = getConfig();
	const payload = JSON.stringify({ ...existing, ...config }, null, 2);
	const tempFile = `${CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`;

	try {
		writeFileSync(tempFile, payload, { mode: 0o600 });
		try {
			chmodSync(tempFile, 0o600);
		} catch {}
		renameSync(tempFile, CONFIG_FILE);
		try {
			chmodSync(CONFIG_FILE, 0o600);
		} catch {}
	} catch (err) {
		try {
			if (existsSync(tempFile)) unlinkSync(tempFile);
		} catch {}
		throw new Error(
			`Cannot save config to "${CONFIG_FILE}": ${err instanceof Error ? err.message : String(err)}`,
		);
	}
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
 * in-memory to the sync client instead of `saveConfig`. Validates protocol
 * and rejects non-http/https URLs fail-closed.
 */
export function resolveApiUrl(explicit?: string): string {
	const raw = explicit || process.env.PRDFY_API_URL || getApiUrl();
	try {
		const parsed = new URL(raw);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error(
				`Invalid API URL protocol: "${parsed.protocol}". Only http: and https: are allowed.`,
			);
		}
		return parsed.origin;
	} catch (err) {
		if (
			err instanceof Error &&
			err.message.includes("Invalid API URL protocol")
		) {
			throw err;
		}
		throw new Error(`Invalid API URL: "${raw}"`);
	}
}
