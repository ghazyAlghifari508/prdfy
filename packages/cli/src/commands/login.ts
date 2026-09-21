/**
 * prdfy login — save API key to config (interactive if no --api-key flag)
 */

import { createInterface } from "node:readline";
import chalk from "chalk";
import { saveConfig } from "../lib/config.js";

function promptHidden(prompt: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const stdin = process.stdin;
		const wasRaw = stdin.isRaw;

		if (!stdin.isTTY) {
			// Non-TTY environment (piped stdin / script)
			const rl = createInterface({ input: stdin });
			rl.once("line", (line) => {
				rl.close();
				resolve(line.trim());
			});
			rl.once("error", (err) => {
				rl.close();
				reject(err);
			});
			return;
		}

		process.stdout.write(prompt);
		stdin.setRawMode(true);

		let input = "";
		const cleanup = () => {
			if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
			stdin.removeListener("data", onData);
			stdin.removeListener("end", onEnd);
			stdin.removeListener("error", onError);
		};

		const onEnd = () => {
			cleanup();
			process.stdout.write("\n");
			resolve(input);
		};

		const onError = (err: Error) => {
			cleanup();
			reject(err);
		};

		const onData = (char: Buffer) => {
			const c = char.toString();
			if (c === "\n" || c === "\r") {
				cleanup();
				process.stdout.write("\n");
				resolve(input);
			} else if (c === "\u0003") {
				// Ctrl+C
				cleanup();
				process.stdout.write("\n");
				process.exit(130);
			} else if (c === "\u007F" || c === "\b") {
				if (input.length > 0) {
					input = input.slice(0, -1);
					process.stdout.write("\b \b");
				}
			} else {
				input += c;
				process.stdout.write("*");
			}
		};
		stdin.on("data", onData);
		stdin.once("end", onEnd);
		stdin.once("error", onError);
	});
}

export async function loginCommand(options: {
	apiKey?: string;
	apiUrl?: string;
}) {
	try {
		const apiKey =
			options.apiKey ||
			process.env.PRDFY_API_KEY ||
			(await promptHidden("Masukkan API key: "));
		if (!apiKey.trim()) {
			console.log(chalk.red("API key tidak boleh kosong."));
			process.exit(1);
		}

		const rawApiUrl =
			options.apiUrl || process.env.PRDFY_API_URL || "http://localhost:3000";
		let apiUrl: string;
		try {
			const parsed = new URL(rawApiUrl);
			if (
				parsed.protocol !== "https:" &&
				parsed.hostname !== "localhost" &&
				parsed.hostname !== "127.0.0.1"
			) {
				throw new Error(
					"API URL must use HTTPS unless pointing to localhost/127.0.0.1",
				);
			}
			apiUrl = parsed.origin;
		} catch (err) {
			console.log(
				chalk.red(
					`Invalid API URL: ${err instanceof Error ? err.message : String(err)}`,
				),
			);
			process.exit(1);
		}

		saveConfig({ apiKey: apiKey.trim(), apiUrl });
		console.log(chalk.green("✓ API key berhasil disimpan."));
		console.log(chalk.dim(`Config: ~/.prdfy/config.json`));
		console.log(chalk.dim(`API URL: ${apiUrl}`));
	} catch (err) {
		console.error(
			chalk.red(`Error: ${err instanceof Error ? err.message : err}`),
		);
		process.exit(1);
	}
}
