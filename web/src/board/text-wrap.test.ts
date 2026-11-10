import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import { textBox, textLines } from "./text";
import { wrapLines } from "./text-wrap";

/** Every character is 10 wide, so a width of 50 holds five characters. */
const ten = (text: string) => text.length * 10;
const wrap = (text: string, width: number) => wrapLines(text, width, 16, ten);

describe("wrapLines (R-044)", () => {
	test("text that fits stays on one line", () => {
		expect(wrap("ala ma", 100)).toEqual(["ala ma"]);
	});

	test("breaks between words, as late as possible", () => {
		expect(wrap("ala ma kota", 70)).toEqual(["ala ma", "kota"]);
		expect(wrap("ala ma kota", 40)).toEqual(["ala", "ma", "kota"]);
	});

	test("keeps the lines the author typed", () => {
		expect(wrap("ala\nma kota", 100)).toEqual(["ala", "ma kota"]);
		expect(wrap("a\n\nb", 100)).toEqual(["a", "", "b"]);
	});

	test("a word longer than the width is broken by characters", () => {
		expect(wrap("abcdefghij", 40)).toEqual(["abcd", "efgh", "ij"]);
		expect(wrap("ab abcdefghij", 40)).toEqual(["ab", "abcd", "efgh", "ij"]);
	});

	test("a width smaller than one character still moves forward", () => {
		expect(wrap("abc", 3)).toEqual(["a", "b", "c"]);
	});

	test("does not leave a space at the end of a broken line", () => {
		for (const line of wrap("aaaa bbbb cccc", 50))
			expect(line).toBe(line.trimEnd());
	});

	test("uses the given measure, so the real font decides in the browser", () => {
		const narrow = wrapLines("ala ma kota", 40, 16, (t) => t.length);
		expect(narrow).toEqual(["ala ma kota"]);
	});

	test("without a measure it estimates from the font size", () => {
		// 0.6 of the font size per character: 10 characters of a 10px font are 60px
		expect(wrapLines("aaaaa bbbbb", 60, 10)).toEqual(["aaaaa", "bbbbb"]);
		expect(wrapLines("aaaaa bbbbb", 65, 10)).toEqual(["aaaaa", "bbbbb"]);
		expect(wrapLines("aaaaa bbbbb", 66, 10)).toEqual(["aaaaa bbbbb"]);
	});
});

describe("text with a width (R-044)", () => {
	const area = (extra: Partial<Stroke> = {}): Stroke => ({
		id: "t",
		authorId: "a",
		color: "#000",
		size: 5,
		z: 1,
		kind: "text",
		text: "ala ma kota i psa",
		fontSize: 10,
		width: 90,
		points: [[100, 50, 0.5]],
		...extra,
	});

	test("its box is as wide as the area and as tall as the wrapped lines", () => {
		const b = textBox(area());
		expect(b.minX).toBe(100);
		expect(b.maxX - b.minX).toBe(90);
		const lines = textLines(area());
		expect(lines.length).toBeGreaterThan(1);
		expect(b.maxY - b.minY).toBeCloseTo(lines.length * 10 * 1.25);
	});

	test("a wider area needs fewer lines, a narrower one more", () => {
		const wide = textBox(area({ width: 400 }));
		const narrow = textBox(area({ width: 40 }));
		expect(narrow.maxY - narrow.minY).toBeGreaterThan(wide.maxY - wide.minY);
	});

	test("text without a width is laid out as before: its lines, its own width", () => {
		const point = area({ width: undefined, text: "ala\nma kota" });
		expect(textLines(point)).toEqual(["ala", "ma kota"]);
		const b = textBox(point);
		expect(b.maxX - b.minX).toBeCloseTo(7 * 10 * 0.6); // the longest line, ma kota
	});

	test("the layout of one element is computed once", () => {
		const t = area();
		expect(textLines(t)).toBe(textLines(t));
	});
});
