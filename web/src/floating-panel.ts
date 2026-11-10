import type { Stroke } from "./board/board";
import type { Rect } from "./board/viewport";

/** Space between an object and its panel, the margin kept to the screen edge, and the height of the top bar. */
const GAP = 12;
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
	const above = seen.minY - GAP - size.h;
	if (above >= TOP_BAR) return { left, top: above, placement: "above" };
	return {
		left: (view.w - size.w) / 2,
		top: view.h - size.h - MARGIN,
		placement: "fallback",
	};
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
