"use client";

import { ChevronRight, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCanvasZoom } from "@/hooks/use-canvas-zoom";
import type { TaskTree } from "@/lib/services/task-service";
import { ZoomControls } from "./zoom-controls";

// Layout constants
const ROOT_W = 200;
const ROOT_H = 56;
const FEATURE_W = 260;
const FEATURE_H = 64;
const TASK_W = 280;
const TASK_MIN_H = 80;
const SUBTASK_LINE_H = 24;
const TASK_HEADER_H = 44;
const TASK_FOOTER_H = 32;
const MAX_VISIBLE_SUBTASKS = 3;
const DETAIL_W = 260;
const DETAIL_HEADER_H = 34;
const DETAIL_LINE_H = 20;
const DETAIL_FOOTER_H = 24;
const MAX_VISIBLE_DETAILS = 3;
const DETAIL_GAP_Y = 12;

const LEVEL_GAP_X = 120;
const SIBLING_GAP_Y = 24;

// Color palette per feature
const COLORS = [
	{
		bg: "bg-indigo/10",
		border: "border-indigo/40",
		badge: "bg-indigo",
		accent: "#6366f1",
	},
	{
		bg: "bg-emerald/10",
		border: "border-emerald/40",
		badge: "bg-emerald",
		accent: "#10b981",
	},
	{
		bg: "bg-amber-500/10",
		border: "border-amber-500/40",
		badge: "bg-amber-500",
		accent: "#f59e0b",
	},
	{
		bg: "bg-crimson/10",
		border: "border-crimson/40",
		badge: "bg-crimson",
		accent: "#ef4444",
	},
	{
		bg: "bg-sky-500/10",
		border: "border-sky-500/40",
		badge: "bg-sky-500",
		accent: "#0ea5e9",
	},
	{
		bg: "bg-fuchsia-500/10",
		border: "border-fuchsia-500/40",
		badge: "bg-fuchsia-500",
		accent: "#d946ef",
	},
];

interface LayoutNode {
	id: string;
	type: "root" | "feature" | "task" | "detail";
	label: string;
	x: number;
	y: number;
	w: number;
	h: number;
	colorIdx: number;
	phase?: number;
	taskCount?: number;
	subtasks?: Array<{ name: string }>;
	totalSubtasks?: number;
	parentSubtask?: string;
	details?: string[];
	totalDetails?: number;
}

interface LayoutEdge {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	color: string;
}

