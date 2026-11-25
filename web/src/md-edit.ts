import { parseMarkdown } from "./board/markdown";

/**
 * Edits of a Markdown source for the text toolbar (R-101): pure functions from the text and the
 * selection to the change that does the job, so the field can apply it as a typed edit (undo
 * keeps working) and tests need no browser.
 */

/** Replace `value[from..to]` with `insert`, then select `selStart..selEnd` of the new text. */
export interface Edit {
	from: number;
	to: number;
	insert: string;
	selStart: number;
	selEnd: number;
}

/** The smallest edit that turns `before` into `after`, with the selection to leave. */
function diffEdit(
	before: string,
	after: string,
	selStart: number,
	selEnd: number,
): Edit {
	let from = 0;
	const max = Math.min(before.length, after.length);
	while (from < max && before[from] === after[from]) from++;
	let tail = 0;
	while (
		tail < max - from &&
		before[before.length - 1 - tail] === after[after.length - 1 - tail]
	)
		tail++;
	return {
		from,
		to: before.length - tail,
		insert: after.slice(from, after.length - tail),
		selStart,
		selEnd,
	};
}

const WORD = /[\p{L}\p{N}]/u;

function stars(value: string, at: number, dir: 1 | -1): number {
	let n = 0;
	for (let i = dir === 1 ? at : at - 1; value[i] === "*"; i += dir) n++;
	return n;
}

/** Whether `marker` is on both sides of the span `start..end` (stars counted, as `**` holds `*`). */
function wrappedOutside(
	value: string,
	start: number,
	end: number,
	marker: string,
): boolean {
	if (marker[0] === "*") {
		const n = Math.min(stars(value, start, -1), stars(value, end, 1));
		return marker === "*" ? n % 2 === 1 : n >= 2;
	}
	return (
		value.slice(start - marker.length, start) === marker &&
		value.slice(end, end + marker.length) === marker
	);
}

function wrappedInside(sel: string, marker: string): boolean {
	if (sel.length <= 2 * marker.length) return false;
	if (!sel.startsWith(marker) || !sel.endsWith(marker)) return false;
	if (marker[0] === "*") {
		const a = stars(sel, 0, 1);
		const b = stars(sel, sel.length, -1);
		const n = Math.min(a, b);
		return marker === "*" ? n % 2 === 1 : n >= 2;
	}
	return true;
}

/**
 * Bold, italic, strike or code on the selection, as in a word processor (R-101): wraps it in the
 * marker, or takes the marker away when it is already there. With no selection it takes the word
 * under the cursor, or opens an empty pair with the cursor between.
 */
export function toggleWrap(
	value: string,
	start: number,
	end: number,
	marker: string,
): Edit {
	const m = marker.length;
	let s = start;
	let e = end;
	if (s === e) {
		if (wrappedOutside(value, s, e, marker)) {
			const pairOnly =
				marker[0] !== "*" ||
				(stars(value, s, -1) === m && stars(value, e, 1) === m);
			if (pairOnly) {
				const after = value.slice(0, s - m) + value.slice(e + m);
				return diffEdit(value, after, s - m, s - m);
			}
		}
		while (s > 0 && WORD.test(value[s - 1])) s--;
		while (e < value.length && WORD.test(value[e])) e++;
		if (s === e) {
			const after = value.slice(0, s) + marker + marker + value.slice(e);
			return diffEdit(value, after, s + m, s + m);
		}
	}
	// Markers hug the text: spaces at the ends stay outside them.
	while (s < e && /\s/.test(value[s])) s++;
	while (e > s && /\s/.test(value[e - 1])) e--;
	if (s === e) {
		const after = value.slice(0, s) + marker + marker + value.slice(e);
		return diffEdit(value, after, s + m, s + m);
	}
	const sel = value.slice(s, e);
	if (wrappedOutside(value, s, e, marker)) {
		const after = value.slice(0, s - m) + sel + value.slice(e + m);
		return diffEdit(value, after, s - m, e - m);
	}
	if (wrappedInside(sel, marker)) {
		const inner = sel.slice(m, sel.length - m);
		const after = value.slice(0, s) + inner + value.slice(e);
		return diffEdit(value, after, s, s + inner.length);
	}
	const after = value.slice(0, s) + marker + sel + marker + value.slice(e);
	return diffEdit(value, after, s + m, e + m);
}

