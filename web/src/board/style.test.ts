import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import { applyStyle, capabilities, styleOf } from "./style";

const base = { id: "e", authorId: "a", color: "#111", size: 4, z: 0 };
const pts = (...p: [number, number][]) =>
	p.map(([x, y]) => [x, y, 0.5] as [number, number, number]);
const freehand: Stroke = { ...base, points: pts([0, 0], [5, 5]) };
const line: Stroke = { ...base, kind: "line", points: pts([0, 0], [5, 5]) };
const rect: Stroke = { ...base, kind: "rect", points: pts([0, 0], [5, 5]) };
const circle: Stroke = { ...base, kind: "circle", points: pts([0, 0], [5, 0]) };
const text: Stroke = {
	...base,
	kind: "text",
	text: "hi",
	size: 5,
	points: pts([0, 0]),
};
const image: Stroke = {
	...base,
	kind: "image",
	src: "x",
	points: pts([0, 0], [5, 5]),
};

describe("applyStyle", () => {
	test("colour applies to everything except images", () => {
		for (const el of [freehand, line, rect, circle, text])
			expect(applyStyle(el, { color: "#f00" }).color).toBe("#f00");
		expect(applyStyle(image, { color: "#f00" }).color).toBe("#111");
	});

	test("size is the line width, but for a text it is the font size", () => {
		expect(applyStyle(rect, { size: 10 }).size).toBe(10);
		const t = applyStyle(text, { size: 10 });
		expect(t.fontSize).toBe(40);
		expect(t.size).toBe(10);
		expect(applyStyle(image, { size: 10 }).size).toBe(4);
	});

	test("dash applies to lines and shapes, not to freehand strokes, text or images", () => {
		for (const el of [line, rect, circle])
			expect(applyStyle(el, { dash: "dashed" }).dash).toBe("dashed");
		for (const el of [freehand, text, image])
			expect(applyStyle(el, { dash: "dashed" }).dash).toBeUndefined();
	});

	test("solid dash removes the field", () => {
		const dashed = applyStyle(line, { dash: "dotted" });
		expect("dash" in applyStyle(dashed, { dash: "solid" })).toBe(false);
	});

	test("fill applies to rectangles and circles, and null removes it", () => {
		expect(applyStyle(rect, { fill: "#0f0" }).fill).toBe("#0f0");
		expect(applyStyle(circle, { fill: "#0f0" }).fill).toBe("#0f0");
		expect(applyStyle(line, { fill: "#0f0" }).fill).toBeUndefined();
		const filled = applyStyle(rect, { fill: "#0f0" });
		expect("fill" in applyStyle(filled, { fill: null })).toBe(false);
	});

	test("opacity applies to everything, is kept within 0..1, and 1 removes the field", () => {
		for (const el of [freehand, line, rect, circle, text, image])
			expect(applyStyle(el, { opacity: 0.5 }).opacity).toBe(0.5);
		expect(applyStyle(rect, { opacity: 5 }).opacity).toBeUndefined();
		expect(applyStyle(rect, { opacity: -1 }).opacity).toBe(0);
	});

	test("does not change the original and leaves unrelated fields alone", () => {
		const r = { ...rect, rot: 0.4 };
		const out = applyStyle(r, { color: "#f00" });
		expect(r.color).toBe("#111");
		expect(out.rot).toBe(0.4);
		expect(out.points).toBe(r.points);
	});
});

describe("capabilities", () => {
	test("a mix offers what at least one element supports", () => {
		expect(capabilities([freehand])).toEqual({
			color: true,
			size: true,
			dash: false,
			fill: false,
			text: false,
		});
		expect(capabilities([rect, freehand])).toEqual({
			color: true,
			size: true,
			dash: true,
			fill: true,
			text: false,
		});
		expect(capabilities([text])).toEqual({
			color: true,
			size: true,
			dash: false,
			fill: false,
			text: true,
		});
		expect(capabilities([image])).toEqual({
			color: false,
			size: false,
			dash: false,
			fill: false,
			text: false,
		});
	});
});

describe("styleOf", () => {
	test("reads the current values from the first element", () => {
		const r: Stroke = {
			...rect,
			color: "#abc",
			size: 10,
			dash: "dashed",
			fill: "#0f0",
			opacity: 0.5,
		};
		expect(styleOf([r, line])).toEqual({
			color: "#abc",
			size: 10,
			dash: "dashed",
			fill: "#0f0",
			opacity: 0.5,
		});
	});

	test("falls back to defaults", () => {
		expect(styleOf([freehand])).toEqual({
			color: "#111",
			size: 4,
			dash: "solid",
			fill: null,
			opacity: 1,
		});
	});
});