function layoutGraph(
	tree: TaskTree,
	projectName: string,
): { nodes: LayoutNode[]; edges: LayoutEdge[]; width: number; height: number } {
	const nodes: LayoutNode[] = [];
	const edges: LayoutEdge[] = [];

	const features = tree.features;
	if (features.length === 0) return { nodes, edges, width: 0, height: 0 };

	function taskCardH(subtaskCount: number): number {
		const visible = Math.min(subtaskCount, MAX_VISIBLE_SUBTASKS);
		return (
			TASK_HEADER_H +
			visible * SUBTASK_LINE_H +
			(subtaskCount > MAX_VISIBLE_SUBTASKS ? TASK_FOOTER_H : 12)
		);
	}

	// ponytail: one detail node per subtask (was one per detail item).
	function detailGroups(task: TaskTree["features"][number]["tasks"][number]) {
		return task.subtasks
			.map((sub) => ({ parentSubtask: sub.name, items: sub.details ?? [] }))
			.filter((g) => g.items.length > 0);
	}

	function detailNodeH(itemCount: number): number {
		const visible = Math.min(itemCount, MAX_VISIBLE_DETAILS);
		return (
			DETAIL_HEADER_H +
			visible * DETAIL_LINE_H +
			(itemCount > MAX_VISIBLE_DETAILS ? DETAIL_FOOTER_H : 10)
		);
	}

	function detailStackH(groups: ReturnType<typeof detailGroups>): number {
		if (groups.length === 0) return 0;
		return (
			groups.reduce((s, g) => s + detailNodeH(g.items.length), 0) +
			(groups.length - 1) * DETAIL_GAP_Y
		);
	}

	// Pass 1: compute feature subtree heights (sum of its task cards + gaps)
	// ownH = task card's real visual height (content-driven). slotH = space reserved
	// for the task's row (may be taller than ownH when its details stack exceeds the
	// card height), the task card is centered within slotH so edges targeting the
	// slot's vertical center always line up with the card, not empty space.
	const featureHeights: number[] = [];
	const featureTaskOwnHeights: number[][] = [];
	const featureTaskSlotHeights: number[][] = [];
	for (const feature of features) {
		const ownHs = feature.tasks.map((t) =>
			Math.max(TASK_MIN_H, taskCardH(t.subtasks.length)),
		);
		const slotHs = feature.tasks.map((t, ti) =>
			Math.max(ownHs[ti], detailStackH(detailGroups(t))),
		);
		featureTaskOwnHeights.push(ownHs);
		featureTaskSlotHeights.push(slotHs);
		const total =
			slotHs.reduce((s, h) => s + h, 0) +
			Math.max(0, slotHs.length - 1) * SIBLING_GAP_Y;
		featureHeights.push(Math.max(FEATURE_H, total));
	}

	// Pass 2: position features vertically, centered
	const totalFeatureHeight =
		featureHeights.reduce((s, h) => s + h, 0) +
		(features.length - 1) * SIBLING_GAP_Y;

	// Root node
	const rootX = 40;
	const rootY = totalFeatureHeight / 2 - ROOT_H / 2 + 40;
	nodes.push({
		id: "root",
		type: "root",
		label: projectName,
		x: rootX,
		y: rootY,
		w: ROOT_W,
		h: ROOT_H,
		colorIdx: 0,
	});

	const featureX = rootX + ROOT_W + LEVEL_GAP_X;
	let featureCursorY = 40;

	for (let fi = 0; fi < features.length; fi++) {
		const feature = features[fi];
		const fh = featureHeights[fi];
		const featureY = featureCursorY + fh / 2 - FEATURE_H / 2;
		const colorIdx = fi % COLORS.length;

		nodes.push({
			id: `f-${fi}`,
			type: "feature",
			label: feature.name,
			x: featureX,
			y: featureY,
			w: FEATURE_W,
			h: FEATURE_H,
			colorIdx,
			phase: fi + 1,
			taskCount: feature.tasks.length,
		});

		// Edge: root → feature
		edges.push({
			x1: rootX + ROOT_W,
			y1: rootY + ROOT_H / 2,
			x2: featureX,
			y2: featureY + FEATURE_H / 2,
			color: COLORS[colorIdx].accent,
		});

		// Tasks
		const taskX = featureX + FEATURE_W + LEVEL_GAP_X;
		const ownHs = featureTaskOwnHeights[fi];
		const slotHs = featureTaskSlotHeights[fi];
		const totalTaskH =
			slotHs.reduce((s, h) => s + h, 0) +
			Math.max(0, slotHs.length - 1) * SIBLING_GAP_Y;
		let taskCursorY = featureCursorY + fh / 2 - totalTaskH / 2;

		for (let ti = 0; ti < feature.tasks.length; ti++) {
			const task = feature.tasks[ti];
			const ownH = ownHs[ti];
			const slotH = slotHs[ti];
			// Card centered within its slot so its true visual midpoint (cardY + ownH/2)
			// equals the slot midpoint (taskCursorY + slotH/2), edges target the slot
			// midpoint, so this keeps them landing on the actual rendered card, not
			// empty space below it when the detail stack makes the slot taller than the card.
			const cardY = taskCursorY + slotH / 2 - ownH / 2;
			const slotMidY = taskCursorY + slotH / 2;

			nodes.push({
				id: `f-${fi}-t-${ti}`,
				type: "task",
				label: task.name,
				x: taskX,
				y: cardY,
				w: TASK_W,
				h: ownH,
				colorIdx,
				subtasks: task.subtasks,
				totalSubtasks: task.subtasks.length,
			});

			// Edge: feature → task
			edges.push({
				x1: featureX + FEATURE_W,
				y1: featureY + FEATURE_H / 2,
				x2: taskX,
				y2: slotMidY,
				color: COLORS[colorIdx].accent,
			});

			// Details: one node per detail item, flattened across this task's subtasks
			const groups = detailGroups(task);
			if (groups.length > 0) {
				const detailX = taskX + TASK_W + LEVEL_GAP_X;
				let detailCursorY = slotMidY - detailStackH(groups) / 2;

				for (let di = 0; di < groups.length; di++) {
					const group = groups[di];
					const h = detailNodeH(group.items.length);

					nodes.push({
						id: `f-${fi}-t-${ti}-d-${di}`,
						type: "detail",
						label: group.parentSubtask,
						parentSubtask: group.parentSubtask,
						details: group.items,
						totalDetails: group.items.length,
						x: detailX,
						y: detailCursorY,
						w: DETAIL_W,
						h,
						colorIdx,
					});

					edges.push({
						x1: taskX + TASK_W,
						y1: slotMidY,
						x2: detailX,
						y2: detailCursorY + h / 2,
						color: COLORS[colorIdx].accent,
					});

					detailCursorY += h + DETAIL_GAP_Y;
				}
			}

			taskCursorY += slotH + SIBLING_GAP_Y;
		}

		featureCursorY += fh + SIBLING_GAP_Y;
	}

	const maxX = nodes.reduce((m, n) => Math.max(m, n.x + n.w), 0);
	const maxY = nodes.reduce((m, n) => Math.max(m, n.y + n.h), 0);

	return { nodes, edges, width: maxX + 80, height: maxY + 80 };
}

