import type { Stroke } from "./board";
import { fontSizeOf, textBox } from "./text";
import { centerOf, pointsBox, rotatePoint } from "./transform";
import type { Rect } from "./viewport";

/** Box around an element as it appears on the board: its padded box, turned by its rotation. */
export function strokeBounds(stroke: Stroke): Rect {
	const r = plainBounds(stroke);
	if (!stroke.rot) return r;
	const c = centerOf(stroke);
	const corners = [
		[r.minX, r.minY],
		[r.maxX, r.minY],
		[r.maxX, r.maxY],
		[r.minX, r.maxY],
	].map((p) => rotatePoint(p as [number, number], c, stroke.rot as number));
	const xs = corners.map((p) => p[0]);
	const ys = corners.map((p) => p[1]);
	return {
		minX: Math.min(...xs),
		minY: Math.min(...ys),
		maxX: Math.max(...xs),
		maxY: Math.max(...ys),
	};
}

/** Box around an element before rotation, including its line width. */
function plainBounds(stroke: Stroke): Rect {
	if (stroke.kind === "text") {
		// The width is estimated, so leave generous slack.
		const box = textBox(stroke);
		const pad = fontSizeOf(stroke);
		return {
			minX: box.minX - pad,
			minY: box.minY - pad,
			maxX: box.maxX + pad,
			maxY: box.maxY + pad,
		};
	}
	if (stroke.kind === "image") {
		const [a, b] = stroke.points;
		return {
			minX: Math.min(a[0], b[0]),
			minY: Math.min(a[1], b[1]),
			maxX: Math.max(a[0], b[0]),
			maxY: Math.max(a[1], b[1]),
		};
	}
	if (stroke.kind === "circle") {
		const [c, edge] = stroke.points;
		const r = Math.hypot(edge[0] - c[0], edge[1] - c[1]) + stroke.size;
		return { minX: c[0] - r, minY: c[1] - r, maxX: c[0] + r, maxY: c[1] + r };
	}
	const { minX, minY, maxX, maxY } = pointsBox(stroke);
	const pad = stroke.size;
	return {
		minX: minX - pad,
		minY: minY - pad,
		maxX: maxX + pad,
		maxY: maxY + pad,
	};
}

/** True if the two rectangles overlap (touching counts). */
export function intersects(a: Rect, b: Rect): boolean {
	return (
		a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
	);
}
