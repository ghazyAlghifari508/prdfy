/**
 * prdfy ac <projectId> — fetch and print Acceptance Criteria content
 */

import chalk from "chalk";
import { apiGet } from "../lib/api-client.js";

interface AcResponse {
	projectId: string;
	content: string;
	version: number;
}

export async function acCommand(projectId: string) {
	try {
		const data = await apiGet<AcResponse>(
			`/api/v1/projects/${encodeURIComponent(projectId)}/ac`,
		);
		console.log(chalk.bold(`\nAcceptance Criteria (v${data.version}):\n`));
		console.log(data.content);
		console.log();
	} catch (err) {
		console.error(
			chalk.red(`Error: ${err instanceof Error ? err.message : err}`),
		);
		process.exit(1);
	}
}
