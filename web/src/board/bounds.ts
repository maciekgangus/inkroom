import type { Stroke } from "./board";
import type { Rect } from "./viewport";

/** Box around a stroke including its width, used to skip strokes outside the view. */
export function strokeBounds(stroke: Stroke): Rect {
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
