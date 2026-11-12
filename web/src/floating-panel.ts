import type { Stroke } from "./board/board";
import type { Rect } from "./board/viewport";

/** Space between an object and its panel, the margin kept to the screen edge, and the height of the top bar. */
const GAP = 12;
/** Above the object the panel clears the rotation handle that stands over its frame. */
const GAP_ABOVE = 48;
const MARGIN = 8;
const TOP_BAR = 64;

export interface PanelPosition {
	left: number;
	top: number;
	placement: "below" | "above" | "fallback";
}

/**
 * Where the panel of an object goes (R-042), in screen px: below the object and centred on it,
 * above it when there is no room below (but not over the top bar), and at the bottom middle of
 * the screen when the object leaves no room at all. Only the part of the object that is on
 * screen counts, and the panel never leaves the screen sideways.
 */
export function panelPosition(
	anchor: Rect,
	size: { w: number; h: number },
	view: { w: number; h: number },
): PanelPosition {
	const seen = {
		minX: Math.max(anchor.minX, 0),
		minY: Math.max(anchor.minY, 0),
		maxX: Math.min(anchor.maxX, view.w),
		maxY: Math.min(anchor.maxY, view.h),
	};
	// An object that is off screen sideways still gets a panel at the edge nearest to it.
	const centre =
		seen.minX <= seen.maxX
			? (seen.minX + seen.maxX) / 2
			: (anchor.minX + anchor.maxX) / 2;
	const left = Math.min(
		Math.max(centre - size.w / 2, MARGIN),
		view.w - size.w - MARGIN,
	);
	if (seen.maxY + GAP + size.h <= view.h - MARGIN)
		return { left, top: seen.maxY + GAP, placement: "below" };
	const above = seen.minY - GAP_ABOVE - size.h;
	if (above >= TOP_BAR) return { left, top: above, placement: "above" };
	return {
		left: (view.w - size.w) / 2,
		top: view.h - size.h - MARGIN,
		placement: "fallback",
	};
}

/** The size of the tile a shut menu leaves, and how far it stands from the object's side. */
const TILE = 40;
const TILE_GAP = 32;

/**
 * Where the tile of a shut menu stands (R-060): always in the same place by the object, just right
 * of it and level with its top (left of it when the right side has no room), kept on the screen.
 * It does not depend on where the menu was dragged to.
 */
export function tilePosition(
	anchor: Rect,
	view: { w: number; h: number },
): { left: number; top: number } {
	let left = anchor.maxX + TILE_GAP;
	if (left + TILE > view.w - MARGIN) left = anchor.minX - TILE_GAP - TILE;
	left = Math.min(Math.max(left, MARGIN), view.w - TILE - MARGIN);
	const top = Math.min(Math.max(anchor.minY, TOP_BAR), view.h - TILE - MARGIN);
	return { left, top };
}

/** What the panel calls what it edits: the class of the object, with a count for several. */
export function panelTitle(els: Stroke[]): string {
	if (els.length === 0) return "";
	const classOf = (e: Stroke) =>
		e.kind === "text"
			? "Tekst"
			: e.kind === "line"
				? "Linia"
				: e.kind === "image"
					? "Obraz"
					: !e.kind || e.kind === "stroke"
						? "Rysunek"
						: "Kształt";
	const classes = new Set(els.map(classOf));
	if (classes.size > 1) return `Zaznaczenie (${els.length})`;
	const [name] = classes;
	return els.length > 1 ? `${name} (${els.length})` : name;
}