// Dot-grid CSS: thicker, more visible
const DOT_BG_IMAGE =
	"radial-gradient(circle, var(--color-graphite) 1.5px, transparent 1.5px)";
const _DOT_BG_SIZE = "20px 20px";

interface WhiteboardCanvasProps {
	projectName?: string;
	taskTree?: TaskTree | null;
}

export const WhiteboardCanvas = memo(function WhiteboardCanvas({
	projectName = "Project",
	taskTree,
}: WhiteboardCanvasProps) {
	const {
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
	} = useCanvasZoom();
	const [openDetail, setOpenDetail] = useState<LayoutNode | null>(null);
	const [openTask, setOpenTask] = useState<LayoutNode | null>(null);

	const features = taskTree?.features ?? [];
	const isEmpty = features.length === 0;

	const {
		nodes,
		edges,
		width: canvasWidth,
		height: canvasHeight,
	} = useMemo(
		() =>
			taskTree && !isEmpty
				? layoutGraph(taskTree, projectName)
				: { nodes: [], edges: [], width: 0, height: 0 },
		[taskTree, projectName, isEmpty],
	);

	// While loading, the same layout engine sizes the skeleton, so the board
	// auto-fits a representative tree instead of a fixed empty canvas.
	const skeletonLayout = useMemo(
		() => (isEmpty ? layoutGraph(SKELETON_TREE, projectName) : null),
		[isEmpty, projectName],
	);
	const effectiveWidth = skeletonLayout?.width ?? canvasWidth;
	const effectiveHeight = skeletonLayout?.height ?? canvasHeight;

	// Auto-fit zoom: scale diagram to fit viewport
	const containerRef = useRef<HTMLDivElement>(null);
	const hasFittedRef = useRef(false);

	useEffect(() => {
		if (
			!effectiveWidth ||
			!effectiveHeight ||
			!containerRef.current ||
			hasFittedRef.current
		)
			return;
		hasFittedRef.current = true;

		const rect = containerRef.current.getBoundingClientRect();
		const padding = 60;
		const fitW = (rect.width - padding * 2) / effectiveWidth;
		const fitH = (rect.height - padding * 2) / effectiveHeight;
		const fitZoom = Math.min(fitW, fitH, 1);
		const clampedZoom = Math.max(minZoom, Math.min(maxZoom, fitZoom));

		setZoom(clampedZoom);
		const offsetX = (rect.width - effectiveWidth * clampedZoom) / 2;
		const offsetY = (rect.height - effectiveHeight * clampedZoom) / 2;
		setPan({ x: offsetX, y: offsetY });
	}, [effectiveWidth, effectiveHeight, setZoom, setPan, minZoom, maxZoom]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: taskTree triggers hasFittedRef reset
	useEffect(() => {
		hasFittedRef.current = false;
	}, [taskTree]);

	// Modal open freezes the board: pan/zoom/keyboard-nudge all no-op until closed.
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (openDetail || openTask) {
				if (e.key === "Escape") {
					setOpenDetail(null);
					setOpenTask(null);
				}
				return;
			}
			if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
				e.preventDefault();
				nudgePan(e.key, 40);
			}
		},
		[nudgePan, openDetail, openTask],
	);

	const handlePointerDown = useCallback(
		(e: React.PointerEvent) => {
			if (openDetail || openTask) return;
			// ponytail: blocks native text-selection drag that fought panning.
			if (e.pointerType === "mouse") e.preventDefault();
			startPan(e);
		},
		[openDetail, openTask, startPan],
	);

	const handlePointerMove = useCallback(
		(e: React.PointerEvent) => {
			if (openDetail || openTask) return;
			updatePan(e);
		},
		[openDetail, openTask, updatePan],
	);

	const handleWheel = useCallback(
		(e: React.WheelEvent) => {
			if (openDetail || openTask) return;
			onWheel(e);
		},
		[openDetail, openTask, onWheel],
	);

	// Stable openers keep memoized node components from re-rendering while
	// panning/zooming recreates this component's render output every frame.
	const handleOpenDetail = useCallback(
		(node: LayoutNode) => setOpenDetail(node),
		[],
	);
	const handleOpenTask = useCallback(
		(node: LayoutNode) => setOpenTask(node),
		[],
	);

	return (
		<div
			ref={containerRef}
			className="relative h-full w-full touch-none select-none overflow-hidden overscroll-none bg-onyx outline-none focus-visible:ring-2 focus-visible:ring-indigo/40 cursor-grab active:cursor-grabbing"
			style={{
				backgroundImage: DOT_BG_IMAGE,
				backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
				backgroundPosition: `${pan.x}px ${pan.y}px`,
			}}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={endPan}
			onPointerLeave={endPan}
			onWheel={handleWheel}
			onKeyDown={handleKeyDown}
			role="region"
			aria-label="Kanvas diagram task"
		>
			{isEmpty ? (
				<div
					className="absolute left-0 top-0 origin-top-left will-change-transform"
					style={{
						transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
						width: effectiveWidth,
						height: effectiveHeight,
					}}
				>
					<SkeletonDiagram />
				</div>
			) : (
				<>
					<div
						className="absolute left-0 top-0 origin-top-left will-change-transform"
						style={{
							transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
							width: canvasWidth,
							height: canvasHeight,
						}}
					>
						{/* SVG edges */}
						<Edges edges={edges} />

						{/* Nodes */}
						{nodes.map((node) => {
							if (node.type === "root")
								return <RootNode key={node.id} node={node} />;
							if (node.type === "feature")
								return <FeatureNode key={node.id} node={node} />;
							if (node.type === "detail")
								return (
									<DetailNode
										key={node.id}
										node={node}
										onOpen={handleOpenDetail}
									/>
								);
							return (
								<TaskCard key={node.id} node={node} onOpen={handleOpenTask} />
							);
						})}
					</div>

					<ZoomControls
						zoom={zoom}
						onZoomIn={zoomIn}
						onZoomOut={zoomOut}
						onReset={resetZoom}
						className="absolute bottom-4 left-4"
					/>
				</>
			)}
			{openDetail &&
				typeof document !== "undefined" &&
				createPortal(
					<DetailModal node={openDetail} onClose={() => setOpenDetail(null)} />,
					document.body,
				)}
			{openTask &&
				typeof document !== "undefined" &&
				createPortal(
					<TaskSubtasksModal
						node={openTask}
						onClose={() => setOpenTask(null)}
					/>,
					document.body,
				)}
		</div>
	);
});

