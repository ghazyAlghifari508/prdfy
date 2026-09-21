import { useEffect, useRef } from "react";

interface UseFocusTrapOptions {
	isOpen: boolean;
	onEscape?: () => void;
	initialFocusRef?: React.RefObject<HTMLElement | null>;
	restoreFocus?: boolean;
}

const FOCUSABLE_SELECTOR = [
	"a[href]",
	"button:not([disabled]):not([tabindex='-1'])",
	"input:not([disabled]):not([tabindex='-1'])",
	"select:not([disabled]):not([tabindex='-1'])",
	"textarea:not([disabled]):not([tabindex='-1'])",
	"[tabindex]:not([tabindex='-1']):not([disabled])",
].join(", ");

export function useFocusTrap<T extends HTMLElement = HTMLDivElement>({
	isOpen,
	onEscape,
	initialFocusRef,
	restoreFocus = true,
}: UseFocusTrapOptions) {
	const containerRef = useRef<T | null>(null);
	const previousActiveElementRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!isOpen) return;

		if (
			typeof document !== "undefined" &&
			document.activeElement instanceof HTMLElement
		) {
			previousActiveElementRef.current = document.activeElement;
		}

		const container = containerRef.current;
		if (container) {
			const initialTarget =
				initialFocusRef?.current ??
				container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
			if (initialTarget) {
				initialTarget.focus();
			} else {
				container.focus();
			}
		}

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (onEscape) {
					e.preventDefault();
					e.stopPropagation();
					onEscape();
				}
				return;
			}

			if (e.key !== "Tab") return;

			const currentContainer = containerRef.current;
			if (!currentContainer) return;

			const isVisible = (el: HTMLElement) => {
				if (
					el.hasAttribute("hidden") ||
					el.getAttribute("aria-hidden") === "true"
				) {
					return false;
				}
				if (typeof window !== "undefined" && window.getComputedStyle) {
					const style = window.getComputedStyle(el);
					if (style.display === "none" || style.visibility === "hidden") {
						return false;
					}
				}
				return true;
			};

			const focusables = Array.from(
				currentContainer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
			).filter(isVisible);

			if (focusables.length === 0) {
				e.preventDefault();
				return;
			}

			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			const active = document.activeElement;

			if (e.shiftKey) {
				if (active === first || !currentContainer.contains(active)) {
					e.preventDefault();
					last.focus();
				}
			} else {
				if (active === last || !currentContainer.contains(active)) {
					e.preventDefault();
					first.focus();
				}
			}
		};

		document.addEventListener("keydown", handleKeyDown, true);

		return () => {
			document.removeEventListener("keydown", handleKeyDown, true);
			if (restoreFocus && previousActiveElementRef.current) {
				if (document.contains(previousActiveElementRef.current)) {
					previousActiveElementRef.current.focus();
				}
				previousActiveElementRef.current = null;
			}
		};
	}, [isOpen, onEscape, initialFocusRef, restoreFocus]);

	return containerRef;
}