/** Which inline formats the selection (or the cursor) is in. */
export function activeFormats(
	value: string,
	start: number,
	_end: number,
): { bold: boolean; italic: boolean; strike: boolean; code: boolean } {
	const lineStart = value.lastIndexOf("\n", start - 1) + 1;
	let lineEnd = value.indexOf("\n", start);
	if (lineEnd < 0) lineEnd = value.length;
	const SENTINEL = "\u0000";
	const line = `${value.slice(lineStart, start)}${SENTINEL}${value.slice(start, lineEnd)}`;
	const run = parseMarkdown(line)[0]?.runs.find((r) =>
		r.text.includes(SENTINEL),
	);
	return {
		bold: !!run?.bold,
		italic: !!run?.italic,
		strike: !!run?.strike,
		code: !!run?.code,
	};
}

export type LineStyle = "p" | "h1" | "h2" | "h3" | "ul" | "ol" | "quote";

const PREFIX =
	/^(#{1,3}[ \t]+|>[ \t]?|[ \t]*[-*][ \t]+|[ \t]*\d{1,3}[.)][ \t]+)/;

/** The style of one line of source. */
function styleOfLine(line: string): LineStyle {
	const h = /^(#{1,3})[ \t]+/.exec(line);
	if (h) return `h${h[1].length}` as LineStyle;
	if (/^>/.test(line)) return "quote";
	if (/^[ \t]*[-*][ \t]+/.test(line)) return "ul";
	if (/^[ \t]*\d{1,3}[.)][ \t]+/.test(line)) return "ol";
	return "p";
}

function lineRange(
	value: string,
	start: number,
	end: number,
): [number, number] {
	const from = value.lastIndexOf("\n", start - 1) + 1;
	const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
	let to = value.indexOf("\n", last);
	if (to < 0) to = value.length;
	return [from, to];
}

/** The style of the line the selection starts on. */
export function lineStyleOf(
	value: string,
	start: number,
	end: number,
): LineStyle {
	const [from] = lineRange(value, start, end);
	const to = value.indexOf("\n", from);
	return styleOfLine(value.slice(from, to < 0 ? value.length : to));
}

/**
 * Gives every line of the selection a style (heading, list, quote) or none ("p"); asking for the
 * style all the lines already have takes it away, as pressing a list button twice does.
 */
export function setLineStyle(
	value: string,
	start: number,
	end: number,
	style: LineStyle,
): Edit {
	const [from, to] = lineRange(value, start, end);
	const lines = value.slice(from, to).split("\n");
	const filled = lines.filter((l) => l.trim());
	const off =
		style !== "p" &&
		filled.length > 0 &&
		filled.every((l) => styleOfLine(l) === style);
	const target = off ? "p" : style;
	let n = 0;
	const out = lines.map((l) => {
		const body = l.replace(PREFIX, "");
		if (target === "p") return body;
		if (!body.trim() && lines.length > 1) return l;
		n++;
		const prefix =
			target === "ul"
				? "- "
				: target === "ol"
					? `${n}. `
					: target === "quote"
						? "> "
						: `${"#".repeat(Number(target[1]))} `;
		return prefix + body;
	});
	const joined = out.join("\n");
	const after = value.slice(0, from) + joined + value.slice(to);
	return diffEdit(value, after, from, from + joined.length);
}

/**
 * Enter at the end of a list item starts the next item (the next number for a numbered list);
 * Enter in an empty item ends the list. Returns null where Enter should behave as usual.
 */
export function continueList(
	value: string,
	start: number,
	end: number,
): Edit | null {
	if (start !== end) return null;
	const lineStart = value.lastIndexOf("\n", start - 1) + 1;
	if (value[end] !== undefined && value[end] !== "\n") return null;
	const line = value.slice(lineStart, end);
	const m = /^([ \t]*)([-*]|(\d{1,3})([.)]))([ \t]+)(.*)$/.exec(line);
	if (!m) return null;
	if (!m[6].trim()) {
		const after = value.slice(0, lineStart) + value.slice(end);
		return diffEdit(value, after, lineStart, lineStart);
	}
	const marker = m[3] ? `${Number(m[3]) + 1}${m[4]}` : m[2];
	const add = `\n${m[1]}${marker}${m[5]}`;
	const after = value.slice(0, end) + add + value.slice(end);
	return diffEdit(value, after, end + add.length, end + add.length);
}
