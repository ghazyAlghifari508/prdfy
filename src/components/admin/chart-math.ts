function fmt(n: number): number {
	return Number(n.toFixed(1));
}

export function generateSplinePath(points: { x: number; y: number }[]): string {
	const validPoints = points.filter(
		(p) => Number.isFinite(p.x) && Number.isFinite(p.y),
	);
	if (validPoints.length === 0) return "";
	if (validPoints.length === 1)
		return `M ${fmt(validPoints[0].x)} ${fmt(validPoints[0].y)}`;

	let d = `M ${fmt(validPoints[0].x)} ${fmt(validPoints[0].y)}`;

	for (let i = 0; i < validPoints.length - 1; i++) {
		const p0 = validPoints[i === 0 ? 0 : i - 1];
		const p1 = validPoints[i];
		const p2 = validPoints[i + 1];
		const p3 =
			validPoints[i + 2 >= validPoints.length ? validPoints.length - 1 : i + 2];

		const cp1x = p1.x + (p2.x - p0.x) / 6;
		const cp1y = p1.y + (p2.y - p0.y) / 6;
		const cp2x = p2.x - (p3.x - p1.x) / 6;
		const cp2y = p2.y - (p3.y - p1.y) / 6;

		d += ` C ${fmt(cp1x)} ${fmt(cp1y)}, ${fmt(cp2x)} ${fmt(cp2y)}, ${fmt(p2.x)} ${fmt(p2.y)}`;
	}

	return d;
}

export function generateAreaPath(
	points: { x: number; y: number }[],
	baselineY: number,
): string {
	if (points.length < 2) return "";
	const spline = generateSplinePath(points);
	const lastPoint = points[points.length - 1];
	const firstPoint = points[0];
	return `${spline} L ${fmt(lastPoint.x)} ${fmt(baselineY)} L ${fmt(firstPoint.x)} ${fmt(baselineY)} Z`;
}

export function calculateYScale(
	values: number[],
	height: number,
	paddingTop: number,
	paddingBottom: number,
	minCeil = 4,
): { scale: (v: number) => number; ticks: number[] } {
	let rawMax = 0;
	for (const v of values) {
		if (Number.isFinite(v) && v > rawMax) {
			rawMax = v;
		}
	}
	const max = Math.max(rawMax, minCeil);

	// Calculate nice step
	const roughStep = max / 4;
	const power = 10 ** Math.floor(Math.log10(roughStep || 1));
	const normalized = roughStep / power;
	let niceStep = power;
	if (normalized > 5) niceStep = 10 * power;
	else if (normalized > 2) niceStep = 5 * power;
	else if (normalized > 1) niceStep = 2 * power;

	const topTick = Math.max(niceStep * 4, max);
	const ticks = [
		0,
		Math.round(topTick * 0.25),
		Math.round(topTick * 0.5),
		Math.round(topTick * 0.75),
		Math.round(topTick),
	];

	const availableHeight = height - paddingTop - paddingBottom;
	const scale = (val: number) => {
		const ratio = Math.max(0, Math.min(1, val / (topTick || 1)));
		return height - paddingBottom - ratio * availableHeight;
	};

	return { scale, ticks };
}
