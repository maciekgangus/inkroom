import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import { LINE_HEIGHT, layoutOf, textBox, textLines } from "./text";
import { textFont } from "./text-wrap";

const FS = 20;
const LH = FS * LINE_HEIGHT;

function text(content: string, extra: Partial<Stroke> = {}): Stroke {
	return {
		id: "t",
		authorId: "a",
		color: "#111",
		size: 4,
		z: 0,
		kind: "text",
		text: content,
		fontSize: FS,
		points: [[100, 50, 0.5]],
		...extra,
	};
}

describe("layout of a plain text is what it always was (R-102)", () => {
	test("one line of the font's height per line, at its own offset", () => {
		const l = layoutOf(text("a\nb\nc"));
		expect(l.lines.map((x) => x.y)).toEqual([0, LH, 2 * LH]);
		expect(l.lines.every((x) => x.h === LH && x.fs === FS)).toBe(true);
		expect(l.height).toBeCloseTo(3 * LH);
	});

	test("an area wraps as before and each line is one run in the plain font", () => {
		const l = layoutOf(text("aaaa bbbb cccc", { width: 100 }));
		expect(l.lines.map((x) => x.runs.map((r) => r.text).join(""))).toEqual(
			textLines(text("aaaa bbbb cccc", { width: 100 })),
		);
		expect(l.lines.length).toBeGreaterThan(1);
		for (const line of l.lines) {
			expect(line.runs).toHaveLength(1);
			expect(line.runs[0].font).toBe(textFont(FS));
			expect(line.runs[0].x).toBe(0);
		}
	});

	test("an asterisk with spaces and a word with an underscore stay as typed", () => {
		const l = layoutOf(text("2 * 3 * 4 and x_1"));
		expect(l.lines).toHaveLength(1);
		expect(l.lines[0].runs[0].text).toBe("2 * 3 * 4 and x_1");
	});

	test("the font of the text is the font of its lines", () => {
		const l = layoutOf(text("abc", { font: "mono" }));
		expect(l.lines[0].runs[0].font).toBe(textFont(FS, "mono"));
		expect(textFont(FS, "mono")).toContain("JetBrains Mono");
		expect(textFont(FS, "hand")).toContain("Caveat");
		expect(textFont(FS, "serif")).toContain("Lora");
	});
});

describe("layout of styled text (R-102)", () => {
	test("bold and italic runs get their own font, the rest stays plain", () => {
		const [line] = layoutOf(text("a **b** *c*")).lines;
		expect(line.runs.map((r) => r.text)).toEqual(["a ", "b", " ", "c"]);
		expect(line.runs[0].font).toBe(textFont(FS));
		expect(line.runs[1].font).toBe(textFont(FS, "sans", { bold: true }));
		expect(line.runs[3].font).toBe(textFont(FS, "sans", { italic: true }));
		expect(textFont(FS, "sans", { bold: true })).toContain("600");
		expect(textFont(FS, "sans", { italic: true })).toContain("italic");
	});

	test("runs follow each other along the line", () => {
		const [line] = layoutOf(text("ab **cd** ef")).lines;
		const [a, b, c] = line.runs;
		expect(a.x).toBe(0);
		expect(b.x).toBeCloseTo(a.w);
		expect(c.x).toBeCloseTo(a.w + b.w);
	});

	test("strike and code are kept; code is drawn in the mono font", () => {
		const [line] = layoutOf(text("~~s~~ `c`")).lines;
		expect(line.runs[0].strike).toBe(true);
		const code = line.runs.find((r) => r.code);
		expect(code?.font).toContain("JetBrains Mono");
	});

	test("headings are bigger and bold", () => {
		const l = layoutOf(text("# T\ntext"));
		expect(l.lines[0].fs).toBeGreaterThan(FS);
		expect(l.lines[0].h).toBeCloseTo(l.lines[0].fs * LINE_HEIGHT);
		expect(l.lines[0].runs[0].font).toContain("600");
		expect(l.lines[1].fs).toBe(FS);
		const h = (md: string) => layoutOf(text(md)).lines[0].fs;
		expect(h("# a")).toBeGreaterThan(h("## a"));
		expect(h("## a")).toBeGreaterThan(h("### a"));
		expect(h("### a")).toBeGreaterThan(FS);
	});

	test("a list item has its marker left of its text, deeper items further right", () => {
		const l = layoutOf(text("- a\n  - b\n1. c"));
		const [a, b, c] = l.lines;
		expect(a.marker?.text).toBe("•");
		expect(b.marker?.text).toBe("◦");
		expect(c.marker?.text).toBe("1.");
		expect(a.runs[0].x).toBeGreaterThan(0);
		expect(a.marker && a.marker.x < a.runs[0].x).toBe(true);
		expect(b.runs[0].x).toBeGreaterThan(a.runs[0].x);
	});

	test("a quote is indented and has a bar", () => {
		const [q] = layoutOf(text("> q")).lines;
		expect(q.quote).toBe(true);
		expect(q.runs[0].x).toBeGreaterThan(0);
	});

	test("a styled area wraps to its width, inside the indent of a list", () => {
		const md = "- **aaaa** bbbb cccc dddd eeee";
		const l = layoutOf(text(md, { width: 200 }));
		expect(l.lines.length).toBeGreaterThan(1);
		for (const line of l.lines) {
			const last = line.runs[line.runs.length - 1];
			expect(last.x + last.w).toBeLessThanOrEqual(200 + 0.001);
		}
		// the continuation lines are indented like the first
		expect(l.lines[1].runs[0].x).toBe(l.lines[0].runs[0].x);
		expect(l.lines[1].marker).toBeUndefined();
	});

	test("a word wider than the area is cut into pieces that fit", () => {
		const l = layoutOf(text("**abcdefghijklmnopqrstuvwxyz**", { width: 100 }));
		expect(l.lines.length).toBeGreaterThan(1);
		expect(
			l.lines.map((x) => x.runs.map((r) => r.text).join("")).join(""),
		).toBe("abcdefghijklmnopqrstuvwxyz");
	});

	test("a blank line is a line", () => {
		const l = layoutOf(text("**a**\n\nb"));
		expect(l.lines).toHaveLength(3);
		expect(l.lines[1].runs).toEqual([]);
	});

	test("the box is as tall as the lines, headings included", () => {
		const plain = textBox(text("a\nb"));
		const md = textBox(text("# a\nb"));
		expect(plain.maxY - plain.minY).toBeCloseTo(2 * LH);
		expect(md.maxY - md.minY).toBeGreaterThan(2 * LH);
		expect(md.maxY - md.minY).toBeCloseTo(layoutOf(text("# a\nb")).height);
	});

	test("a styled text at a point is as wide as its widest line", () => {
		const narrow = textBox(text("**a**"));
		const wide = textBox(text("**aaaaaaaa**"));
		expect(wide.maxX - wide.minX).toBeGreaterThan(narrow.maxX - narrow.minX);
	});

	test("the layout is kept for an element", () => {
		const t = text("**a**");
		expect(layoutOf(t)).toBe(layoutOf(t));
	});
});
