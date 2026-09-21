/**
 * prdfy kanban — show kanban table
 */

import chalk from "chalk";
import { apiGet } from "../lib/api-client.js";

interface TaskCard {
	id: string;
	name: string;
	status: string;
	featureName: string;
	subtaskCount: number;
	subtaskCompleted: number;
}

interface KanbanColumns {
	pending: TaskCard[];
	in_progress: TaskCard[];
	completed: TaskCard[];
	failed: TaskCard[];
}

export function sanitizeTerminalString(input: unknown): string {
	if (typeof input !== "string") return "";
	return input
		.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
		.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)?/g, "")
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

export async function kanbanCommand(projectId: string) {
	try {
		const safeProjectId = sanitizeTerminalString(projectId);
		const data = await apiGet<{ columns: KanbanColumns }>(
			`/api/v1/projects/${encodeURIComponent(safeProjectId)}/kanban`,
		);

		const cols = data?.columns;
		if (
			!cols ||
			!Array.isArray(cols.pending) ||
			!Array.isArray(cols.in_progress) ||
			!Array.isArray(cols.completed) ||
			!Array.isArray(cols.failed)
		) {
			console.log(chalk.yellow("Format data kanban tidak valid."));
			return;
		}

		const maxLen = Math.max(
			cols.pending.length,
			cols.in_progress.length,
			cols.completed.length,
			cols.failed.length,
		);

		const pad = (s: string, len: number) => s.padEnd(len);

		console.log(chalk.bold("\n  Kanban Board\n"));
		console.log(
			`  ${chalk.gray(pad("BELUM MULAI", 22))} ${chalk.gray(pad("DIKERJAKAN", 22))} ${chalk.gray(pad("SELESAI", 22))} ${chalk.gray(pad("GAGAL", 22))}`,
		);
		console.log(
			`  ${"─".repeat(22)} ${"─".repeat(22)} ${"─".repeat(22)} ${"─".repeat(22)}`,
		);

		for (let i = 0; i < maxLen; i++) {
			const p = cols.pending[i];
			const ip = cols.in_progress[i];
			const c = cols.completed[i];
			const f = cols.failed[i];

			const pName = p
				? chalk.gray(pad(sanitizeTerminalString(p.name).slice(0, 20), 20))
				: chalk.gray(pad("", 20));
			const ipName = ip
				? chalk.blue(pad(sanitizeTerminalString(ip.name).slice(0, 20), 20))
				: chalk.gray(pad("", 20));
			const cName = c
				? chalk.green(pad(sanitizeTerminalString(c.name).slice(0, 20), 20))
				: chalk.gray(pad("", 20));
			const fName = f
				? chalk.red(pad(sanitizeTerminalString(f.name).slice(0, 20), 20))
				: chalk.gray(pad("", 20));

			console.log(`  ${pName}  ${ipName}  ${cName}  ${fName}`);
		}

		console.log(
			chalk.dim(
				`\n  Counts: ${cols.pending.length} pending, ${cols.in_progress.length} active, ${cols.completed.length} done, ${cols.failed.length} failed\n`,
			),
		);
	} catch (err) {
		console.error(
			chalk.red(`Error: ${err instanceof Error ? err.message : err}`),
		);
		process.exit(1);
	}
}
