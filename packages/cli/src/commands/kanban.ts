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

export async function kanbanCommand(projectId: string) {
	try {
		const data = await apiGet<{ columns: KanbanColumns }>(
			`/api/v1/projects/${encodeURIComponent(projectId)}/kanban`,
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

		const sanitizeName = (name: string) =>
			Array.from(name)
				.filter((ch) => {
					const code = ch.charCodeAt(0);
					return code >= 32 && code !== 127 && code !== 0x1b && code !== 0x9b;
				})
				.join("");
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
				? chalk.gray(pad(sanitizeName(p.name).slice(0, 20), 20))
				: chalk.gray(pad("", 20));
			const ipName = ip
				? chalk.blue(pad(sanitizeName(ip.name).slice(0, 20), 20))
				: chalk.gray(pad("", 20));
			const cName = c
				? chalk.green(pad(sanitizeName(c.name).slice(0, 20), 20))
				: chalk.gray(pad("", 20));
			const fName = f
				? chalk.red(pad(sanitizeName(f.name).slice(0, 20), 20))
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