/* ── Skeleton diagram ── */

/**
 * Loading representation only. It mirrors the real tree's spatial language by
 * running a fixed, synthetic tree through the SAME `layoutGraph` the actual
 * tasks use, so node geometry, depth, and edge routing can never drift from the
 * rendered board. Labels are never rendered (only shimmer bars), so no fake task
 * data is shown, and the shape is deliberately irregular — varied feature
 * heights, task counts, subtask counts, and detail depth — so the loading state
 * reads like a task tree instead of a symmetric placeholder.
 */
const SKELETON_TREE: TaskTree = {
	features: [
		{
			name: "Fitur",
			tasks: [
				{
					name: "Task",
					description: "",
					priority: "medium",
					covers: [],
					surfaces: [],
					subtasks: [
						{ name: "Subtask", description: "", details: ["", "", ""] },
						{ name: "Subtask", description: "", details: [""] },
					],
				},
				{
					name: "Task",
					description: "",
					priority: "medium",
					covers: [],
					surfaces: [],
					subtasks: [
						{ name: "Subtask", description: "", details: [""] },
						{ name: "Subtask", description: "", details: [""] },
						{ name: "Subtask", description: "", details: ["", ""] },
					],
				},
				{
					name: "Task",
					description: "",
					priority: "medium",
					covers: [],
					surfaces: [],
					subtasks: [{ name: "Subtask", description: "", details: [""] }],
				},
			],
		},
		{
			name: "Fitur",
			tasks: [
				{
					name: "Task",
					description: "",
					priority: "medium",
					covers: [],
					surfaces: [],
					subtasks: [
						{ name: "Subtask", description: "", details: ["", ""] },
						{ name: "Subtask", description: "", details: [""] },
						{ name: "Subtask", description: "", details: [""] },
						{ name: "Subtask", description: "", details: [""] },
					],
				},
				{
					name: "Task",
					description: "",
					priority: "medium",
					covers: [],
					surfaces: [],
					subtasks: [{ name: "Subtask", description: "", details: [""] }],
				},
			],
		},
		{
			name: "Fitur",
			tasks: [
				{
					name: "Task",
					description: "",
					priority: "medium",
					covers: [],
					surfaces: [],
					subtasks: [
						{ name: "Subtask", description: "", details: ["", ""] },
						{ name: "Subtask", description: "", details: [""] },
					],
				},
				{
					name: "Task",
					description: "",
					priority: "medium",
					covers: [],
					surfaces: [],
					subtasks: [
						{ name: "Subtask", description: "", details: [""] },
						{ name: "Subtask", description: "", details: [""] },
						{ name: "Subtask", description: "", details: [""] },
						{ name: "Subtask", description: "", details: [""] },
						{ name: "Subtask", description: "", details: [""] },
					],
				},
				{
					name: "Task",
					description: "",
					priority: "medium",
					covers: [],
					surfaces: [],
					subtasks: [
						{ name: "Subtask", description: "", details: [""] },
						{ name: "Subtask", description: "", details: [""] },
					],
				},
				{
					name: "Task",
					description: "",
					priority: "medium",
					covers: [],
					surfaces: [],
					subtasks: [{ name: "Subtask", description: "", details: [""] }],
				},
			],
		},
		{
			name: "Fitur",
			tasks: [
				{
					name: "Task",
					description: "",
					priority: "medium",
					covers: [],
					surfaces: [],
					subtasks: [
						{ name: "Subtask", description: "", details: ["", "", ""] },
						{ name: "Subtask", description: "", details: [""] },
					],
				},
				{
					name: "Task",
					description: "",
					priority: "medium",
					covers: [],
					surfaces: [],
					subtasks: [
						{ name: "Subtask", description: "", details: [""] },
						{ name: "Subtask", description: "", details: [""] },
					],
				},
				{
					name: "Task",
					description: "",
					priority: "medium",
					covers: [],
					surfaces: [],
					subtasks: [{ name: "Subtask", description: "", details: [""] }],
				},
			],
		},
		{
			name: "Fitur",
			tasks: [
				{
					name: "Task",
					description: "",
					priority: "medium",
					covers: [],
					surfaces: [],
					subtasks: [
						{ name: "Subtask", description: "", details: ["", ""] },
						{ name: "Subtask", description: "", details: [""] },
					],
				},
				{
					name: "Task",
					description: "",
					priority: "medium",
					covers: [],
					surfaces: [],
					subtasks: [
						{ name: "Subtask", description: "", details: [""] },
						{ name: "Subtask", description: "", details: ["", ""] },
					],
				},
			],
		},
	],
};

