import { useEffect, useRef } from "react";
import { isValidHistoryUrl } from "@/lib/flow-progress";

/**
 * Debounced reporter for a project's last-visited URL.
 *
 * Call the returned function whenever the pathname inside a project changes.
 * The hook fires POST /api/projects/$id/last-route at most once per 500 ms,
 * so nested route changes (e.g. tab switches inside /task/$id) don't spam
 * the DB. Errors are silently swallowed — last_url is a best-effort signal.
 *
 * ponytail: no retry, no queue, no visibility. If the POST fails the user
 * still lands on a sensible page via the step fallback in History.
 */
export function useLastRoute(projectId: string): (url: string) => void {
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const seqRef = useRef(0);
	const latestUrlRef = useRef<string | null>(null);

	// Clear any pending debounce on unmount so we don't fire after the
	// component is gone (e.g. rapid navigation).
	useEffect(
		() => () => {
			if (timerRef.current) clearTimeout(timerRef.current);
			abortRef.current?.abort();
		},
		[],
	);

	const fire = (url: string, seq: number) => {
		// The id travels as an opaque path segment, and only validated
		// same-project routes are ever persisted server-side.
		if (!isValidHistoryUrl(url, projectId)) return;
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		fetch(`/api/projects/${encodeURIComponent(projectId)}/last-route`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url }),
			signal: controller.signal,
		})
			.catch(() => {
				/* best-effort; no UI impact */
			})
			.finally(() => {
				// Convergence: an aborted/superseded request may still have
				// reached the server and could land after a newer write. If a
				// newer URL was scheduled since, re-fire it so the stored
				// value converges to the latest route instead of the stale one.
				if (
					seqRef.current !== seq &&
					latestUrlRef.current &&
					latestUrlRef.current !== url
				) {
					const latest = latestUrlRef.current;
					seqRef.current += 1;
					fire(latest, seqRef.current);
				}
			});
	};

	return (url: string) => {
		latestUrlRef.current = url;
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => {
			timerRef.current = null;
			seqRef.current += 1;
			fire(url, seqRef.current);
		}, 500);
	};
}
