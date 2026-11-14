import type { Stroke } from "./board";
import { worldBounds } from "./transform";
import { clampScale, type Rect } from "./viewport";

/** How the mini map maps the board onto its box: map = (board - origin) * scale + offset. */
export interface MapFit {
	scale: number;
	minX: number;
	minY: number;
	offX: number;
	offY: number;
}

/** The share of the shown area that is left empty round the edges. */
const MARGIN = 0.08;

/** The bounds of everything on the board, or null when it is empty. */
export function contentBounds(strokes: Stroke[]): Rect | null {
	let out: Rect | null = null;
	for (const s of strokes) {
		const b = worldBounds(s);
		out = out
			? {
					minX: Math.min(out.minX, b.minX),
					minY: Math.min(out.minY, b.minY),
					maxX: Math.max(out.maxX, b.maxX),
					maxY: Math.max(out.maxY, b.maxY),
				}
			: b;
	}
	return out;
}

/**
 * Fits the content and the screen's view (both, so the screen is never off the map) into a box,
 * keeping proportions and centred, with a margin.
 */
export function mapFit(
	content: Rect | null,
	view: Rect,
	box: { w: number; h: number },
): MapFit {
	const all = content
		? {
				minX: Math.min(content.minX, view.minX),
				minY: Math.min(content.minY, view.minY),
				maxX: Math.max(content.maxX, view.maxX),
				maxY: Math.max(content.maxY, view.maxY),
			}
		: view;
	const w = Math.max(all.maxX - all.minX, 1);
	const h = Math.max(all.maxY - all.minY, 1);
	const scale = Math.min(box.w / w, box.h / h) * (1 - 2 * MARGIN);
	return {
		scale,
		minX: all.minX,
		minY: all.minY,
		offX: (box.w - w * scale) / 2,
		offY: (box.h - h * scale) / 2,
	};
}

/** Board point to map point. */
export function toMap(f: MapFit, x: number, y: number): [number, number] {
	return [(x - f.minX) * f.scale + f.offX, (y - f.minY) * f.scale + f.offY];
}

/** Map point to board point. */
export function fromMap(f: MapFit, mx: number, my: number): [number, number] {
	return [(mx - f.offX) / f.scale + f.minX, (my - f.offY) / f.scale + f.minY];
}

/** Moves a view so that the board point is at the middle of a screen of this size, zoom kept. */
export function centreOn(
	v: { x: number; y: number; scale: number },
	at: [number, number],
	screenW: number,
	screenH: number,
): void {
	v.x = at[0] - screenW / 2 / v.scale;
	v.y = at[1] - screenH / 2 / v.scale;
}

/** Zooms and moves a view to show all of `content` with a margin; never closer than 100%. */
export function fitView(
	v: { x: number; y: number; scale: number },
	content: Rect,
	screenW: number,
	screenH: number,
): void {
	const w = Math.max(content.maxX - content.minX, 1);
	const h = Math.max(content.maxY - content.minY, 1);
	const scale = Math.min(screenW / w, screenH / h) * (1 - 2 * MARGIN);
	v.scale = Math.min(1, clampScale(scale));
	centreOn(
		v,
		[(content.minX + content.maxX) / 2, (content.minY + content.maxY) / 2],
		screenW,
		screenH,
	);
}
