/**
 * prdfy prd <projectId> — fetch and print PRD content
 */

import chalk from "chalk";
import { apiGet } from "../lib/api-client.js";

interface PrdResponse {
	projectId: string;
	content: string;
	version: number;
}

export async function prdCommand(projectId: string) {
	try {
		const data = await apiGet<PrdResponse>(
			`/api/v1/projects/${encodeURIComponent(projectId)}/prd`,
		);
		console.log(chalk.bold(`\nPRD (v${data.version}):\n`));
		console.log(data.content);
		console.log();
	} catch (err) {
		console.error(
			chalk.red(`Error: ${err instanceof Error ? err.message : err}`),
		);
		process.exit(1);
	}
}