const SKELETON_BAR = "rounded bg-fog/10";

/** Ghost shells mirroring the real node types, sized by the shared layout. */
function SkeletonDiagram() {
	const { nodes, edges } = useMemo(
		() => layoutGraph(SKELETON_TREE, "Project"),
		[],
	);

	return (
		<>
			<Edges edges={edges} />
			{nodes.map((node) => {
				if (node.type === "root") {
					return (
						<div
							key={node.id}
							className="absolute flex animate-pulse items-center justify-center rounded-xl border-2 border-fog/20 bg-fog/5"
							style={{
								left: node.x,
								top: node.y,
								width: node.w,
								height: node.h,
							}}
						>
							<div className={`h-4 w-24 ${SKELETON_BAR}`} />
						</div>
					);
				}
				if (node.type === "feature") {
					return (
						<div
							key={node.id}
							className="absolute animate-pulse rounded-lg border border-fog/15 bg-fog/5"
							style={{
								left: node.x,
								top: node.y,
								width: node.w,
								height: node.h,
							}}
						>
							<div className="flex h-full flex-col justify-center gap-2 px-4">
								<div className={`h-3 w-12 ${SKELETON_BAR}`} />
								<div className={`h-4 w-36 ${SKELETON_BAR}`} />
							</div>
						</div>
					);
				}
				if (node.type === "detail") {
					return (
						<div
							key={node.id}
							className="absolute animate-pulse rounded-md border border-fog/10 bg-fog/[0.03]"
							style={{
								left: node.x,
								top: node.y,
								width: node.w,
								height: node.h,
							}}
						>
							<div className="px-3 pt-2 pb-1.5">
								<div className={`h-2.5 w-16 ${SKELETON_BAR}`} />
							</div>
							<div className="space-y-1.5 px-3 pb-2">
								<div className={`h-2.5 w-32 ${SKELETON_BAR}`} />
								<div className={`h-2.5 w-24 ${SKELETON_BAR}`} />
							</div>
						</div>
					);
				}
				return (
					<div
						key={node.id}
						className="absolute animate-pulse rounded-lg border border-fog/10 bg-fog/[0.03]"
						style={{
							left: node.x,
							top: node.y,
							width: node.w,
							height: node.h,
						}}
					>
						<div className="border-b border-fog/10 px-3 py-2.5">
							<div className={`h-3 w-28 ${SKELETON_BAR}`} />
						</div>
						<div className="space-y-2 px-3 py-2">
							{Array.from(
								{
									length: Math.min(
										node.subtasks?.length ?? 0,
										MAX_VISIBLE_SUBTASKS,
									),
								},
								(_, index) => (
									<div
										// biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows are positional
										key={index}
										className="flex items-center gap-2"
									>
										<div className="h-3.5 w-3.5 shrink-0 rounded border border-fog/15" />
										<div className={`h-2.5 w-24 ${SKELETON_BAR}`} />
									</div>
								),
							)}
						</div>
					</div>
				);
			})}
		</>
	);
}

