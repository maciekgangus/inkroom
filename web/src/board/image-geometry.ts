import type { Stroke } from "./board";
import type { Rect } from "./viewport";

export type Corner = "nw" | "ne" | "sw" | "se";

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

export function moveRect(r: Rect, dx: number, dy: number): Rect {
	return {
		minX: r.minX + dx,
		minY: r.minY + dy,
		maxX: r.maxX + dx,
		maxY: r.maxY + dy,
	};
}

/**
 * Resizes a rectangle by dragging one corner while the opposite corner stays fixed. The
 * proportions are kept; the result never gets narrower than `minWidth` and never flips
 * over the fixed corner.
 */
export function resizeFromCorner(
	r: Rect,
	corner: Corner,
	pointer: [number, number],
	minWidth: number,
): Rect {
	const w = r.maxX - r.minX;
	const h = r.maxY - r.minY;
	const east = corner === "ne" || corner === "se";
	const south = corner === "sw" || corner === "se";
	const fx = east ? r.minX : r.maxX;
	const fy = south ? r.minY : r.maxY;
	// How far the pointer is from the fixed corner, in the direction the corner points.
	const dx = Math.max(0, east ? pointer[0] - fx : fx - pointer[0]);
	const dy = Math.max(0, south ? pointer[1] - fy : fy - pointer[1]);
	const scale = Math.max(minWidth / w, dx / w, dy / h);
	const nw = w * scale;
	const nh = h * scale;
	return {
		minX: east ? fx : fx - nw,
		maxX: east ? fx + nw : fx,
		minY: south ? fy : fy - nh,
		maxY: south ? fy + nh : fy,
	};
}

/** Which corner handle (if any) is within `radius` of the point. */
export function hitHandle(
	r: Rect,
	p: [number, number],
	radius: number,
): Corner | null {
	const corners: [Corner, number, number][] = [
		["nw", r.minX, r.minY],
		["ne", r.maxX, r.minY],
		["sw", r.minX, r.maxY],
		["se", r.maxX, r.maxY],
	];
	for (const [name, x, y] of corners) {
		if (Math.hypot(p[0] - x, p[1] - y) <= radius) return name;
	}
	return null;
}
