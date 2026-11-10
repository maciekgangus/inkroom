import type { Stroke } from "./board";
import type { Rect } from "./viewport";

/** Largest part of the view a freshly placed image may take. */
const VIEW_SHARE = 0.6;

/** Scales (w, h) down so the longer side is at most `max`; never enlarges. */
export function fitWithin(
	w: number,
	h: number,
	max: number,
): { w: number; h: number } {
	const longest = Math.max(w, h);
	if (longest <= max) return { w, h };
	const k = max / longest;
	return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** The box between an image element's two corners. */
export function imageRect(el: Stroke): Rect {
	const [a, b] = el.points;
	return {
		minX: Math.min(a[0], b[0]),
		minY: Math.min(a[1], b[1]),
		maxX: Math.max(a[0], b[0]),
		maxY: Math.max(a[1], b[1]),
	};
}

/** Size for a new image: its natural size, but at most 60% of the visible width and height. */
export function defaultSize(
	naturalW: number,
	naturalH: number,
	view: Rect,
): { w: number; h: number } {
	const k = Math.min(
		1,
		(VIEW_SHARE * (view.maxX - view.minX)) / naturalW,
		(VIEW_SHARE * (view.maxY - view.minY)) / naturalH,
	);
	return { w: naturalW * k, h: naturalH * k };
}

/** Top-left corner that centres an image of `size` in the view. */
export function placeCentered(
	size: { w: number; h: number },
	view: Rect,
): [number, number] {
	return [
		(view.minX + view.maxX) / 2 - size.w / 2,
		(view.minY + view.maxY) / 2 - size.h / 2,
	];
}
