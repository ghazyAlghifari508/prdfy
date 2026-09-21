import { TrendingUp } from "lucide-react";
import type React from "react";
import { useCallback, useId, useMemo, useState } from "react";
import { useStreamerMode } from "@/components/admin/streamer-mode-context";
import type { DailyTrendPoint } from "@/lib/services/admin-trend-utils";
import { cn, formatCurrency } from "@/lib/utils";
import {
	calculateYScale,
	generateAreaPath,
	generateSplinePath,
} from "./chart-math";

export interface TrendLineChartProps {
	initialData?: DailyTrendPoint[];
	data?: DailyTrendPoint[];
	onRangeChange?: (days: number) => void;
	isStreamerMode?: boolean;
	className?: string;
}

const RANGE_OPTIONS = [
	{ days: 7, label: "7 Hari" },
	{ days: 14, label: "14 Hari" },
	{ days: 30, label: "30 Hari" },
] as const;

const SVG_WIDTH = 1000;
const SVG_HEIGHT = 340;
const PADDING_LEFT = 75;
const PADDING_RIGHT = 45;
const PADDING_TOP = 30;
const PADDING_BOTTOM = 40;

function formatCompactCurrency(amount: number): string {
	if (amount === 0) return "Rp 0";
	if (amount >= 1_000_000) {
		const val = amount / 1_000_000;
		return `Rp ${Number.isInteger(val) ? val : val.toFixed(1)}jt`;
	}
	if (amount >= 1_000) {
		const val = amount / 1_000;
		return `Rp ${Number.isInteger(val) ? val : val.toFixed(1)}k`;
	}
	return `Rp ${amount}`;
}

