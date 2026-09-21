/**
 * prdfy task list / prdfy task update / prdfy task next
 */

import chalk from "chalk";
import { apiGet, apiPost } from "../lib/api-client.js";

interface TaskResponse {
	id: string;
	name: string;
	description: string | null;
	status: string;
	featureName: string;
	startedAt: string | null;
	completedAt: string | null;
	acContext: string | null;
	subtasks: Array<{
		name: string;
		description: string;
		status: string;
		details: string[];
	}>;
}

export async function taskListCommand(
	projectId: string,
	options: { status?: string },
) {
	try {
		const qs = options.status
			? `?status=${encodeURIComponent(options.status)}`
			: "";
		const data = await apiGet<{ tasks: TaskResponse[] }>(
			`/api/v1/projects/${encodeURIComponent(projectId)}/tasks${qs}`,
		);

		if (data.tasks.length === 0) {
			console.log(chalk.yellow("Tidak ada task ditemukan."));
			return;
		}

		console.log(chalk.bold(`\nTasks (${data.tasks.length}):\n`));
		for (const t of data.tasks) {
			const statusColor =
				t.status === "completed"
					? chalk.green
					: t.status === "in_progress"
						? chalk.blue
						: t.status === "failed"
							? chalk.red
							: chalk.gray;
			console.log(
				`  ${statusColor(t.status.padEnd(12))} ${chalk.white(t.name)} ${chalk.dim(`[${t.featureName}]`)} ${chalk.dim(`id: ${t.id.slice(0, 8)}...`)}`,
			);
			if (t.description) {
				console.log(
					`  ${chalk.dim("             ")} ${chalk.dim(t.description.slice(0, 80))}`,
				);
			}
			if (t.subtasks.length > 0) {
				for (const s of t.subtasks) {
					const sc =
						s.status === "completed"
							? chalk.green("✓")
							: s.status === "in_progress"
								? chalk.blue("●")
								: chalk.gray("○");
					console.log(`               ${sc} ${chalk.dim(s.name)}`);
				}
			}
		}
		console.log();
	} catch (err) {
		console.error(
			chalk.red(`Error: ${err instanceof Error ? err.message : err}`),
		);
		process.exit(1);
	}
}

export async function taskUpdateCommand(
	taskId: string,
	options: { status: string },
) {
	try {
		const result = await apiPost<{ id: string; status: string }>(
			`/api/v1/tasks/${encodeURIComponent(taskId)}/status`,
			{ status: options.status },
		);
		console.log(chalk.green(`✓ Task ${result.id} → ${result.status}`));
	} catch (err) {
		console.error(
			chalk.red(`Error: ${err instanceof Error ? err.message : err}`),
		);
		process.exit(1);
	}
}

export async function taskNextCommand(projectId: string) {
	try {
		const data = await apiGet<{ tasks: TaskResponse[] }>(
			`/api/v1/projects/${encodeURIComponent(projectId)}/tasks?status=pending`,
		);

		if (data.tasks.length === 0) {
			console.log(chalk.green("✓ Tidak ada task pending."));
			return;
		}

		const task = data.tasks[0];
		console.log(chalk.bold(`\nTask berikutnya:\n`));
		console.log(`  ${chalk.white("ID:")}          ${chalk.cyan(task.id)}`);
		console.log(`  ${chalk.white("Nama:")}        ${task.name}`);
		console.log(`  ${chalk.white("Fitur:")}       ${task.featureName}`);
		console.log(`  ${chalk.white("Status:")}      ${chalk.gray(task.status)}`);
		if (task.description) {
			console.log(`  ${chalk.white("Deskripsi:")}   ${task.description}`);
		}
		if (task.subtasks.length > 0) {
			console.log(`  ${chalk.white("Subtasks:")}`);
			for (let i = 0; i < task.subtasks.length; i++) {
				const s = task.subtasks[i];
				const sc =
					s.status === "completed"
						? chalk.green("✓")
						: s.status === "in_progress"
							? chalk.blue("●")
							: chalk.gray("○");
				console.log(`    ${sc} [${i}] ${s.name} ${chalk.dim(`(${s.status})`)}`);
				if (s.description) console.log(`       ${chalk.dim(s.description)}`);
			}
		}
		if (task.acContext?.trim()) {
			console.log(`  ${chalk.yellow("Acceptance Criteria:")}`);
			for (const line of task.acContext.trim().split("\n")) {
				console.log(`    ${chalk.white(line)}`);
			}
		}
		console.log();
		console.log(
			chalk.dim(`  Mulai: prdfy task update ${task.id} --status in_progress`),
		);
		console.log();
	} catch (err) {
		console.error(
			chalk.red(`Error: ${err instanceof Error ? err.message : err}`),
		);
		process.exit(1);
	}
}
