import type { Rect } from "../board/viewport";

/** A page is this wide on the board; its height follows its shape (ADR 0015). */
export const PAGE_WIDTH = 900;
/** Space between one page and the next, in board units. */
export const GAP = 24;
const MARGIN = 40;

/** Where the first page goes: the top left of what is on the screen, with a margin. */
export function startPoint(view: Rect): [number, number] {
	return [view.minX + MARGIN, view.minY + MARGIN];
}

/** The place of a page whose top left is `at`, for a page rendered `width` by `height` pixels. */
export function pageRect(
	at: [number, number],
	width: number,
	height: number,
): Rect {
	return {
		minX: at[0],
		minY: at[1],
		maxX: at[0] + PAGE_WIDTH,
		maxY: at[1] + (PAGE_WIDTH * height) / width,
	};
}
