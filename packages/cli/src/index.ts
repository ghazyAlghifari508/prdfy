#!/usr/bin/env node

/**
 * prdfy-cli — CLI tool for PrdFy
 *
 * Usage:
 *   prdfy login [--api-key <key>] [--api-url <url>]
 *   prdfy project get <id>
 *   prdfy task list <projectId> [--status <status>]
 *   prdfy task next <projectId>
 *   prdfy task update <taskId> --status <status>
 *   prdfy subtask update <taskId> --index <subtaskIndex> --status <status>
 *   prdfy kanban <projectId>
 */

import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { acCommand } from "./commands/ac.js";
import { codebaseSyncAction } from "./commands/codebase.js";
import { exportRulesCommand } from "./commands/export.js";
import { kanbanCommand } from "./commands/kanban.js";
import { loginCommand } from "./commands/login.js";
import { prdCommand } from "./commands/prd.js";
import { projectGetCommand } from "./commands/project.js";
import { subtaskUpdateCommand } from "./commands/subtask.js";
import {
	taskListCommand,
	taskNextCommand,
	taskUpdateCommand,
} from "./commands/task.js";
import { CLI_VERSION } from "./lib/version.js";

/** Shared program instance (exported so wiring tests can parse argv). */
export const program = new Command();

program
	.name("prdfy")
	.description("CLI tool for PrdFy — manage projects and tasks from terminal")
	.version(CLI_VERSION);

// prdfy login
program
	.command("login")
	.description("Save API key to local config (interactive if no flag)")
	.option("--api-key <key>", "PrdFy API key")
	.option("--api-url <url>", "API base URL (default: http://localhost:3000)")
	.action(loginCommand);

// prdfy project
const projectCmd = program.command("project").description("Project commands");
projectCmd
	.command("get")
	.argument("<id>", "Project UUID")
	.description("Get project data as JSON")
	.action(projectGetCommand);

// prdfy prd
program
	.command("prd")
	.argument("<projectId>", "Project UUID")
	.description("Fetch and print PRD content")
	.action(prdCommand);

// prdfy ac
program
	.command("ac")
	.argument("<projectId>", "Project UUID")
	.description("Fetch and print Acceptance Criteria content")
	.action(acCommand);

// prdfy task
const taskCmd = program.command("task").description("Task commands");
taskCmd
	.command("list")
	.argument("<projectId>", "Project UUID")
	.description("List all tasks for a project")
	.option(
		"--status <status>",
		"Filter by status (pending/in_progress/completed/failed)",
	)
	.action(taskListCommand);
taskCmd
	.command("next")
	.argument("<projectId>", "Project UUID")
	.description("Show next pending task with details")
	.action(taskNextCommand);
taskCmd
	.command("update")
	.argument("<taskId>", "Task UUID")
	.description("Update task status")
	.requiredOption(
		"--status <status>",
		"New status (pending/in_progress/completed/failed)",
	)
	.action(taskUpdateCommand);

// prdfy subtask
const subtaskCmd = program.command("subtask").description("Subtask commands");
subtaskCmd
	.command("update")
	.argument("<taskId>", "Parent task UUID")
	.description("Update subtask status")
	.requiredOption("--index <index>", "Subtask index (0-based)")
	.requiredOption(
		"--status <status>",
		"New status (pending/in_progress/completed/failed)",
	)
	.action(subtaskUpdateCommand);

// prdfy kanban
program
	.command("kanban")
	.argument("<projectId>", "Project UUID")
	.description("Show kanban board in terminal")
	.action(kanbanCommand);

// prdfy codebase
const codebaseCmd = program
	.command("codebase")
	.description("Codebase commands");
codebaseCmd
	.command("sync")
	.description("Sync a filtered local repository snapshot to PrdFy")
	.requiredOption("--project-id <id>", "Project UUID")
	.requiredOption(
		"--sync-token <token>",
		"Project-scoped sync token (passed in memory, never stored)",
	)
	.option("--root <path>", "Repository root (default: current directory)")
	.option("--output <mode>", "Output mode (human|json)", "human")
	.option("--api-url <url>", "API base URL")
	.action(codebaseSyncAction);

// prdfy export
const exportCmd = program
	.command("export")
	.description("Export project artifacts");
exportCmd
	.command("rules")
	.argument("<projectId>", "Project UUID")
	.description(
		"Generate agent rules file with PRD stack + AC (--format agents writes AGENTS.md)",
	)
	.option("--format <format>", "Output format (agents|claude|cursor)")
	.action(exportRulesCommand);

// Parse only when executed as the CLI entrypoint; importing this module
// (e.g. wiring tests) must not consume the importer's argv.
const invokedAsMain =
	typeof process.argv[1] === "string" &&
	import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) {
	program.parse(process.argv);
}
