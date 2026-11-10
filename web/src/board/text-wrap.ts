/** Line spacing and the average glyph width, as multiples of the font size. */
export const LINE_HEIGHT = 1.25;
export const CHAR_WIDTH = 0.6;

/**
 * The font every text on the board is drawn and measured in, the same on every device: Inter,
 * bundled with the app, with the system font only as a fallback while it loads (R-044).
 */
export const TEXT_FONT_FAMILY = '"Inter", system-ui, sans-serif';

/** The canvas font string for a font size in px. */
export const textFont = (fontSize: number): string =>
	`${fontSize}px ${TEXT_FONT_FAMILY}`;

/** How wide a text is when drawn at a font size (px). */
export type Measure = (text: string, fontSize: number) => number;

/** A guess from the font size alone: the same everywhere, used where nothing can be measured. */
export const estimateWidth: Measure = (text, fontSize) =>
	text.length * fontSize * CHAR_WIDTH;

/**
 * Breaks a text into lines no wider than `width` (R-044): at the line breaks the author typed,
 * then between words as late as possible; a word longer than the width is broken by characters,
 * and a line always takes at least one character, so it always moves forward.
 */
export function wrapLines(
	text: string,
	width: number,
	fontSize: number,
	measure: Measure = estimateWidth,
): string[] {
	const fits = (s: string) => measure(s, fontSize) <= width;
	const lines: string[] = [];
	for (const paragraph of text.split("\n")) {
		const first = lines.length;
		let line = "";
		const push = () => {
			lines.push(line.trimEnd());
			line = "";
		};
		for (const word of paragraph.split(" ")) {
			const joined = line ? `${line} ${word}` : word;
			if (fits(joined)) {
				line = joined;
				continue;
			}
			if (line) push();
			// The word alone is too wide: cut it into pieces that fit.
			let rest = word;
			while (rest && !fits(rest)) {
				let n = rest.length - 1;
				while (n > 1 && !fits(rest.slice(0, n))) n--;
				lines.push(rest.slice(0, Math.max(1, n)));
				rest = rest.slice(Math.max(1, n));
			}
			line = rest;
		}
		// A paragraph is at least one line, but a word that was cut up exactly leaves none over.
		if (line || lines.length === first) push();
	}
	return lines;
}
