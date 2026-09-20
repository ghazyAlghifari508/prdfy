"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { KANBAN_POLL_INTERVAL_MS } from "@/lib/constants";

export interface TaskCard {
	id: string;
	type: "task" | "subtask";
	parentId?: string;
	featureName: string;
	name: string;
	description: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	subtaskCount?: number;
	subtaskCompleted?: number;
	subtasks?: Array<{ name: string; status: string }>;
	dependencies: string[];
	startedAt: string | null;
	completedAt: string | null;
}

export interface KanbanData {
	columns: {
		pending: TaskCard[];
		in_progress: TaskCard[];
		completed: TaskCard[];
		failed: TaskCard[];
	};
	staleness: "live" | "stale" | "disconnected";
	lastUpdateAt: string;
	acChanged?: boolean;
	taskStatus?: string | null;
}

interface UseKanbanTasksOptions {
	projectId: string;
	intervalMs?: number;
	enabled?: boolean;
}

export function useKanbanTasks({
	projectId,
	intervalMs = KANBAN_POLL_INTERVAL_MS,
	enabled = true,
}: UseKanbanTasksOptions) {
	const queryClient = useQueryClient();
	const [sseData, setSseData] = useState<KanbanData | null>(null);
	const [sseFailed, setSseFailed] = useState(false);
	const [sseLoading, setSseLoading] = useState(true);
	const refreshInFlight = useRef<Promise<void> | null>(null);

	useEffect(() => {
		if (!enabled || !projectId) return;

		// Reset on project change / re-enable so a fresh project doesn't show stale SSE data.
		setSseData(null);
		setSseFailed(false);
		setSseLoading(true);

		const es = new EventSource(
			`/api/kanban/stream?projectId=${encodeURIComponent(projectId)}`,
		);

		es.onmessage = (e) => {
			try {
				const parsed = JSON.parse(e.data) as KanbanData;
				setSseData(parsed);
				setSseFailed(false);
				setSseLoading(false);
				// Sync SSE payload into the query cache so optimistic
				// `setQueryData(["kanban-tasks", projectId], ...)` mutations
				// stay visible even while SSE is the primary source.
				queryClient.setQueryData(["kanban-tasks", projectId], parsed);
			} catch {
				// A malformed event means the stream protocol is broken; staying
				// in loading would hang the board on its skeleton forever.
				// Fail over to polling, which has error and retry handling.
				setSseFailed(true);
				setSseLoading(false);
				es.close();
			}
		};

		es.onerror = () => {
			setSseFailed(true);
			setSseLoading(false);
			es.close();
		};

		return () => es.close();
	}, [projectId, enabled, queryClient]);

	// Fallback polling — only active after SSE has failed. Keeps the same
	// 10s cadence the board used pre-SSE, preserving staleness semantics.
	const query = useQuery<KanbanData>({
		queryKey: ["kanban-tasks", projectId],
		queryFn: async () => {
			const res = await fetch(`/api/kanban/${projectId}`);
			if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
			return res.json() as Promise<KanbanData>;
		},
		refetchInterval: sseFailed ? intervalMs : false,
		refetchOnWindowFocus: sseFailed,
		staleTime: 5_000,
		enabled: enabled && !!projectId && sseFailed,
	});

	const data = sseFailed ? (query.data ?? null) : sseData;

	const isLoading = sseFailed
		? query.isLoading
		: sseLoading && sseData === null;

	// Staleness stays pure and honest: when SSE is live, server always says
	// "live" — degraded signal lives client-side via failureCount, same as
	// the pre-SSE polling contract. No fake rotating strings.
	const staleness: KanbanData["staleness"] = sseFailed
		? query.failureCount >= 10
			? "disconnected"
			: query.failureCount >= 3
				? "stale"
				: (query.data?.staleness ?? "live")
		: (sseData?.staleness ?? "live");

	return {
		data,
		isLoading,
		isError: sseFailed ? query.isError : false,
		error: sseFailed
			? query.error instanceof Error
				? query.error
				: query.error
					? new Error(String(query.error))
					: null
			: null,
		staleness,
		refetch: async () => {
			if (sseFailed) {
				await query.refetch();
			} else {
				// SSE live: one-off fetch to refresh after a user-initiated retry
				// (pull-to-refresh, banner retry). Keeps SSE as primary source
				// but lets the retry button feel instant. Concurrent callers
				// share one in-flight fetch so a single gesture cannot fan out
				// into overlapping requests that resolve out of order.
				if (refreshInFlight.current) {
					await refreshInFlight.current;
					return;
				}
				const refresh = (async () => {
					try {
						const res = await fetch(`/api/kanban/${projectId}`);
						if (res.ok) {
							const json = (await res.json()) as KanbanData;
							setSseData(json);
							queryClient.setQueryData(["kanban-tasks", projectId], json);
						}
					} catch {}
				})();
				refreshInFlight.current = refresh;
				try {
					await refresh;
				} finally {
					refreshInFlight.current = null;
				}
			}
		},
	};
}
