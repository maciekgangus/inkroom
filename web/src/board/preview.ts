import { type Background, isBackground } from "./background";
import type { Stroke } from "./board";
import { renderRegion } from "./export";
import { contentBounds } from "./minimap";
import type { Rect } from "./viewport";

/** The shape of a tile's picture (width over height). */
export const TILE_ASPECT = 4 / 3;
/** The longest side of a preview, in pixels: sharp enough for a tile on a high-density screen. */
const PREVIEW_SIDE = 480;
/** Empty space round the content, in board units. */
const PAD = 40;
/** What an empty board shows: a page the size of a typical window. */
const EMPTY: Rect = { minX: 0, minY: 0, maxX: 800, maxY: 600 };

/** What the server gives for a preview (R-052). */
export interface PreviewData {
	background: string;
	strokes: Stroke[];
}

/**
 * The part of the board a tile shows: everything on it with a margin, widened or heightened to
 * the tile's shape and centred, so a board is never cut off or stretched.
 */
export function previewRegion(strokes: Stroke[], aspect: number): Rect {
	const c = contentBounds(strokes);
	const box = c
		? {
				minX: c.minX - PAD,
				minY: c.minY - PAD,
				maxX: c.maxX + PAD,
				maxY: c.maxY + PAD,
			}
		: EMPTY;
	let w = box.maxX - box.minX;
	let h = box.maxY - box.minY;
	if (w / h < aspect) w = h * aspect;
	else h = w / aspect;
	const cx = (box.minX + box.maxX) / 2;
	const cy = (box.minY + box.maxY) / 2;
	return {
		minX: cx - w / 2,
		minY: cy - h / 2,
		maxX: cx + w / 2,
		maxY: cy + h / 2,
	};
}

/** Draws a board small, in light colours, with a light placeholder for each photo; returns a PNG. */
export function renderPreview(data: PreviewData): string {
	const background: Background = isBackground(data.background)
		? data.background
		: "plain";
	const canvas = renderRegion(
		data.strokes,
		previewRegion(data.strokes, TILE_ASPECT),
		background,
		null,
		{ maxSide: PREVIEW_SIDE, sharp: 1, placeholders: true },
	);
	return canvas.toDataURL("image/png");
}
