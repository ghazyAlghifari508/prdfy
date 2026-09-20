"use client";

import { useLocation } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { stepRank } from "@/lib/flow-progress";
import { type FlowStep, routeToStep } from "@/lib/flow-step";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store";

// ponytail: pure step<->route logic extracted to @/lib/flow-step so server
// code + tests can use it without next/navigation. Re-export keeps existing
// `import { routeToStep } from "./flow-step-nav"` call sites working.
export { type FlowStep, getFlowStepCta, routeToStep } from "@/lib/flow-step";

export type StepId = FlowStep;

const STEPS: Array<{ id: FlowStep; label: string }> = [
	{ id: "question", label: "Question" },
	{ id: "prd", label: "PRD" },
	{ id: "ac", label: "AC" },
	{ id: "task", label: "Task" },
];

/**
 * Pure visual status indicator showing project progress.
 * Non-clickable: conveys "where the project is", not "where to navigate".
 */
export function FlowStepNav(props?: {
	step?: FlowStep | string | null;
	taskStatus?: string | null;
}) {
	const pathname = useLocation({ select: (l) => l.pathname });
	const isKanbanRoute = (pathname ?? "").startsWith("/kanban");
	const isTaskGenerated = useChatStore((s) => s.isTaskGenerated);
	const currentRouteStep = routeToStep(pathname ?? "");
	const routeRank = stepRank(currentRouteStep);
	const dbRank = stepRank(props?.step as FlowStep);

	const isTaskDone =
		isKanbanRoute || isTaskGenerated || props?.taskStatus === "completed";

	return (
		<ol
			aria-label="Progress alur proyek"
			className="flex items-center gap-1.5 md:gap-2 select-none"
		>
			{STEPS.map((s, idx) => {
				const isCurrentRoute = s.id === currentRouteStep;

				const isCompleted =
					s.id === "task"
						? isTaskDone
						: !isCurrentRoute &&
							(routeRank > idx || (props?.step ? dbRank > idx : false));

				const isActive = isCurrentRoute && !isCompleted;
				const isLocked = !isCompleted && !isActive;

				const connectorActive =
					idx <= routeRank || (props?.step ? idx <= dbRank : false);

				return (
					<li
						key={s.id}
						className="flex items-center gap-1.5 md:gap-2"
						aria-current={isActive ? "step" : undefined}
					>
						{idx > 0 && (
							<span
								aria-hidden
								className={cn(
									"hidden h-px w-4 transition-colors duration-300 md:block",
									connectorActive ? "bg-indigo/60" : "bg-graphite",
								)}
							/>
						)}
						<div className="flex items-center gap-1.5 cursor-default">
							<span
								className={cn(
									"flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-[510] transition-colors duration-300",
									isCompleted && "bg-emerald text-charcoal",
									isActive && "bg-indigo text-white",
									isLocked && "border border-graphite text-fog",
								)}
								aria-hidden="true"
							>
								{isCompleted ? <Check size={12} strokeWidth={3} /> : idx + 1}
							</span>
							<span
								className={cn(
									"hidden font-inter text-sm transition-colors duration-300 md:block",
									isActive
										? "font-[510] text-snow"
										: isCompleted
											? "font-normal text-snow"
											: "font-normal text-fog",
								)}
							>
								{s.label}
								{isCompleted && <span className="sr-only"> (Selesai)</span>}
								{isActive && <span className="sr-only"> (Tahap saat ini)</span>}
							</span>
						</div>
					</li>
				);
			})}
		</ol>
	);
}
