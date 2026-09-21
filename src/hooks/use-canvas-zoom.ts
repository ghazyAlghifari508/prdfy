/**
 * Canvas zoom and pan hook.
 * Provides zoom level, pan position, and control functions.
 *
 * ponytail: pointermove/wheel can fire more often than the display refreshes.
 * Gesture values are transient, so they live in refs and are committed via
 * requestAnimationFrame - at most one React render per frame instead of one
 * per input event (see vercel-react-best-practices rerender-use-ref-transient-values).
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface UseCanvasZoomOptions {
	minZoom?: number;
	maxZoom?: number;
	initialZoom?: number;
}

export function useCanvasZoom({
	minZoom = 0.54,
	maxZoom = 1.54,
	initialZoom = 1,
}: UseCanvasZoomOptions = {}) {
	const clampZoom = useCallback(
		(value: number) => Math.min(maxZoom, Math.max(minZoom, value)),
		[minZoom, maxZoom],
	);
	const [zoom, setZoomState] = useState(() => clampZoom(initialZoom));
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const isPanningRef = useRef(false);

	const setZoom = useCallback(
		(value: number | ((prev: number) => number)) => {
			setZoomState((prev) =>
				clampZoom(typeof value === "function" ? value(prev) : value),
			);
		},
		[clampZoom],
	);

	// Latest pointer position not yet committed + baseline of last applied move.
	const pendingPointerRef = useRef<{ x: number; y: number } | null>(null);
	const lastAppliedRef = useRef({ x: 0, y: 0 });
	// Multiplicative wheel factors accumulated since last commit.
	const pendingZoomFactorRef = useRef(1);
	const panRafRef = useRef<number | null>(null);
	const zoomRafRef = useRef<number | null>(null);

	useEffect(
		() => () => {
			if (panRafRef.current !== null) cancelAnimationFrame(panRafRef.current);
			if (zoomRafRef.current !== null) cancelAnimationFrame(zoomRafRef.current);
		},
		[],
	);

	const flushPan = useCallback(() => {
		panRafRef.current = null;
		const pending = pendingPointerRef.current;
		if (!pending) return;
		pendingPointerRef.current = null;
		const deltaX = pending.x - lastAppliedRef.current.x;
		const deltaY = pending.y - lastAppliedRef.current.y;
		if (deltaX === 0 && deltaY === 0) return;
		lastAppliedRef.current = { x: pending.x, y: pending.y };
		setPan((prev) => ({ x: prev.x + deltaX, y: prev.y + deltaY }));
	}, []);

	const flushZoom = useCallback(() => {
		zoomRafRef.current = null;
		const factor = pendingZoomFactorRef.current;
		if (factor === 1) return;
		pendingZoomFactorRef.current = 1;
		setZoom((prev) => prev * factor);
	}, [setZoom]);

	const zoomIn = useCallback(() => {
		setZoom((prev) => prev * 1.2);
	}, [setZoom]);

	const zoomOut = useCallback(() => {
		setZoom((prev) => prev / 1.2);
	}, [setZoom]);

	const resetZoom = useCallback(() => {
		if (panRafRef.current !== null) {
			cancelAnimationFrame(panRafRef.current);
			panRafRef.current = null;
		}
		if (zoomRafRef.current !== null) {
			cancelAnimationFrame(zoomRafRef.current);
			zoomRafRef.current = null;
		}
		pendingPointerRef.current = null;
		pendingZoomFactorRef.current = 1;
		isPanningRef.current = false;
		setZoom(initialZoom);
		setPan({ x: 0, y: 0 });
	}, [initialZoom, setZoom]);

	const startPan = useCallback((e: React.PointerEvent) => {
		// Only react to primary button / touch / pen contact.
		if (e.pointerType === "mouse" && e.buttons !== 1) return;
		isPanningRef.current = true;
		pendingPointerRef.current = null;
		if (panRafRef.current !== null) {
			cancelAnimationFrame(panRafRef.current);
			panRafRef.current = null;
		}
		// Deltas are measured against this baseline until the next commit.
		lastAppliedRef.current = { x: e.clientX, y: e.clientY };
		// ponytail: capture so we keep receiving move events outside the element.
		(e.currentTarget as Element | null)?.setPointerCapture?.(e.pointerId);
	}, []);

	const updatePan = useCallback(
		(e: React.PointerEvent) => {
			if (!isPanningRef.current) return;
			pendingPointerRef.current = { x: e.clientX, y: e.clientY };
			if (panRafRef.current === null) {
				panRafRef.current = requestAnimationFrame(flushPan);
			}
		},
		[flushPan],
	);

	const endPan = useCallback(() => {
		isPanningRef.current = false;
		// Commit any movement captured since the last frame so the board
		// lands exactly under the pointer instead of snapping back a delta.
		if (panRafRef.current !== null) {
			cancelAnimationFrame(panRafRef.current);
			panRafRef.current = null;
		}
		flushPan();
	}, [flushPan]);

	// ponytail: no e.preventDefault(), causes passive listener warning.
	// Canvas div uses touch-action: none + overflow-hidden to block native scroll.
	const onWheel = useCallback(
		(e: React.WheelEvent) => {
			pendingZoomFactorRef.current *= e.deltaY < 0 ? 1.1 : 1 / 1.1;
			if (zoomRafRef.current === null) {
				zoomRafRef.current = requestAnimationFrame(flushZoom);
			}
		},
		[flushZoom],
	);

	/**
	 * Keyboard pan nudge for arrow-key navigation (a11y).
	 * ponytail: fixed 40px step; add acceleration if needed.
	 */
	const nudgePan = useCallback((key: string, step = 40) => {
		setPan((prev) => {
			switch (key) {
				case "ArrowUp":
					return { ...prev, y: prev.y + step };
				case "ArrowDown":
					return { ...prev, y: prev.y - step };
				case "ArrowLeft":
					return { ...prev, x: prev.x + step };
				case "ArrowRight":
					return { ...prev, x: prev.x - step };
				default:
					return prev;
			}
		});
	}, []);

	return {
		zoom,
		pan,
		setZoom,
		setPan,
		zoomIn,
		zoomOut,
		resetZoom,
		startPan,
		updatePan,
		endPan,
		nudgePan,
		onWheel,
		minZoom,
		maxZoom,
	};
}
