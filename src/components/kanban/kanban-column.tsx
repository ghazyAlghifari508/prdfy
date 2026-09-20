"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import type { TaskCard } from "@/hooks/use-kanban-polling";
import { groupCardsByFeature } from "@/lib/kanban-utils";
import { FeatureGroup } from "./feature-group";

export interface KanbanColumnHandle {
	scrollIntoView: () => void;
}

interface KanbanColumnProps {
	title: string;
	count: number;
	cards: TaskCard[];
	highlightedCardId?: string | null;
}

export const KanbanColumn = forwardRef<KanbanColumnHandle, KanbanColumnProps>(
	({ title, count, cards, highlightedCardId }, ref) => {
		const columnRef = useRef<HTMLDivElement>(null);

		useImperativeHandle(ref, () => ({
			scrollIntoView: () => {
				columnRef.current?.scrollIntoView({
					behavior: "smooth",
					block: "center",
				});
			},
		}));

		const featureGroups = groupCardsByFeature(cards);

		const featuresList = Object.keys(featureGroups);
		const hasInProgress = cards.some((c) => c.status === "in_progress");

		return (
			<div
				ref={columnRef}
				className="flex h-full flex-1 min-w-[260px] shrink-0 flex-col rounded-xl border border-iron bg-obsidian/40 snap-center"
			>
				{/* Column Header */}
				<div className="flex items-center justify-between border-b border-iron px-4 py-3.5 bg-obsidian/60 rounded-t-xl">
					<div className="flex items-center gap-2">
						<h3 className="font-inter text-sm font-semibold text-snow">
							{title}
						</h3>
						{hasInProgress && (
							<div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo border-t-transparent" />
						)}
					</div>
					<span className="rounded-full bg-steel/15 px-2 py-0.5 text-xs font-bold text-mist">
						{count}
					</span>
				</div>

				{/* Column Content Scrollable */}
				<div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 min-h-0 custom-scrollbar select-none">
					{featuresList.length === 0 ? (
						<div className="flex flex-1 items-center justify-center py-12">
							<span className="text-xs text-fog/40">Tidak ada task</span>
						</div>
					) : (
						featuresList.map((fName, idx) => (
							<FeatureGroup
								key={fName}
								featureName={fName}
								cards={featureGroups[fName]}
								colorIndex={idx}
								highlightedCardId={highlightedCardId}
							/>
						))
					)}
				</div>
			</div>
		);
	},
);

KanbanColumn.displayName = "KanbanColumn";
