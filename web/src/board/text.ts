import type { Stroke } from "./board";
import { isPlain, type MdBlock, parseMarkdown, plainText } from "./markdown";
import {
	CHAR_WIDTH,
	estimateWidth,
	FONT_FAMILIES,
	type FontKey,
	fontKeyOf,
	LINE_HEIGHT,
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
function measureRun(text: string, fontSize: number, font: string): number {
	if (measuring === undefined) {
		measuring =
			typeof OffscreenCanvas === "function"
				? new OffscreenCanvas(1, 1).getContext("2d")
				: null;
	}
	if (!measuring) return estimateWidth(text, fontSize);
	measuring.font = font;
	return measuring.measureText(text).width;
}

/** Counts font loads; a layout made before the font was there is made again (R-044). */
let fontEpoch = 0;
const layouts = new WeakMap<Stroke, { epoch: number; layout: TextLayout }>();

/** Tells the layout that the board's font has loaded, so the widths it measured are out of date. */
export function fontsChanged(): void {
	fontEpoch++;
}

/**
 * Fonts other than Inter are fetched only when a text first uses them (R-101): asked for a layout
 * in one that has not loaded yet, the board loads it and, when it is there, measures again.
 */
const requested = new Set<string>();
let onFontReady: (() => void) | null = null;

/** The board repaints (and measures again) through this when a font it asked for has loaded. */
export function setFontReadyHandler(fn: (() => void) | null): void {
	onFontReady = fn;
}

/** Starts loading the font of a family and style, once. */
export function ensureFont(
	font: FontKey,
	style: { bold?: boolean; italic?: boolean } = {},
): void {
	const key = textFont(16, font, style);
	if (requested.has(key)) return;
	requested.add(key);
	const fonts = typeof document === "undefined" ? undefined : document.fonts;
	if (!fonts?.load) return;
	const sample = "aąłźAŁ";
	void fonts.load(key, sample).then(() => {
		fontEpoch++;
		onFontReady?.();
	});
}

/** One piece of a line, in one font. */
export interface LaidRun {
	text: string;
	/** Offset from the left of the text's box, in board units. */
	x: number;
	w: number;
	font: string;
	strike?: boolean;
	code?: boolean;
}

/** One line of a text, as it is drawn. */
export interface LaidLine {
	/** Offset of the top of the line from the top of the box. */
	y: number;
	/** The height of the line. */
	h: number;
	/** The font size the line's height comes from (bigger for a heading). */
	fs: number;
	runs: LaidRun[];
	/** The bullet or number of a list item, on its first line only. */
	marker?: { text: string; x: number; font: string };
	/** A line of a quote: drawn with a bar at its left. */
	quote?: boolean;
}

/** A text laid out: its lines, and its size when it has no width of its own (R-102). */
export interface TextLayout {
	lines: LaidLine[];
	/** Widest line, for a text typed at a point of a styled text; estimated for a plain one. */
	width: number;
	height: number;
	plain: boolean;
	/** The text of each line, as in `textLines`. */
	texts: string[];
}

const HEADING_SCALE = { h1: 1.7, h2: 1.4, h3: 1.18 } as const;
const CODE_SCALE = 0.9;
/** The step of a list level, and the indent of a quote, as multiples of the font size. */
const INDENT = 1.3;
const QUOTE_INDENT = 0.9;

type Style = { bold?: boolean; italic?: boolean };
interface Piece {
	text: string;
	space: boolean;
	font: string;
	px: number;
	strike?: boolean;
	code?: boolean;
	style: Style;
}

function pieces(block: MdBlock, fs: number, family: FontKey): Piece[] {
	const heading = block.kind in HEADING_SCALE;
	const out: Piece[] = [];
	for (const r of block.runs) {
		const style: Style = { bold: r.bold || heading, italic: r.italic };
		const px = r.code ? fs * CODE_SCALE : fs;
		const fam = r.code ? "mono" : family;
		const font = textFont(px, fam, r.code ? { bold: r.bold } : style);
		if (r.code) ensureFont("mono", { bold: r.bold });
		else if (style.bold || style.italic) ensureFont(family, style);
		for (const part of r.text.split(/( +)/)) {
			if (!part) continue;
			out.push({
				text: part,
				space: part[0] === " ",
				font,
				px,
				strike: r.strike,
				code: r.code,
				style,
			});
		}
	}
	return out;
}

/** Lays the pieces of a block out in lines no wider than `avail`, as runs from x = `left`. */
function flow(ps: Piece[], left: number, avail: number): LaidRun[][] {
	const lines: LaidRun[][] = [[]];
	let x = 0;
	const add = (p: Piece, text: string, w: number) => {
		const line = lines[lines.length - 1];
		const last = line[line.length - 1];
		if (
			last &&
			last.font === p.font &&
			!last.strike === !p.strike &&
			!last.code === !p.code
		) {
			last.text += text;
			last.w += w;
		} else {
			const run: LaidRun = { text, x: left + x, w, font: p.font };
			if (p.strike) run.strike = true;
			if (p.code) run.code = true;
			line.push(run);
		}
		x += w;
	};
	const newLine = () => {
		lines.push([]);
		x = 0;
	};
	let pending = null as { p: Piece; w: number; text: string } | null;
	for (const p of ps) {
		const w = measureRun(p.text, p.px, p.font);
		if (p.space) {
			pending = {
				p,
				w: (pending?.w ?? 0) + w,
				text: (pending?.text ?? "") + p.text,
			};
			continue;
		}
		const gap = x > 0 && pending ? pending.w : 0;
		if (x > 0 && x + gap + w > avail) {
			newLine();
		} else if (pending && gap > 0) {
			add(pending.p, pending.text, gap);
		}
		pending = null;
		if (w <= avail || avail <= 0) {
			add(p, p.text, w);
			continue;
		}
		// The word alone is too wide: cut it into pieces that fit, each a line of its own.
		let rest = p.text;
		while (rest) {
			let n = rest.length;
			while (n > 1 && measureRun(rest.slice(0, n), p.px, p.font) > avail) n--;
			const part = rest.slice(0, n);
			add(p, part, measureRun(part, p.px, p.font));
			rest = rest.slice(n);
			if (rest) newLine();
		}
	}
	return lines;
}

function styledLayout(s: Stroke, blocks: MdBlock[]): TextLayout {
	const fs = fontSizeOf(s);
	const family = fontKeyOf(s.font);
	const lines: LaidLine[] = [];
	const texts: string[] = [];
	let y = 0;
	let width = 0;
	for (const block of blocks) {
		const scale = HEADING_SCALE[block.kind as keyof typeof HEADING_SCALE] ?? 1;
		const bfs = fs * scale;
		const h = bfs * LINE_HEIGHT;
		if (scale > 1 && lines.length > 0) y += bfs * 0.25;
		let left = 0;
		if (block.kind === "ul" || block.kind === "ol")
			left = (block.depth + 1) * fs * INDENT;
		else if (block.kind === "quote") left = fs * QUOTE_INDENT;
		const avail =
			s.width === undefined ? Number.POSITIVE_INFINITY : s.width - left;
		const flowed = flow(pieces(block, bfs, family), left, avail);
		flowed.forEach((runs, i) => {
			const line: LaidLine = { y, h, fs: bfs, runs };
			if (i === 0 && block.marker) {
				const font = textFont(bfs, family, {});
				const mw = measureRun(block.marker, bfs, font);
				line.marker = { text: block.marker, x: left - mw - fs * 0.3, font };
			}
			if (block.kind === "quote") line.quote = true;
			lines.push(line);
			texts.push(runs.map((r) => r.text).join(""));
			const last = runs[runs.length - 1];
			if (last) width = Math.max(width, last.x + last.w);
			y += h;
		});
	}
	return { lines, width, height: y, plain: false, texts };
}

function plainLayout(s: Stroke, text: string): TextLayout {
	const fs = fontSizeOf(s);
	const family = fontKeyOf(s.font);
	const font = textFont(fs, family);
	const texts =
		s.width === undefined
			? text.split("\n")
			: wrapLines(text, s.width, fs, (t, px) =>
					measureRun(t, px, textFont(px, family)),
				);
	const h = fs * LINE_HEIGHT;
	const longest = Math.max(1, ...texts.map((l) => l.length));
	return {
		lines: texts.map((t, i) => ({
			y: i * h,
			h,
			fs,
			runs: [{ text: t, x: 0, w: 0, font }],
		})),
		width: longest * fs * CHAR_WIDTH,
		height: texts.length * h,
		plain: true,
		texts,
	};
}

/**
 * The lines of a text element as they are drawn (R-044, R-102): the Markdown read, then laid out
 * in the element's font and, for an area (an element with a `width`), wrapped to that width. A
 * text without any Markdown keeps the lines its author typed, wrapped as it always was. The
 * result is kept per element, as elements do not change.
 */
export function layoutOf(s: Stroke): TextLayout {
	const kept = layouts.get(s);
	if (kept && kept.epoch === fontEpoch) return kept.layout;
	const blocks = parseMarkdown(s.text ?? "");
	const family = fontKeyOf(s.font);
	if (family !== "sans") ensureFont(family);
	const layout = isPlain(blocks)
		? plainLayout(s, plainText(blocks))
		: styledLayout(s, blocks);
	layouts.set(s, { epoch: fontEpoch, layout });
	return layout;
}

/** The text of each line of an element as it is drawn. */
export function textLines(s: Stroke): string[] {
	return layoutOf(s).texts;
}

/**
 * Box of a text element, from its anchor (top-left). A text typed at a point is as wide as its
 * longest line (estimated from the font size when plain, measured when styled); an area is as
 * wide as it was made and as tall as its wrapped lines.
 */
export function textBox(s: Stroke): Rect {
	const [x, y] = s.points[0];
	const l = layoutOf(s);
	return {
		minX: x,
		minY: y,
		maxX: x + (s.width ?? l.width),
		maxY: y + Math.max(l.height, fontSizeOf(s) * LINE_HEIGHT),
	};
}

export { FONT_FAMILIES };
