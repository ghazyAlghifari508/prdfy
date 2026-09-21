"use client";

import { useTheme } from "next-themes";
import { useEffect } from "react";

/**
 * Keeps the `data-theme` attribute in sync with next-themes.
 *
 * `styles.css` keys its CSS variables off `:root[data-theme=...]` while the
 * ThemeProvider only manages the `class` attribute, so without this the
 * variables go stale after a toggle (dark vars persist in light mode).
 * Mirrors the bootstrap script in `__root.tsx`: an explicit choice sets the
 * attribute, system/auto removes it and lets the media query decide.
 */
export function ThemeAttributeSync() {
	const { theme } = useTheme();

	useEffect(() => {
		const root = document.documentElement;
		if (theme === "light" || theme === "dark") {
			root.setAttribute("data-theme", theme);
		} else {
			root.removeAttribute("data-theme");
		}
	}, [theme]);

	return null;
}
