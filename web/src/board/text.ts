import type { Stroke } from "./board";
import type { Rect } from "./viewport";

/** Line spacing and the average glyph width, as multiples of the font size. */
export const LINE_HEIGHT = 1.25;
export const CHAR_WIDTH = 0.6;

const FONT_SIZES: Record<number, number> = { 2: 16, 5: 24, 10: 40 };

/** Font size (px at 100% zoom) for a text placed with the given pen size. */
export function fontSizeFor(size: number): number {
	return FONT_SIZES[size] ?? Math.round(size * 4);
}

/** The font size of a text element: its own `fontSize`, else the table value for its pen size. */
export function fontSizeOf(s: Stroke): number {
	return s.fontSize ?? fontSizeFor(s.size);
}

/**
 * Estimated box of a text element, from its anchor (top-left). The width is an estimate,
 * not a measurement, so it is only used to skip off-screen text and to hit it with the eraser.
 */
export function textBox(s: Stroke): Rect {
	const [x, y] = s.points[0];
	const fs = fontSizeOf(s);
	const lines = (s.text ?? "").split("\n");
	const longest = Math.max(1, ...lines.map((l) => l.length));
	return {
		minX: x,
		minY: y,
		maxX: x + longest * fs * CHAR_WIDTH,
		maxY: y + lines.length * fs * LINE_HEIGHT,
	};
}
