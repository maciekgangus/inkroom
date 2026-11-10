import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import { fontSizeFor, fontSizeOf, LINE_HEIGHT, textBox } from "./text";

function text(
	content: string,
	size = 5,
	at: [number, number] = [100, 50],
): Stroke {
	return {
		id: "t",
		authorId: "a",
		color: "#111",
		size,
		z: 0,
		kind: "text",
		text: content,
		points: [[at[0], at[1], 0.5]],
	};
}

describe("fontSizeFor", () => {
	test("maps the three pen sizes to readable font sizes", () => {
		expect([fontSizeFor(2), fontSizeFor(5), fontSizeFor(10)]).toEqual([
			16, 24, 40,
		]);
	});

	test("falls back to a proportional size for other values", () => {
		expect(fontSizeFor(7)).toBeGreaterThan(0);
	});
});

describe("textBox", () => {
	test("starts at the anchor and grows with the text", () => {
		const short = textBox(text("ab"));
		const long = textBox(text("abcdefgh"));
		expect(short.minX).toBe(100);
		expect(short.minY).toBe(50);
		expect(long.maxX - long.minX).toBeGreaterThan(short.maxX - short.minX);
	});

	test("height is one line height per line", () => {
		const one = textBox(text("a"));
		const three = textBox(text("a\nb\nc"));
		const lineH = 24 * LINE_HEIGHT;
		expect(one.maxY - one.minY).toBeCloseTo(lineH);
		expect(three.maxY - three.minY).toBeCloseTo(3 * lineH);
	});

	test("width follows the longest line", () => {
		const box = textBox(text("a\nabcdef\nabc"));
		const single = textBox(text("abcdef"));
		expect(box.maxX - box.minX).toBeCloseTo(single.maxX - single.minX);
	});
});

describe("fontSizeOf", () => {
	test("uses the element's own font size when it has one, else the size table", () => {
		expect(fontSizeOf({ ...text("a", 5), fontSize: 61 })).toBe(61);
		expect(fontSizeOf(text("a", 5))).toBe(24);
	});

	test("the text box follows the font size", () => {
		const big = textBox({ ...text("abcd", 5), fontSize: 100 });
		const normal = textBox(text("abcd", 5));
		expect(big.maxX - big.minX).toBeGreaterThan(normal.maxX - normal.minX);
	});
});