/* ── Node components ── */

// ponytail: memoized so per-frame pan/zoom renders of WhiteboardCanvas skip
// re-rendering every node (props are stable: layoutGraph is useMemo'd and
// openers are stable setState wrappers).
const Edges = memo(function Edges({ edges }: { edges: LayoutEdge[] }) {
	return (
		<svg
			aria-hidden
			className="pointer-events-none absolute left-0 top-0"
			width="100%"
			height="100%"
			style={{ overflow: "visible" }}
		>
			{edges.map((e) => {
				const midX = (e.x1 + e.x2) / 2;
				return (
					<path
						key={`edge-${e.x1}-${e.y1}-${e.x2}-${e.y2}`}
						d={`M ${e.x1} ${e.y1} C ${midX} ${e.y1}, ${midX} ${e.y2}, ${e.x2} ${e.y2}`}
						fill="none"
						stroke={e.color}
						strokeWidth={1.5}
						strokeOpacity={0.5}
					/>
				);
			})}
		</svg>
	);
});

const RootNode = memo(function RootNode({ node }: { node: LayoutNode }) {
	return (
		<div
			className="absolute flex items-center justify-center rounded-xl border-2 border-indigo/60 bg-indigo/10 shadow-lg shadow-indigo/10 animate-fadeIn"
			style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
		>
			<span className="truncate px-4 font-inter text-sm font-semibold text-snow">
				{node.label}
			</span>
		</div>
	);
});

