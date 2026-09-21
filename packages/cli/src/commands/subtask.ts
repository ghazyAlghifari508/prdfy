/**
 * prdfy subtask update
 */

import chalk from "chalk";
import { apiPost } from "../lib/api-client.js";

export async function subtaskUpdateCommand(
	taskId: string,
	options: { index: string; status: string },
) {
	try {
		const subtaskIndex = Number(options.index);
		if (
			!/^\d+$/.test(options.index || "") ||
			!Number.isSafeInteger(subtaskIndex) ||
			subtaskIndex < 0
		) {
			console.log(chalk.red("Error: --index harus angka non-negatif."));
			process.exit(1);
		}

		const result = await apiPost<{
			taskId: string;
			subtaskIndex: number;
			status: string;
		}>(`/api/v1/subtasks/${encodeURIComponent(taskId)}/status`, {
			subtaskIndex,
			status: options.status,
		});
		console.log(
			chalk.green(
				`✓ Subtask [${result.subtaskIndex}] di task ${result.taskId} → ${result.status}`,
			),
		);
	} catch (err) {
		console.error(
			chalk.red(`Error: ${err instanceof Error ? err.message : err}`),
		);
		process.exit(1);
	}
}
