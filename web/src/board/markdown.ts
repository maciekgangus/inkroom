/**
 * The small Markdown of texts on the board (R-102): bold, italic, strike, code, headings of three
 * levels, bullet and numbered lists, quotes. Our own parser, no library; it returns plain data
 * (text with flags) and never any HTML, so a text can say nothing harmful. Anything it does not
 * understand stays as it was typed.
 */

export interface MdRun {
	text: string;
	bold?: boolean;
	italic?: boolean;
	strike?: boolean;
	code?: boolean;
}

export type MdKind = "p" | "h1" | "h2" | "h3" | "ul" | "ol" | "quote";

/** One line of the source, read as a block. */
export interface MdBlock {
	kind: MdKind;
	/** Nesting of a list item: 0 to 3. */
	depth: number;
	/** The bullet or the number of a list item, as drawn: "•", "◦", "▪" or "3.". */
	marker?: string;
	runs: MdRun[];
}

type Flags = Omit<MdRun, "text">;

const BULLETS = ["•", "◦", "▪", "▪"];
const ESCAPABLE = "\\*`~#>-";

const same = (a: Flags, b: Flags) =>
	!a.bold === !b.bold &&
	!a.italic === !b.italic &&
	!a.strike === !b.strike &&
	!a.code === !b.code;

function push(out: MdRun[], text: string, flags: Flags): void {
	if (!text) return;
	const last = out[out.length - 1];
	if (last && same(last, flags)) {
		last.text += text;
		return;
	}
	const run: MdRun = { text };
	if (flags.bold) run.bold = true;
	if (flags.italic) run.italic = true;
	if (flags.strike) run.strike = true;
	if (flags.code) run.code = true;
	out.push(run);
}

const isWordChar = (c: string | undefined) =>
	c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

/** The index where `marker` closes a span opened at `from`, or -1. */
function findClose(src: string, from: number, marker: string): number {
	let j = from;
	while (j < src.length) {
		const c = src[j];
		if (c === "\\") {
			j += 2;
			continue;
		}
		if (c === "`") {
			const end = src.indexOf("`", j + 1);
			if (end > j + 1) {
				j = end + 1;
				continue;
			}
		}
		if (c === marker[0] && src.startsWith(marker, j)) {
			if (marker === "*" && src[j + 1] === "*") {
				// A bold span inside an italic one: jump over it.
				const end = src.indexOf("**", j + 2);
				if (end < 0) return -1;
				j = end + 2;
				continue;
			}
			// The last two of three stars close a bold span that holds an italic one.
			const at = marker === "**" && src[j + 2] === "*" ? j + 1 : j;
			if (at > from && !isSpace(src[at - 1])) return at;
		}
		j++;
	}
	return -1;
}

function inline(src: string, base: Flags, out: MdRun[]): void {
	let buf = "";
	const flush = () => {
		push(out, buf, base);
		buf = "";
	};
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (c === "\\" && i + 1 < src.length && ESCAPABLE.includes(src[i + 1])) {
			buf += src[i + 1];
			i += 2;
			continue;
		}
		if (c === "`") {
			const end = src.indexOf("`", i + 1);
			if (end > i + 1) {
				flush();
				push(out, src.slice(i + 1, end), { ...base, code: true });
				i = end + 1;
				continue;
			}
		}
		if (c === "*" || (c === "~" && src[i + 1] === "~")) {
			let n = 1;
			while (src[i + n] === c && n < (c === "*" ? 3 : 2)) n++;
			const marker = c.repeat(n);
			// A star between two letters or digits (2*3*4, a*b) is a sign, not emphasis (R-102).
			const inWord =
				c === "*" && isWordChar(src[i - 1]) && isWordChar(src[i + n]);
			if (inWord) {
				buf += marker;
				i += n;
				continue;
			}
			if (c === "~" ? !isSpace(src[i + 2]) : !isSpace(src[i + n])) {
				const close = findClose(src, i + n, marker);
				if (close > i + n) {
					flush();
					const flags: Flags =
						marker === "***"
							? { ...base, bold: true, italic: true }
							: marker === "**"
								? { ...base, bold: true }
								: marker === "*"
									? { ...base, italic: true }
									: { ...base, strike: true };
					inline(src.slice(i + n, close), flags, out);
					i = close + n;
					continue;
				}
			}
			buf += marker;
			i += n;
			continue;
		}
		buf += c;
		i++;
	}
	flush();
}

const HEADING = /^(#{1,3})[ \t]+(.*)$/;
const QUOTE = /^>[ \t]?(.*)$/;
const BULLET = /^([ \t]*)[-*][ \t]+(.*)$/;
const NUMBERED = /^([ \t]*)(\d{1,3})[.)][ \t]+(.*)$/;

const depthOf = (indent: string) =>
	Math.min(3, Math.floor(indent.replace(/\t/g, "  ").length / 2));

function block(line: string): MdBlock {
	const runs: MdRun[] = [];
	let m = HEADING.exec(line);
	if (m) {
		inline(m[2], {}, runs);
		return { kind: `h${m[1].length}` as MdKind, depth: 0, runs };
	}
	m = QUOTE.exec(line);
	if (m) {
		inline(m[1], {}, runs);
		return { kind: "quote", depth: 0, runs };
	}
	m = BULLET.exec(line);
	if (m) {
		const depth = depthOf(m[1]);
		inline(m[2], {}, runs);
		return { kind: "ul", depth, marker: BULLETS[depth], runs };
	}
	m = NUMBERED.exec(line);
	if (m) {
		inline(m[3], {}, runs);
		return {
			kind: "ol",
			depth: depthOf(m[1]),
			marker: `${Number(m[2])}.`,
			runs,
		};
	}
	inline(line, {}, runs);
	return { kind: "p", depth: 0, runs };
}

/** The blocks of a text, one for each line of the source (a blank line is a block with no runs). */
export function parseMarkdown(text: string): MdBlock[] {
	return text.split("\n").map(block);
}

/** True when nothing is styled: the text then is laid out and drawn the way it always was. */
export function isPlain(blocks: MdBlock[]): boolean {
	return blocks.every(
		(b) =>
			b.kind === "p" &&
			b.runs.every((r) => !r.bold && !r.italic && !r.strike && !r.code),
	);
}

/** The text of the blocks without their markers: the source of a plain text, escapes removed. */
export function plainText(blocks: MdBlock[]): string {
	return blocks.map((b) => b.runs.map((r) => r.text).join("")).join("\n");
}
