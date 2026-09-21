/**
 * prdfy project get — print project data as JSON
 */

import chalk from "chalk";
import { apiGet } from "../lib/api-client.js";

export async function projectGetCommand(projectId: string) {
	try {
		const data = await apiGet<Record<string, unknown>>(
			`/api/v1/projects/${encodeURIComponent(projectId)}`,
		);
		console.log(JSON.stringify(data, null, 2));
	} catch (err) {
		console.error(
			chalk.red(`Error: ${err instanceof Error ? err.message : err}`),
		);
		process.exit(1);
	}
}