const FeatureNode = memo(function FeatureNode({ node }: { node: LayoutNode }) {
	const color = COLORS[node.colorIdx];
	return (
		<div
			className={`absolute rounded-lg border ${color.border} ${color.bg} shadow-md animate-fadeIn`}
			style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
		>
			<div className="flex h-full flex-col justify-center px-4">
				<div className="mb-1 flex items-center gap-2">
					<span
						className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white ${color.badge}`}
					>
						Fase {node.phase}
					</span>
					<span className="text-[10px] text-fog">Direncanakan</span>
				</div>
				<p
					className="truncate font-inter text-sm font-[510] text-snow"
					title={node.label}
				>
					{node.label}
				</p>
			</div>
		</div>
	);
});

const DetailNode = memo(function DetailNode({
	node,
	onOpen,
}: {
	node: LayoutNode;
	onOpen: (node: LayoutNode) => void;
}) {
	const color = COLORS[node.colorIdx];
	return (
		<div
			className={`absolute overflow-hidden rounded-md border ${color.border} bg-obsidian shadow-sm animate-fadeIn cursor-pointer`}
			style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
			onClick={(e) => {
				e.stopPropagation();
				onOpen(node);
			}}
			onPointerDown={(e) => e.stopPropagation()}
		>
			<div className="px-3 pt-2 pb-1.5">
				<p
					className="truncate text-[9px] uppercase tracking-wide text-fog/60"
					title={node.parentSubtask}
				>
					{node.parentSubtask}
				</p>
			</div>
			<ul className="px-3">
				{(node.details ?? []).slice(0, MAX_VISIBLE_DETAILS).map((d) => (
					<li
						key={d}
						className="flex items-start gap-1.5 truncate font-inter text-[11px] leading-5 text-snow"
						title={d}
					>
						<span
							className={`mt-[7px] size-1 shrink-0 rounded-full ${color.badge}`}
						/>
						<span className="truncate">{d}</span>
					</li>
				))}
			</ul>
			{(node.totalDetails ?? 0) > MAX_VISIBLE_DETAILS && (
				<p className="px-3 pt-1 text-[10px] font-[510] text-indigo">
					+{(node.totalDetails ?? 0) - MAX_VISIBLE_DETAILS} lainnya
				</p>
			)}
		</div>
	);
});

// Rendered via portal to document.body, must not live under the canvas's
// panned/scaled wrapper, since `fixed` positioning is relative to the nearest
// transformed ancestor, not the viewport, and would render mispositioned.
function DetailModal({
	node,
	onClose,
}: {
	node: LayoutNode;
	onClose: () => void;
}) {
	const color = COLORS[node.colorIdx];
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-in fade-in duration-200"
			onClick={onClose}
		>
			<div
				className={`w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-xl border ${color.border} bg-obsidian p-5 shadow-[var(--shadow-overlay)] animate-in zoom-in-95 duration-200`}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="mb-4 flex items-start justify-between gap-3">
					<div className="min-w-0">
						<p className="text-[10px] uppercase tracking-wide text-fog/60">
							Detail subtask
						</p>
						<p className="font-inter text-sm font-[510] text-snow">
							{node.parentSubtask}
						</p>
					</div>
					<button
						onClick={onClose}
						className="ml-auto shrink-0 text-fog transition-colors hover:text-snow"
					>
						<X size={18} />
					</button>
				</div>
				<ul className="space-y-2">
					{(node.details ?? []).map((d) => (
						<li key={d} className="flex items-start gap-2">
							<span
								className={`mt-1.5 size-1.5 shrink-0 rounded-full ${color.badge}`}
							/>
							<span className="font-inter text-sm leading-relaxed text-snow">
								{d}
							</span>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}

// Modal daftar subtask: UI match DetailModal (portal, overlay, color border, X close).
function TaskSubtasksModal({
	node,
	onClose,
}: {
	node: LayoutNode;
	onClose: () => void;
}) {
	const color = COLORS[node.colorIdx];
	const allSubtasks = node.subtasks ?? [];
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 animate-in fade-in duration-200"
			onClick={onClose}
		>
			<div
				className={`w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-xl border ${color.border} bg-obsidian p-5 shadow-[var(--shadow-overlay)] animate-in zoom-in-95 duration-200`}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="mb-4 flex items-center gap-2">
					<div className={`h-2 w-2 shrink-0 rounded-full ${color.badge}`} />
					<p className="truncate font-inter text-sm font-[510] text-snow">
						{node.label}
					</p>
					<span className="ml-auto shrink-0 text-xs text-fog">
						{allSubtasks.length} subtask
					</span>
					<button
						onClick={onClose}
						className="shrink-0 text-fog transition-colors hover:text-snow"
					>
						<X size={18} />
					</button>
				</div>
				<ul className="space-y-2">
					{allSubtasks.map((s) => (
						<li
							key={s.name}
							className="rounded-lg border border-graphite/60 bg-charcoal/40 px-3 py-2"
						>
							<p className="font-inter text-sm text-snow">{s.name}</p>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}

const TaskCard = memo(function TaskCard({
	node,
	onOpen,
}: {
	node: LayoutNode;
	onOpen: (node: LayoutNode) => void;
}) {
	const color = COLORS[node.colorIdx];
	const allSubtasks = node.subtasks ?? [];
	const total = node.totalSubtasks ?? allSubtasks.length;
	const hasMore = total > MAX_VISIBLE_SUBTASKS;
	const visibleSubtasks = allSubtasks.slice(0, MAX_VISIBLE_SUBTASKS);

	return (
		<div
			className="absolute rounded-lg border border-graphite bg-obsidian shadow-md animate-fadeIn"
			style={{ left: node.x, top: node.y, width: node.w }}
		>
			{/* Header */}
			<div className="flex items-center gap-2 border-b border-graphite/60 px-3 py-2.5">
				<div className={`h-2 w-2 shrink-0 rounded-full ${color.badge}`} />
				<p
					className="truncate font-inter text-xs font-[510] text-snow"
					title={node.label}
				>
					{node.label}
				</p>
			</div>

			{/* Subtask checklist (collapsed preview, max 3) */}
			{visibleSubtasks.length > 0 && (
				<ul className="px-3 py-2 space-y-1">
					{visibleSubtasks.map((s) => (
						<li
							key={s.name}
							className="flex items-center gap-2 text-xs text-fog"
						>
							<span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-graphite bg-charcoal">
								<span className="h-1.5 w-1.5 rounded-sm bg-fog/30" />
							</span>
							<span className="truncate">{s.name}</span>
						</li>
					))}
				</ul>
			)}

			{/* "Lihat semua" → modal */}
			{hasMore && (
				<div className="border-t border-graphite/40 px-3 py-1.5">
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onOpen(node);
						}}
						onPointerDown={(e) => e.stopPropagation()}
						className="flex items-center gap-1 text-[10px] font-[510] text-indigo hover:text-indigo/80 transition-colors"
					>
						Lihat semua ({total}) <ChevronRight size={10} />
					</button>
				</div>
			)}
		</div>
	);
});
