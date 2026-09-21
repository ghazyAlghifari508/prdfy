"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Plan } from "@/types/database";
import { FEATURES } from "@/types/database";

interface PrdVersion {
	id: string;
	version: number;
	content: string;
	change_summary: string | null;
	created_at: string;
}

interface VersionHistoryProps {
	versions: PrdVersion[];
	currentVersion: number;
	onSelectVersion: (content: string, version: number) => void;
	className?: string;
	plan?: Plan;
}

export function VersionHistory({
	versions,
	currentVersion,
	onSelectVersion,
	className,
	plan = "free",
}: VersionHistoryProps) {
	const [selected, setSelected] = useState(currentVersion);
	const [expanded, setExpanded] = useState(false);

	const hasHistoryAccess = FEATURES[plan].versionHistory !== false;

	const dropdownRef = useRef<HTMLDivElement>(null);

	// ponytail: sync selected when parent's currentVersion changes (e.g. new revision bumps version)
	useEffect(() => {
		setSelected(currentVersion);
	}, [currentVersion]);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				dropdownRef.current &&
				!dropdownRef.current.contains(event.target as Node)
			) {
				setExpanded(false);
			}
		};
		if (expanded) {
			document.addEventListener("mousedown", handleClickOutside);
		}
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [expanded]);

	if (versions.length <= 1) {
		return (
			<div className={cn("p-4", className)}>
				<p className="text-xs text-(--text-secondary)">Belum ada revisi</p>
			</div>
		);
	}

	const handleSelect = (version: PrdVersion) => {
		setSelected(version.version);
		setExpanded(false);
		onSelectVersion(version.content, version.version);
	};

	return (
		<div className={cn("relative", className)} ref={dropdownRef}>
			<button
				type="button"
				aria-expanded={expanded}
				aria-controls="version-history-menu"
				onClick={() => setExpanded(!expanded)}
				className="flex items-center gap-2 text-sm font-medium text-(--text-secondary) hover:text-(--text-primary) dark:hover:text-[#F0F0F0]"
			>
				<span>Version History (v{selected})</span>
				<svg
					aria-hidden="true"
					className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`}
					fill="none"
					viewBox="0 0 16 16"
					stroke="currentColor"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M6 4l4 4-4 4"
					/>
				</svg>
			</button>

			{expanded && (
				<div
					id="version-history-menu"
					className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-[var(--border-subtle)] bg-(--bg-card) p-2 shadow-xl space-y-1 max-h-96 overflow-y-auto"
				>
					{hasHistoryAccess ? (
						versions.map((v) => (
							<div
								key={v.id}
								className={cn(
									"group flex flex-col rounded-lg transition-colors overflow-hidden",
									selected === v.version
										? "btn-primary"
										: "hover:bg-(--bg-surface) dark:hover:bg-[#161616] text-(--text-secondary)",
								)}
							>
								<button
									type="button"
									onClick={() => handleSelect(v)}
									className="w-full px-3 py-2 text-left text-sm"
								>
									<div className="flex items-center justify-between">
										<span className="font-medium">v{v.version}</span>
										<span className="text-xs opacity-60">
											{new Date(v.created_at).toLocaleDateString("id-ID")}
										</span>
									</div>
								</button>
							</div>
						))
					) : (
						<div className="rounded-lg bg-(--bg-surface) p-3 text-center">
							<p className="text-xs text-(--text-secondary)">
								Upgrade ke Pro untuk melihat history revisi
							</p>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
