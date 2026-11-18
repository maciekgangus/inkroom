import type { Stroke } from "./board/board";
import type { Rect } from "./board/viewport";

/** The margin kept to the screen edge, and the height of the top bar. */
const MARGIN = 8;
const TOP_BAR = 64;
/** How far the menu and its tile stand from the object's side: clear of the handles on it. */
const SIDE_GAP = 40;

/** Which side of the object the menu stands on. */
export type Side = "right" | "left";

/**
 * The side for a menu `width` wide (R-060): on the right of the object, or on the left when the
 * right has no room on the screen. Chosen once for an object, so the menu does not jump sides.
 */
export function pickSide(
	anchor: Rect,
	width: number,
	view: { w: number; h: number },
): Side {
	return anchor.maxX + SIDE_GAP + width <= view.w - MARGIN ? "right" : "left";
}

/**
 * Where the menu, or its tile, stands (R-060), in screen px: beside the object on the given side
 * and level with its top. It is fixed to the object, so it moves with it over the board and goes
 * away with it (see isVisible); while the object is on the screen the menu is kept on the screen
 * too, under the top bar, so that it can always be reached (on a narrow tablet it may cover the
 * object).
 */
export function sidePosition(
	anchor: Rect,
	size: { w: number; h: number },
	view: { w: number; h: number },
	side: Side,
	/** The least left edge: where a column of tools down the left side (R-082) ends. */
	leftInset = 0,
): { left: number; top: number } {
	const beside =
		side === "right" ? anchor.maxX + SIDE_GAP : anchor.minX - SIDE_GAP - size.w;
	const left = Math.max(
		Math.min(beside, view.w - size.w - MARGIN),
		MARGIN,
		leftInset,
	);
	const top = Math.max(
		Math.min(anchor.minY, view.h - size.h - MARGIN),
		TOP_BAR,
	);
	return { left, top };
}

/** Whether any of the object is on the screen: the menu is shown only while it is. */
export function isVisible(
	anchor: Rect,
	view: { w: number; h: number },
): boolean {
	return (
		anchor.maxX > 0 &&
		anchor.maxY > 0 &&
		anchor.minX < view.w &&
		anchor.minY < view.h
	);
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
					: e.kind === "plane"
						? "Wykres"
						: !e.kind || e.kind === "stroke"
							? "Rysunek"
							: "Kształt";
	const classes = new Set(els.map(classOf));
	if (classes.size > 1) return `Zaznaczenie (${els.length})`;
	const [name] = classes;
	return els.length > 1 ? `${name} (${els.length})` : name;
}

/**
 * Where the popover of a colour picker stands (in screen px): outside the menu, beside it and level
 * with the tile that opened it, so that it does not push the menu's contents down. On the left of a
 * menu in the right half of the screen, else on the right; if that side has no room it takes the
 * other, and with room on neither it is null and the picker stays inside the menu.
 */
export function popoverSpot(
	tile: Rect,
	menu: Rect,
	size: { w: number; h: number },
	view: { w: number; h: number },
): { left: number; top: number } | null {
	const gap = 8;
	const leftEdge = menu.minX - gap - size.w;
	const rightEdge = menu.maxX + gap;
	const fitsLeft = leftEdge >= MARGIN;
	const fitsRight = rightEdge + size.w <= view.w - MARGIN;
	const preferLeft = (menu.minX + menu.maxX) / 2 > view.w / 2;
	const left =
		preferLeft && fitsLeft
			? leftEdge
			: fitsRight
				? rightEdge
				: fitsLeft
					? leftEdge
					: null;
	if (left === null) return null;
	const top = Math.max(
		MARGIN,
		Math.min(tile.minY - gap, view.h - size.h - MARGIN),
	);
	return { left, top };
}
