import type { Stroke } from "./board";

function distToSegment(
	px: number,
	py: number,
	ax: number,
	ay: number,
	bx: number,
	by: number,
): number {
	const dx = bx - ax;
	const dy = by - ay;
	const len2 = dx * dx + dy * dy;
	const t =
		len2 === 0
			? 0
			: Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** True if (x, y) is within `radius` of the stroke's outline (stroke half-width included). */
export function strokeHit(
	stroke: Stroke,
	x: number,
	y: number,
	radius: number,
): boolean {
	const reach = radius + stroke.size / 2;
	const pts = stroke.points;
	if (pts.length === 1)
		return Math.hypot(x - pts[0][0], y - pts[0][1]) <= reach;
	for (let i = 1; i < pts.length; i++) {
		if (
			distToSegment(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <=
			reach
		)
			return true;
	}
	return false;
}

/** Topmost (last drawn) stroke under the eraser, if any. */
export function findHit(
	strokes: Stroke[],
	x: number,
	y: number,
	radius: number,
): Stroke | undefined {
	for (let i = strokes.length - 1; i >= 0; i--) {
		if (strokeHit(strokes[i], x, y, radius)) return strokes[i];
	}
	return undefined;
}
