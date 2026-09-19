import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { program } from "./index.js";

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/** Route mocked sync requests the way the Task 4–5 server boundary will. */
function stubSyncServer() {
	return vi.fn(async (url: string, init?: RequestInit) => {
		if (url.endsWith("/codebase/sync")) {
			return jsonResponse(200, {
				sessionId: "sess-1",
				attemptId: "att-1",
				status: "connected",
			});
		}
		if (url.endsWith("/codebase/manifest")) {
			return jsonResponse(200, { status: "uploading" });
		}
		if (url.endsWith("/codebase/files")) {
			return jsonResponse(200, { status: "uploading" });
		}
		if (url.endsWith("/codebase/complete")) {
			const body = JSON.parse(String(init?.body)) as {
				fileCount: number;
				excludedCount: number;
			};
			return jsonResponse(200, {
				status: "uploaded",
				fileCount: body.fileCount,
				excludedCount: body.excludedCount,
			});
		}
		throw new Error(`unexpected request in test: ${url}`);
	});
}

let repos: string[] = [];

afterEach(() => {
	for (const repo of repos) rmSync(repo, { recursive: true, force: true });
	repos = [];
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("prdfy codebase sync argv wiring", () => {
	it("maps dashed flags to camelCase action values (project-id, sync-token, api-url)", async () => {
		const root = mkdtempSync(join(tmpdir(), "prdfy-wiring-"));
		repos.push(root);
		writeFileSync(join(root, "app.ts"), "export const app = 1;\n");
		const fetchMock = stubSyncServer();
		vi.stubGlobal("fetch", fetchMock);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
			throw new Error("process.exit should not be called on success");
		}) as never);

		await program.parseAsync([
			"node",
			"prdfy",
			"codebase",
			"sync",
			"--project-id",
			"proj-wiring",
			"--sync-token",
			"wiring-test-token",
			"--root",
			root,
			"--output",
			"json",
			"--api-url",
			"http://localhost:3000",
		]);

		// With the old opts["project-id"] mapping this was INVALID_OPTIONS
		// (transport never called, exit 1). Now the handshake must run.
		expect(fetchMock).toHaveBeenCalled();
		const handshakeCall = fetchMock.mock.calls.find(([url]) =>
			String(url).endsWith("/codebase/sync"),
		);
		expect(handshakeCall).toBeDefined();
		const [url, init] = handshakeCall as [string, RequestInit];
		expect(url).toContain("/api/v1/projects/proj-wiring/codebase/sync");
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer wiring-test-token",
		);
		expect(url).not.toContain("wiring-test-token");
		expect(exitSpy).not.toHaveBeenCalled();

		const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(JSON.parse(logged)).toMatchObject({
			ok: true,
			projectId: "proj-wiring",
			sessionId: "sess-1",
		});
	});

	it("exits nonzero when the sync fails (bad repository root)", async () => {
		vi.stubGlobal("fetch", stubSyncServer());
		vi.spyOn(console, "log").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: number,
		) => {
			throw new Error(`exit:${code ?? ""}`);
		}) as never);

		await expect(
			program.parseAsync([
				"node",
				"prdfy",
				"codebase",
				"sync",
				"--project-id",
				"proj-wiring",
				"--sync-token",
				"tok",
				"--root",
				join(tmpdir(), "prdfy-does-not-exist-xyz"),
				"--api-url",
				"http://localhost:3000",
			]),
		).rejects.toThrow("exit:1");
		expect(exitSpy).toHaveBeenCalledWith(1);
	});
});
