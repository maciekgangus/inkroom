import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import { intersects, strokeBounds } from "./bounds";
import { textBox } from "./text";

function stroke(pts: [number, number][], size = 4): Stroke {
	return {
		id: "s",
		authorId: "a",
		color: "#111",
		size,
		z: 0,
		points: pts.map(([x, y]) => [x, y, 0.5]),
	};
}

describe("strokeBounds", () => {
	test("covers all points plus the stroke width", () => {
		const b = strokeBounds(
			stroke(
				[
					[10, 20],
					[50, 5],
					[30, 40],
				],
				4,
			),
		);
		expect(b).toEqual({ minX: 6, minY: 1, maxX: 54, maxY: 44 });
	});

	test("works for a single point", () => {
		expect(strokeBounds(stroke([[10, 10]], 6))).toEqual({
			minX: 4,
			minY: 4,
			maxX: 16,
			maxY: 16,
		});
	});
});

describe("strokeBounds for shapes and text", () => {
	const base = { id: "s", authorId: "a", color: "#111", size: 4, z: 0 };

	test("a line is bounded like a two-point stroke", () => {
		const b = strokeBounds({
			...base,
			kind: "line",
			points: [
				[10, 20, 0.5],
				[50, 5, 0.5],
			],
		});
		expect(b).toEqual({ minX: 6, minY: 1, maxX: 54, maxY: 24 });
	});

	test("a rectangle is bounded by its two corners, whichever way they were dragged", () => {
		const b = strokeBounds({
			...base,
			kind: "rect",
			points: [
				[50, 40, 0.5],
				[10, 10, 0.5],
			],
		});
		expect(b).toEqual({ minX: 6, minY: 6, maxX: 54, maxY: 44 });
	});

	test("a circle is bounded by its centre and radius", () => {
		const b = strokeBounds({
			...base,
			kind: "circle",
			points: [
				[100, 100, 0.5],
				[130, 140, 0.5],
			],
		}); // r = 50
		expect(b).toEqual({ minX: 46, minY: 46, maxX: 154, maxY: 154 });
	});

	test("text is bounded by its box plus some slack for the estimated width", () => {
		const t = {
			...base,
			kind: "text" as const,
			text: "hello",
			size: 5,
			points: [[10, 10, 0.5]] as [number, number, number][],
		};
		const box = textBox(t);
		const b = strokeBounds(t);
		expect(b.minX).toBeLessThanOrEqual(box.minX);
		expect(b.minY).toBeLessThanOrEqual(box.minY);
		expect(b.maxX).toBeGreaterThan(box.maxX);
		expect(b.maxY).toBeGreaterThan(box.maxY);
	});
});

describe("strokeBounds for images", () => {
	test("an image is bounded by its two corners, with no padding", () => {
		const b = strokeBounds({
			id: "i",
			authorId: "a",
			color: "#000",
			size: 1,
			z: 0,
			kind: "image",
			src: "x",
			points: [
				[300, 200, 0.5],
				[100, 50, 0.5],
			],
		});
		expect(b).toEqual({ minX: 100, minY: 50, maxX: 300, maxY: 200 });
	});
});

describe("intersects", () => {
	const view = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

	test("overlapping rectangles intersect", () => {
		expect(intersects({ minX: 90, minY: 90, maxX: 150, maxY: 150 }, view)).toBe(
			true,
		);
	});

	test("a rectangle inside or around the other intersects", () => {
		expect(intersects({ minX: 10, minY: 10, maxX: 20, maxY: 20 }, view)).toBe(
			true,
		);
		expect(
			intersects({ minX: -50, minY: -50, maxX: 500, maxY: 500 }, view),
		).toBe(true);
	});

	test("separate rectangles do not intersect", () => {
		expect(intersects({ minX: 101, minY: 0, maxX: 200, maxY: 50 }, view)).toBe(
			false,
		);
		expect(intersects({ minX: 0, minY: -80, maxX: 50, maxY: -1 }, view)).toBe(
			false,
		);
	});
});
