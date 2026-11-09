import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import { intersects, strokeBounds } from "./bounds";

function stroke(pts: [number, number][], size = 4): Stroke {
	return { id: "s", authorId: "a", color: "#111", size, z: 0, points: pts.map(([x, y]) => [x, y, 0.5]) };
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
		expect(strokeBounds(stroke([[10, 10]], 6))).toEqual({ minX: 4, minY: 4, maxX: 16, maxY: 16 });
	});
});

describe("intersects", () => {
	const view = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

	test("overlapping rectangles intersect", () => {
		expect(intersects({ minX: 90, minY: 90, maxX: 150, maxY: 150 }, view)).toBe(true);
	});

	test("a rectangle inside or around the other intersects", () => {
		expect(intersects({ minX: 10, minY: 10, maxX: 20, maxY: 20 }, view)).toBe(true);
		expect(intersects({ minX: -50, minY: -50, maxX: 500, maxY: 500 }, view)).toBe(true);
	});

	test("separate rectangles do not intersect", () => {
		expect(intersects({ minX: 101, minY: 0, maxX: 200, maxY: 50 }, view)).toBe(false);
		expect(intersects({ minX: 0, minY: -80, maxX: 50, maxY: -1 }, view)).toBe(false);
	});
});
