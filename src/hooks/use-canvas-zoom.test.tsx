// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasZoom } from "./use-canvas-zoom";

/**
 * Regression guard for whiteboard pan jank: pointermove can fire more often
 * than the display refreshes, so pan updates MUST be coalesced to at most one
 * React commit per animation frame instead of one re-render per input event.
 */

type Hook = ReturnType<typeof useCanvasZoom>;

let container: HTMLDivElement;
let root: Root | null = null;
let renderCount: number;
let latest: Hook;

function Harness() {
	latest = useCanvasZoom();
	renderCount += 1;
	return null;
}

function mount() {
	renderCount = 0;
	container = document.createElement("div");
	document.body.appendChild(container);
	const r = createRoot(container);
	root = r;
	act(() => {
		r.render(<Harness />);
	});
	return renderCount;
}

function fakePointer(x: number, y: number) {
	return {
		clientX: x,
		clientY: y,
		pointerType: "mouse",
		buttons: 1,
		pointerId: 1,
		currentTarget: { setPointerCapture: () => {} },
	} as unknown as React.PointerEvent;
}

let rafQueue: Array<(t: number) => void> = [];

function flushFrame() {
	const q = rafQueue;
	rafQueue = [];
	for (const cb of q) cb(16);
}

beforeEach(() => {
	(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
	rafQueue = [];
	vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
		rafQueue.push(cb);
		return rafQueue.length;
	});
	vi.stubGlobal("cancelAnimationFrame", (_id: number) => {});
});

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
});

describe("useCanvasZoom pan coalescing", () => {
	it("commits at most one render per frame under rapid pointermove bursts", () => {
		const initial = mount();

		act(() => {
			latest.startPan(fakePointer(0, 0));
			for (let i = 1; i <= 30; i++) {
				latest.updatePan(fakePointer(i * 3, i * 2));
			}
		});

		expect(renderCount).toBe(initial);

		act(() => {
			flushFrame();
		});

		expect(renderCount).toBe(initial + 1);
	});

	it("applies the full accumulated delta exactly once", () => {
		mount();

		act(() => {
			latest.startPan(fakePointer(0, 0));
			for (let i = 1; i <= 30; i++) {
				latest.updatePan(fakePointer(i * 3, i * 2));
			}
		});
		act(() => {
			flushFrame();
		});

		expect(latest.pan.x).toBe(90);
		expect(latest.pan.y).toBe(60);
	});

	it("flushes pending deltas immediately on endPan so no movement is lost", () => {
		mount();

		act(() => {
			latest.startPan(fakePointer(0, 0));
			latest.updatePan(fakePointer(12, 9));
			latest.endPan();
		});

		expect(latest.pan.x).toBe(12);
		expect(latest.pan.y).toBe(9);
	});

	it("keeps panning across multiple frames with fresh deltas", () => {
		mount();

		act(() => {
			latest.startPan(fakePointer(0, 0));
		});
		act(() => {
			latest.updatePan(fakePointer(10, 0));
		});
		act(() => {
			flushFrame();
		});
		act(() => {
			latest.updatePan(fakePointer(15, 0));
		});
		act(() => {
			flushFrame();
		});

		expect(latest.pan.x).toBe(15);
	});

	it("resets pan and zoom while cancelling pending gesture RAFs", () => {
		mount();

		act(() => {
			latest.startPan(fakePointer(0, 0));
			latest.updatePan(fakePointer(25, 25));
			latest.resetZoom();
		});

		// Flushing any leftover frames after reset must not apply old pointer moves
		act(() => {
			flushFrame();
		});

		expect(latest.pan.x).toBe(0);
		expect(latest.pan.y).toBe(0);
		expect(latest.zoom).toBe(1);
	});

	it("clamps zoom within [minZoom, maxZoom] boundaries", () => {
		mount();

		act(() => {
			latest.setZoom(999);
		});
		expect(latest.zoom).toBe(latest.maxZoom);

		act(() => {
			latest.setZoom(-10);
		});
		expect(latest.zoom).toBe(latest.minZoom);
	});
});
