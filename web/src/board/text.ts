import type { Stroke } from "./board";
import {
	CHAR_WIDTH,
	estimateWidth,
	LINE_HEIGHT,
	type Measure,
	textFont,
	wrapLines,
} from "./text-wrap";
import type { Rect } from "./viewport";

export { LINE_HEIGHT };

const FONT_SIZES: Record<number, number> = { 2: 16, 5: 24, 10: 40 };

/** Font size (px at 100% zoom) for a text placed with the given pen size. */
export function fontSizeFor(size: number): number {
	return FONT_SIZES[size] ?? Math.round(size * 4);
}

/** The font size of a text element: its own `fontSize`, else the table value for its pen size. */
export function fontSizeOf(s: Stroke): number {
	return s.fontSize ?? fontSizeFor(s.size);
}

/** Measures with the font the board draws with, where the browser can; elsewhere it estimates. */
let measuring: OffscreenCanvasRenderingContext2D | null | undefined;
const measureText: Measure = (text, fontSize) => {
	if (measuring === undefined) {
		measuring =
			typeof OffscreenCanvas === "function"
				? new OffscreenCanvas(1, 1).getContext("2d")
				: null;
	}
	if (!measuring) return estimateWidth(text, fontSize);
	measuring.font = textFont(fontSize);
	return measuring.measureText(text).width;
};

/** Counts font loads; a layout made before the font was there is made again (R-044). */
let fontEpoch = 0;
const layouts = new WeakMap<Stroke, { epoch: number; lines: string[] }>();

/** Tells the layout that the board's font has loaded, so the widths it measured are out of date. */
export function fontsChanged(): void {
	fontEpoch++;
}

/**
 * The lines of a text element as they are drawn (R-044): an area (an element with a `width`)
 * wraps its text to that width, a text typed at a point keeps the lines its author typed. The
 * result is kept per element, as elements do not change.
 */
export function textLines(s: Stroke): string[] {
	const kept = layouts.get(s);
	if (kept && kept.epoch === fontEpoch) return kept.lines;
	const text = s.text ?? "";
	const lines =
		s.width === undefined
			? text.split("\n")
			: wrapLines(text, s.width, fontSizeOf(s), measureText);
	layouts.set(s, { epoch: fontEpoch, lines });
	return lines;
}

/**
 * Box of a text element, from its anchor (top-left). A text typed at a point is as wide as its
 * longest line, estimated from the font size; an area is as wide as it was made and as tall as
 * its wrapped lines.
 */
export function textBox(s: Stroke): Rect {
	const [x, y] = s.points[0];
	const fs = fontSizeOf(s);
	const lines = textLines(s);
	const longest = Math.max(1, ...lines.map((l) => l.length));
	return {
		minX: x,
		minY: y,
		maxX: x + (s.width ?? longest * fs * CHAR_WIDTH),
		maxY: y + lines.length * fs * LINE_HEIGHT,
	};
}
