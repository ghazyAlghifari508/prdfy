"use client";

import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { useTheme } from "next-themes";
import { memo, useDeferredValue, useEffect, useRef, useState } from "react";

interface MermaidProps {
	chart: string;
}

// ponytail: initialize mermaid at module scope, not per-render.
// Previously initialize() ran inside the render effect on every chart-delta
// re-render (dozens of times per diagram while streaming) — redundant global
// config churn on top of parse/render cost. Re-calling initialize() to switch
// theme is idempotent and cheaper than the per-render parse/render it preceded.
function ensureMermaidInit(theme: "dark" | "default") {
	mermaid.initialize({
		startOnLoad: false,
		theme,
		securityLevel: "strict",
		logLevel: 4, // ERROR only - 0 = TRACE floods console
		htmlLabels: false,
		flowchart: { htmlLabels: false },
	});
}

export const Mermaid = memo(({ chart }: MermaidProps) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const [svg, setSvg] = useState<string>("");
	const [hasError, setHasError] = useState(false);
	const renderIdRef = useRef(0);
	const { resolvedTheme } = useTheme();

	// ponytail: defer chart parsing during streaming. useDeferredValue lets
	// React batch rapid chart prop changes (per-token during PRD streaming) and
	// only trigger a parse/render once the browser is idle — avoids dozens of
	// invalid mid-stream mermaid.parse() calls that caused render lag.
	const deferredChart = useDeferredValue(chart);

	useEffect(() => {
		let cancelled = false;
		const _currentRender = ++renderIdRef.current;

		const renderChart = async () => {
			try {
				setHasError(false);
				setSvg("");

				const theme = resolvedTheme === "dark" ? "dark" : "default";
				ensureMermaidInit(theme);

				if (!deferredChart || !deferredChart.trim()) {
					setHasError(true);
					return;
				}

				// ponytail: sanitize common AI mermaid syntax errors before parsing
				const sanitizedChart = deferredChart
					// Fix unquoted special chars in graph labels: A[Text (note)] → A["Text (note)"]
					.replace(/([A-Za-z0-9_]+)\[([^\]"]*[(){}[\]][^\]"]*)\]/g, '$1["$2"]')
					// Remove duplicate arrows: A -->--> B → A --> B
					.replace(/(-+>){2,}/g, "-->")
					.replace(/(=+>){2,}/g, "==>")
					// Fix missing space after arrow: A-->B → A --> B (but not inside quoted strings)
					.replace(
						/([A-Za-z0-9_])(-{2,}>|={2,}>|\.+>)([A-Za-z0-9_])/g,
						"$1 $2 $3",
					)
					// Strip Prisma-style array type in ER attributes: string[] images → string images
					.replace(/(\w+)\[\]/g, "$1")
					// Strip Prisma-style directive lines (e.g. @@unique(...)) - not valid Mermaid
					.replace(/^\s*@@\w+\([^)]*\)\s*$/gm, "")
					.trim();

				const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;

				// Silent parse - returns false on invalid syntax instead of throwing.
				// During AI streaming, incomplete mermaid blocks are common; we handle
				// this by rendering raw text until valid syntax arrives.
				const isParseable = await mermaid.parse(sanitizedChart, {
					suppressErrors: true,
				});

				if (!isParseable) {
					// Chart not parseable (streaming / invalid). Show raw text.
					if (cancelled) return;
					setHasError(true);
					const escaped = deferredChart
						.replace(/&/g, "&amp;")
						.replace(/</g, "&lt;")
						.replace(/>/g, "&gt;")
						.replace(/"/g, "&quot;")
						.replace(/'/g, "&#039;");
					setSvg(
						DOMPurify.sanitize(`
            <div class="flex flex-col w-full max-w-full rounded-lg border border-dashed border-fog/30 bg-charcoal/30">
              <div class="text-xs p-3 text-fog flex items-center justify-center border-b border-fog/20">
                <span>Memproses diagram...</span>
              </div>
              <pre class="p-4 text-[11px] overflow-x-auto text-slate font-berkeley-mono whitespace-pre leading-relaxed">${escaped}</pre>
            </div>
          `),
					);
					return;
				}

				// Chart is parseable - render it.
				const { svg: renderSvg } = await mermaid.render(id, sanitizedChart);
				if (cancelled) return;

				// Guard: mermaid.render can succeed but return empty/minimal SVG
				// (known issue with certain diagram types). Detect and fallback.
				if (!renderSvg || renderSvg.trim().length < 50) {
					throw new Error("Empty SVG rendered");
				}

				// ponytail: mermaid "loose" emits raw <foreignObject> HTML labels. The SVG is
				// diagram markup, but sanitize it anyway — labels may carry markup derived
				// from AI/user input and dangerouslySetInnerHTML trusts us completely.
				setSvg(
					DOMPurify.sanitize(renderSvg, {
						USE_PROFILES: { svg: true, svgFilters: true },
					}),
				);
				setHasError(false);
			} catch {
				if (cancelled) return;

				setHasError(true);
				// Clean up SVG stubs mermaid may have injected
				document
					.querySelectorAll(
						'svg[id^="dmermaid-"], svg[id^="mermaid-"], div[id^="dmermaid-"]',
					)
					.forEach((el) => {
						el.remove();
					});

				const escaped = deferredChart
					.replace(/&/g, "&amp;")
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;")
					.replace(/"/g, "&quot;")
					.replace(/'/g, "&#039;");
				setSvg(
					DOMPurify.sanitize(`
          <div class="flex flex-col w-full max-w-full rounded-lg border border-dashed border-fog/30 bg-charcoal/30">
            <div class="text-xs p-3 text-fog flex items-center justify-center border-b border-fog/20">
              <span>Diagram tidak dapat dirender - kesalahan syntax pada kode Mermaid</span>
            </div>
            <pre class="p-4 text-[11px] overflow-x-auto text-slate font-berkeley-mono whitespace-pre leading-relaxed">${escaped}</pre>
          </div>
        `),
				);
			}
		};

		renderChart();

		return () => {
			cancelled = true;
		};
	}, [deferredChart, resolvedTheme]);

	if (!svg && !hasError) {
		return (
			<div className="animate-pulse bg-black/5 dark:bg-white/5 h-32 rounded-lg flex items-center justify-center text-sm text-(--text-secondary) my-6">
				Rendering diagram...
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			className="my-6 overflow-x-auto bg-(--bg-card) p-4 rounded-lg border border-(--border-subtle) flex justify-center w-full"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized SVG via DOMPurify
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	);
});
