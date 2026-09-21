import { afterEach, describe, expect, it, vi } from "vitest";
import * as apiClient from "../lib/api-client.js";
import { kanbanCommand, sanitizeTerminalString } from "./kanban.js";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("sanitizeTerminalString", () => {
	it("strips ANSI color and cursor control sequences", () => {
		const raw = "\x1b[31mError Alert\x1b[0m";
		expect(sanitizeTerminalString(raw)).toBe("Error Alert");
	});

	it("strips ANSI OSC sequences", () => {
		const raw = "\x1b]0;Malicious Title\x07Clean Task";
		expect(sanitizeTerminalString(raw)).toBe("Clean Task");
	});

	it("strips control characters like newlines, tabs, and null bytes", () => {
		const raw = "Line 1\nLine 2\r\t\x00\x1f\x7fDone";
		expect(sanitizeTerminalString(raw)).toBe("Line 1Line 2Done");
	});

	it("handles non-string values gracefully", () => {
		expect(sanitizeTerminalString(null)).toBe("");
		expect(sanitizeTerminalString(undefined)).toBe("");
		expect(sanitizeTerminalString(123)).toBe("");
	});
});

describe("kanbanCommand", () => {
	it("prints a warning when kanban columns format is invalid", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(apiClient, "apiGet").mockResolvedValue({ columns: null });

		await kanbanCommand("p1");

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Format data kanban tidak valid"),
		);
	});

	it("renders task columns and count summary cleanly", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(apiClient, "apiGet").mockResolvedValue({
			columns: {
				pending: [
					{
						id: "t1",
						name: "Task \x1b[31mPending\x1b[0m",
						status: "pending",
						featureName: "Auth",
						subtaskCount: 0,
						subtaskCompleted: 0,
					},
				],
				in_progress: [],
				completed: [],
				failed: [],
			},
		});

		await kanbanCommand("p1");

		const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(logged).toContain("Kanban Board");
		expect(logged).toContain("Task Pending");
		expect(logged).toContain("1 pending");
	});
});
