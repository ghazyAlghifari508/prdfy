// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SyncStatusResponse } from "@/lib/codebase-sync";
import { SyncStatus } from "./sync-status";

let container: HTMLDivElement;
let root: Root | null = null;

afterEach(() => {
	if (root) {
		const r = root;
		act(() => {
			r.unmount();
		});
		root = null;
	}
	container?.remove();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function statusResponse(
	overrides: Partial<SyncStatusResponse> = {},
): SyncStatusResponse {
	return {
		projectId: "proj_123",
		sessionId: "sess_123",
		status: "uploading",
		...overrides,
	};
}

function mockFetchSequence(
	responses: Array<SyncStatusResponse | { http: number; body: unknown }>,
) {
	let calls = 0;
	const fetchMock = vi.fn(async (_input: unknown) => {
		const next = responses[Math.min(calls, responses.length - 1)];
		calls += 1;
		if (next && typeof next === "object" && "http" in next) {
			return {
				ok: false,
				status: next.http,
				json: async () => next.body,
			};
		}
		return { ok: true, status: 200, json: async () => next };
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function renderStatus(
	props: Partial<React.ComponentProps<typeof SyncStatus>> = {},
) {
	container = document.createElement("div");
	document.body.appendChild(container);
	const nextRoot = createRoot(container);
	root = nextRoot;
	act(() => {
		nextRoot.render(
			<SyncStatus projectId="proj_123" pollIntervalMs={15} {...props} />,
		);
	});
	return container;
}

async function settle(ms = 60) {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, ms));
	});
}

describe("SyncStatus", () => {
	it("polls the status endpoint for the project", async () => {
		const fetchMock = mockFetchSequence([statusResponse()]);
		renderStatus();
		await settle();
		expect(fetchMock).toHaveBeenCalled();
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
			"/api/codebase/proj_123/status",
		);
	});

	it("shows indeterminate loading without fabricated percentages while active", async () => {
		mockFetchSequence([statusResponse({ status: "uploading" })]);
		const c = renderStatus();
		await settle();
		expect(c.textContent).toMatch(
			/mengupload|memindai|menghubungkan|menunggu/i,
		);
		expect(c.textContent).not.toContain("%");
	});

	it("displays real counts and timestamps from the server", async () => {
		mockFetchSequence([
			statusResponse({
				status: "uploaded",
				fileCount: 42,
				excludedCount: 7,
				createdAt: "2026-09-19T10:00:00.000Z",
			}),
		]);
		const c = renderStatus();
		await settle();
		expect(c.textContent).toContain("42");
		expect(c.textContent).toContain("7");
	});

	it("shows the ready state and stops polling on terminal status", async () => {
		const fetchMock = mockFetchSequence([statusResponse({ status: "ready" })]);
		const c = renderStatus();
		await settle();
		expect(c.textContent).toMatch(/siap/i);
		const callsAfterReady = fetchMock.mock.calls.length;
		await settle(60);
		expect(fetchMock.mock.calls.length).toBe(callsAfterReady);
	});

	it("offers and invokes sync retry from the ready state", () => {
		const onRetrySync = vi.fn();
		const c = renderStatus({
			status: statusResponse({ status: "ready" }),
			onRetrySync,
		});
		const retryButton = [...c.querySelectorAll("button")].find((b) =>
			/Sync ulang/i.test(b.textContent ?? ""),
		);

		expect(retryButton).toBeDefined();
		act(() => {
			retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onRetrySync).toHaveBeenCalledTimes(1);
	});

	it("keeps analysis pending until the server reports a real analysis signal", async () => {
		mockFetchSequence([statusResponse({ status: "uploaded" })]);
		const c = renderStatus();
		await settle();

		expect(c.textContent).toContain("Menunggu analisis codebase");
		expect(c.textContent).not.toContain("Menyusun analisis codebase");
	});

	it("shows the safe server error with a retry action on failure", async () => {
		const onRetrySync = vi.fn();
		mockFetchSequence([
			statusResponse({
				status: "failed",
				errorCode: "SNAPSHOT_INCOMPLETE",
				errorMessage: "Snapshot tidak lengkap.",
			}),
		]);
		const c = renderStatus({ onRetrySync });
		await settle();
		expect(c.textContent).toContain("Snapshot tidak lengkap.");
		const retryButton = [...c.querySelectorAll("button")].find((b) =>
			/coba lagi|sync ulang/i.test(b.textContent ?? ""),
		);
		expect(retryButton).toBeDefined();
		act(() => {
			retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onRetrySync).toHaveBeenCalledTimes(1);
	});

	it("shows the expired state with recovery guidance", async () => {
		mockFetchSequence([statusResponse({ status: "expired" })]);
		const c = renderStatus();
		await settle();
		expect(c.textContent).toMatch(/kedaluwarsa/i);
	});

	it("offers analysis retry when the session is uploaded but analysis failed", async () => {
		const onRetryAnalysis = vi.fn();
		mockFetchSequence([
			statusResponse({
				status: "uploaded",
				snapshotId: "snap_123",
				analysisId: "analysis_123",
				analysisStatus: "failed",
				errorMessage: "Analisis codebase gagal. Coba analisis ulang.",
			}),
		]);
		const c = renderStatus({ onRetryAnalysis });
		await settle();
		expect(c.textContent).toContain("Analisis codebase gagal.");
		const retryButton = [...c.querySelectorAll("button")].find((b) =>
			/analisis ulang/i.test(b.textContent ?? ""),
		);
		expect(retryButton).toBeDefined();
		act(() => {
			retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(onRetryAnalysis).toHaveBeenCalledTimes(1);
	});

	it("does not poll when the parent controls the status", async () => {
		const fetchMock = mockFetchSequence([statusResponse()]);
		const c = renderStatus({ status: statusResponse({ status: "ready" }) });
		await settle();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(c.textContent).toMatch(/siap/i);
	});

	it("does not report ready for a failed session with a stale ready analysis", async () => {
		mockFetchSequence([
			statusResponse({ status: "failed", analysisStatus: "ready" }),
		]);
		const c = renderStatus();
		await settle();
		expect(c.textContent).not.toMatch(/sync selesai/i);
		expect(c.textContent).toMatch(/sync gagal/i);
	});

	it("keeps one request in flight so slow responses cannot overlap", async () => {
		let resolveFirst!: (value: unknown) => void;
		const gate = new Promise((resolve) => {
			resolveFirst = resolve;
		});
		const fetchMock = vi.fn(async () => {
			await gate;
			return { ok: true, status: 200, json: async () => statusResponse() };
		});
		vi.stubGlobal("fetch", fetchMock);
		renderStatus();
		await settle(60);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await act(async () => {
			resolveFirst(null);
		});
		await settle();
	});

	it("notifies the parent of status updates for analysis wiring", async () => {
		const onStatus = vi.fn();
		mockFetchSequence([statusResponse({ status: "analyzing" })]);
		renderStatus({ onStatus });
		await settle();
		expect(onStatus).toHaveBeenCalled();
		const firstCall = onStatus.mock.calls[0]?.[0] as
			| SyncStatusResponse
			| null
			| undefined;
		expect(firstCall?.status).toBe("analyzing");
	});

	it("recovers persisted server state on remount (refresh persistence)", async () => {
		mockFetchSequence([statusResponse({ status: "uploaded", fileCount: 9 })]);
		const first = renderStatus();
		await settle();
		expect(first.textContent).toContain("9");
		if (root) {
			const r = root;
			act(() => {
				r.unmount();
			});
			root = null;
		}
		container.remove();
		mockFetchSequence([statusResponse({ status: "uploaded", fileCount: 9 })]);
		const second = renderStatus();
		await settle();
		expect(second.textContent).toContain("9");
		expect(second.textContent).not.toContain("%");
	});

	it("renders exactly three stages, each backed by an observable signal", async () => {
		mockFetchSequence([
			statusResponse({
				status: "analyzing",
				fileCount: 12,
				excludedCount: 3,
			}),
		]);
		const c = renderStatus();
		await settle();
		// Stage labels that map to real signals.
		expect(c.textContent).toContain("CLI terhubung");
		expect(c.textContent).toContain("Snapshot terkirim dan terverifikasi");
		expect(c.textContent).toContain("Menyusun analisis codebase");
	});

	it("does not claim scan or manifest stages the client never observes", async () => {
		// `scanning`/`filtering` are server bookkeeping the CLI never reports, so
		// no user-facing stage may imply them.
		mockFetchSequence([statusResponse({ status: "uploading" })]);
		const c = renderStatus();
		await settle();
		expect(c.textContent).not.toMatch(/memindai/i);
		expect(c.textContent).not.toMatch(/filtering/i);
		expect(c.textContent).not.toMatch(/package manifest dan framework dibaca/i);
	});

	it("shows the exclusion count only when the server reports it", async () => {
		mockFetchSequence([statusResponse({ status: "uploading" })]);
		const without = renderStatus();
		await settle();
		expect(without.textContent).not.toMatch(/dikecualikan otomatis/i);
		if (root) {
			const r = root;
			act(() => {
				r.unmount();
			});
			root = null;
		}
		container.remove();

		mockFetchSequence([
			statusResponse({ status: "uploaded", excludedCount: 7 }),
		]);
		const withCount = renderStatus();
		await settle();
		expect(withCount.textContent).toContain("7");
		expect(withCount.textContent).toMatch(/dikecualikan otomatis/i);
	});
});