export function TrendLineChart({
	initialData = [],
	data,
	onRangeChange,
	isStreamerMode: propStreamerMode,
	className,
}: TrendLineChartProps) {
	const chartId = useId().replace(/:/g, "_");
	const revGradId = `rev-grad-${chartId}`;
	const userGradId = `user-grad-${chartId}`;

	const { isStreamerMode: contextStreamerMode } = useStreamerMode();
	const streamerActive =
		propStreamerMode !== undefined ? propStreamerMode : contextStreamerMode;

	const [selectedRange, setSelectedRange] = useState<number>(7);
	const [hoverIndex, setHoverIndex] = useState<number | null>(null);

	const rawData = data ?? initialData;
	const currentData = useMemo(() => {
		if (rawData.length <= selectedRange) return rawData;
		return rawData.slice(-selectedRange);
	}, [rawData, selectedRange]);

	const pointCount = currentData.length;
	const chartWidth = SVG_WIDTH - PADDING_LEFT - PADDING_RIGHT;
	const baselineY = SVG_HEIGHT - PADDING_BOTTOM;

	const handleRangeChange = (days: number) => {
		setSelectedRange(days);
		setHoverIndex(null);
		onRangeChange?.(days);
	};

	const totalRevenue = useMemo(
		() =>
			currentData.reduce(
				(acc, curr) => acc + (Number.isFinite(curr.revenue) ? curr.revenue : 0),
				0,
			),
		[currentData],
	);

	const totalNewUsers = useMemo(
		() =>
			currentData.reduce(
				(acc, curr) =>
					acc + (Number.isFinite(curr.newUsers) ? curr.newUsers : 0),
				0,
			),
		[currentData],
	);

	const getX = useCallback(
		(index: number) => {
			if (pointCount <= 1) return PADDING_LEFT + chartWidth / 2;
			return PADDING_LEFT + (index / (pointCount - 1)) * chartWidth;
		},
		[pointCount, chartWidth],
	);

	const revValues = useMemo(
		() => currentData.map((d) => d.revenue),
		[currentData],
	);
	const revScaleInfo = useMemo(
		() =>
			calculateYScale(
				revValues,
				SVG_HEIGHT,
				PADDING_TOP,
				PADDING_BOTTOM,
				100000,
			),
		[revValues],
	);

	const userValues = useMemo(
		() => currentData.map((d) => d.newUsers),
		[currentData],
	);
	const userScaleInfo = useMemo(
		() =>
			calculateYScale(userValues, SVG_HEIGHT, PADDING_TOP, PADDING_BOTTOM, 4),
		[userValues],
	);

	const revPoints = useMemo(() => {
		const count = currentData.length;
		return currentData.map((d, i) => {
			const x =
				count <= 1
					? PADDING_LEFT + chartWidth / 2
					: PADDING_LEFT + (i / (count - 1)) * chartWidth;
			return {
				x,
				y: revScaleInfo.scale(d.revenue),
			};
		});
	}, [currentData, revScaleInfo, chartWidth]);

	const userPoints = useMemo(() => {
		const count = currentData.length;
		return currentData.map((d, i) => {
			const x =
				count <= 1
					? PADDING_LEFT + chartWidth / 2
					: PADDING_LEFT + (i / (count - 1)) * chartWidth;
			return {
				x,
				y: userScaleInfo.scale(d.newUsers),
			};
		});
	}, [currentData, userScaleInfo, chartWidth]);

	const revSpline = useMemo(() => generateSplinePath(revPoints), [revPoints]);
	const revArea = useMemo(
		() => generateAreaPath(revPoints, baselineY),
		[revPoints, baselineY],
	);

	const userSpline = useMemo(
		() => generateSplinePath(userPoints),
		[userPoints],
	);
	const userArea = useMemo(
		() => generateAreaPath(userPoints, baselineY),
		[userPoints, baselineY],
	);

	const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
		if (pointCount === 0) return;
		const rect = e.currentTarget.getBoundingClientRect();
		const mouseX = e.clientX - rect.left;
		const relativeX = (mouseX / rect.width) * SVG_WIDTH;

		if (pointCount === 1) {
			setHoverIndex(0);
			return;
		}

		const clampedX = Math.max(
			PADDING_LEFT,
			Math.min(SVG_WIDTH - PADDING_RIGHT, relativeX),
		);
		const ratio = (clampedX - PADDING_LEFT) / chartWidth;
		const nearest = Math.round(ratio * (pointCount - 1));
		const safeIndex = Math.max(0, Math.min(pointCount - 1, nearest));
		setHoverIndex(safeIndex);
	};

	const handleMouseLeave = () => {
		setHoverIndex(null);
	};

	const hoveredItem =
		hoverIndex !== null && hoverIndex < currentData.length
			? currentData[hoverIndex]
			: null;
	const hoveredX = hoverIndex !== null ? getX(hoverIndex) : null;
	const hoveredRevY =
		hoveredItem !== null ? revScaleInfo.scale(hoveredItem.revenue) : null;
	const hoveredUserY =
		hoveredItem !== null ? userScaleInfo.scale(hoveredItem.newUsers) : null;

	return (
		<div
			className={cn(
				"rounded-xl border border-graphite bg-charcoal p-4 sm:p-6 shadow-[var(--shadow-inset)] flex flex-col gap-5",
				className,
			)}
		>
			{/* Top Header */}
			<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
				<div className="flex items-start gap-3">
					<div className="mt-0.5 rounded-lg border border-graphite bg-obsidian p-2 text-emerald-400 shadow-sm">
						<TrendingUp size={18} />
					</div>
					<div>
						<h3 className="text-base font-medium text-snow">
							Tren {selectedRange} Hari Terakhir
						</h3>
						<p className="text-xs text-fog mt-0.5">
							Performa pendapatan dan pendaftaran baru dari data nyata.
						</p>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-3 sm:gap-4">
					{/* Range Filter Pills */}
					<div className="inline-flex rounded-lg border border-graphite bg-obsidian p-0.5">
						{RANGE_OPTIONS.map((opt) => {
							const isActive = selectedRange === opt.days;
							return (
								<button
									key={opt.days}
									type="button"
									onClick={() => handleRangeChange(opt.days)}
									className={cn(
										"px-2.5 py-1 text-xs font-medium rounded-md transition-all",
										isActive
											? "bg-graphite text-snow shadow-sm"
											: "text-fog hover:text-snow hover:bg-graphite/40",
									)}
								>
									{opt.label}
								</button>
							);
						})}
					</div>

					{/* Legend & Totals */}
					<div className="flex items-center gap-3 rounded-lg border border-graphite bg-obsidian/70 px-3 py-1.5 text-xs">
						<div className="flex items-center gap-1.5">
							<span className="h-2 w-2 rounded-full bg-emerald-500" />
							<span className="text-fog">Pendapatan:</span>
							<span className="font-mono font-medium text-snow">
								{streamerActive ? "••••••••" : formatCurrency(totalRevenue)}
							</span>
						</div>
						<div className="h-3 w-[1px] bg-graphite" />
						<div className="flex items-center gap-1.5">
							<span className="h-2 w-2 rounded-full bg-indigo-500" />
							<span className="text-fog">Pengguna Baru:</span>
							<span className="font-mono font-medium text-snow">
								{totalNewUsers}
							</span>
						</div>
					</div>
				</div>
			</div>

			{/* Chart Display Area */}
			<div className="relative w-full overflow-hidden select-none">
				{pointCount === 0 ? (
					<div className="flex h-64 items-center justify-center text-xs text-fog">
						Belum ada data tren untuk periode ini
					</div>
				) : (
					<>
						<svg
							viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
							className="w-full h-auto max-h-[340px] overflow-visible cursor-crosshair"
							onMouseMove={handleMouseMove}
							onMouseLeave={handleMouseLeave}
							role="img"
							aria-label="Grafik tren pendapatan dan pengguna baru"
						>
							<defs>
								{/* Revenue emerald gradient */}
								<linearGradient id={revGradId} x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor="#10b981" stopOpacity="0.28" />
									<stop offset="85%" stopColor="#10b981" stopOpacity="0.02" />
									<stop offset="100%" stopColor="#10b981" stopOpacity="0" />
								</linearGradient>

								{/* Users indigo gradient */}
								<linearGradient id={userGradId} x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor="#6366f1" stopOpacity="0.22" />
									<stop offset="85%" stopColor="#6366f1" stopOpacity="0.02" />
									<stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
								</linearGradient>
							</defs>

							{/* Horizontal Grid lines & Dual Y-Axis ticks */}
							{revScaleInfo.ticks.map((revTick, index) => {
								const y = revScaleInfo.scale(revTick);
								const userTick =
									userScaleInfo.ticks[index] ??
									userScaleInfo.ticks[userScaleInfo.ticks.length - 1];

								return (
									<g key={`grid-tick-${revTick}`}>
										<line
											x1={PADDING_LEFT}
											y1={y}
											x2={SVG_WIDTH - PADDING_RIGHT}
											y2={y}
											stroke="#23252a"
											strokeDasharray="4 4"
											strokeWidth="1"
										/>
										{/* Left Y Label: Revenue */}
										<text
											x={PADDING_LEFT - 12}
											y={y + 4}
											textAnchor="end"
											className="fill-fog text-[11px] font-mono select-none"
										>
											{streamerActive ? "••••" : formatCompactCurrency(revTick)}
										</text>
										{/* Right Y Label: Users */}
										<text
											x={SVG_WIDTH - PADDING_RIGHT + 12}
											y={y + 4}
											textAnchor="start"
											className="fill-fog text-[11px] font-mono select-none"
										>
											{userTick}
										</text>
									</g>
								);
							})}

							{/* X-Axis Date Labels */}
							{(() => {
								const step =
									pointCount <= 8
										? 1
										: pointCount <= 14
											? 2
											: pointCount <= 21
												? 3
												: 4;
								return currentData.map((item, i) => {
									const x = getX(i);
									const isLast = i === pointCount - 1;
									const isStep = i % step === 0;
									const showLabel =
										isLast || (isStep && pointCount - 1 - i >= step * 0.6);

									if (!showLabel) return null;

									return (
										<text
											key={`date-lbl-${item.date}-${item.label}-${getX(i)}`}
											x={x}
											y={baselineY + 22}
											textAnchor="middle"
											className="fill-fog text-[11px] select-none"
										>
											{item.label}
										</text>
									);
								});
							})()}

							{/* Area Fills */}
							{userArea && (
								<path
									d={userArea}
									fill={`url(#${userGradId})`}
									className="pointer-events-none transition-all duration-300"
								/>
							)}
							{!streamerActive && revArea && (
								<path
									d={revArea}
									fill={`url(#${revGradId})`}
									className="pointer-events-none transition-all duration-300"
								/>
							)}

							{/* Spline Curves */}
							{userSpline && (
								<path
									d={userSpline}
									fill="none"
									stroke="#6366f1"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									className="pointer-events-none transition-all duration-300"
								/>
							)}
							{!streamerActive && revSpline && (
								<path
									d={revSpline}
									fill="none"
									stroke="#10b981"
									strokeWidth="2.5"
									strokeLinecap="round"
									strokeLinejoin="round"
									className="pointer-events-none transition-all duration-300"
								/>
							)}

							{/* Active Hover Crosshair & Indicators */}
							{hoveredX !== null &&
								hoveredRevY !== null &&
								hoveredUserY !== null && (
									<g className="pointer-events-none">
										{/* Vertical Crosshair Line */}
										<line
											x1={hoveredX}
											y1={PADDING_TOP}
											x2={hoveredX}
											y2={baselineY}
											stroke="#8a8f98"
											strokeDasharray="3 3"
											strokeWidth="1.5"
											opacity="0.6"
										/>

										{/* Revenue Indicator Dots */}
										{!streamerActive && (
											<>
												<circle
													cx={hoveredX}
													cy={hoveredRevY}
													r="8"
													fill="#10b981"
													fillOpacity="0.25"
												/>
												<circle
													cx={hoveredX}
													cy={hoveredRevY}
													r="4.5"
													fill="#10b981"
													stroke="#0f1011"
													strokeWidth="2"
												/>
											</>
										)}

										{/* Users Indicator Dots */}
										<circle
											cx={hoveredX}
											cy={hoveredUserY}
											r="8"
											fill="#6366f1"
											fillOpacity="0.25"
										/>
										<circle
											cx={hoveredX}
											cy={hoveredUserY}
											r="4"
											fill="#6366f1"
											stroke="#0f1011"
											strokeWidth="2"
										/>
									</g>
								)}
						</svg>

						{/* Floating Crosshair Glassmorphic Tooltip */}
						{hoveredItem && hoveredX !== null && (
							<div
								className="pointer-events-none absolute z-10 hidden sm:flex flex-col gap-1.5 rounded-lg border border-graphite bg-charcoal/95 px-3 py-2 text-xs shadow-xl backdrop-blur-md transition-transform duration-75"
								style={{
									left: `${(hoveredX / SVG_WIDTH) * 100}%`,
									top: "12px",
									transform:
										hoveredX < SVG_WIDTH * 0.2
											? "translateX(10%)"
											: hoveredX > SVG_WIDTH * 0.8
												? "translateX(-110%)"
												: "translateX(-50%)",
								}}
							>
								<div className="text-[11px] font-medium text-fog">
									{hoveredItem.label} ({hoveredItem.date})
								</div>
								<div className="flex items-center gap-2">
									<span className="h-2 w-2 rounded-full bg-emerald-500" />
									<span className="text-mist">Pendapatan:</span>
									<span className="font-mono font-medium text-emerald-400">
										{streamerActive
											? "••••••••"
											: formatCurrency(hoveredItem.revenue)}
									</span>
								</div>
								<div className="flex items-center gap-2">
									<span className="h-2 w-2 rounded-full bg-indigo-500" />
									<span className="text-mist">Pengguna Baru:</span>
									<span className="font-mono font-medium text-indigo-400">
										{hoveredItem.newUsers} user
									</span>
								</div>
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}
