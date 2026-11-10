import type { Stroke } from "./board";
import { fontSizeOf, textBox } from "./text";
import type { Rect } from "./viewport";

/** Box around a stroke including its width, used to skip strokes outside the view. */
export function strokeBounds(stroke: Stroke): Rect {
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
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const [x, y] of stroke.points) {
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
	}
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
