import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import {
	centreOn,
	contentBounds,
	fitView,
	fromMap,
	mapFit,
	toMap,
} from "./minimap";

const rect = (
	id: string,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
): Stroke => ({
	id,
	authorId: "a",
	color: "#000",
	size: 2,
	z: 1,
	kind: "rect",
	points: [
		[x0, y0, 0.5],
		[x1, y1, 0.5],
	],
});

describe("the mini map (R-049)", () => {
	test("the bounds of all the content, null for an empty board", () => {
		expect(contentBounds([])).toBeNull();
		expect(
			contentBounds([rect("a", 0, 0, 10, 10), rect("b", 100, -50, 200, 20)]),
		).toEqual({
			minX: 0,
			minY: -50,
			maxX: 200,
			maxY: 20,
		});
	});

	test("the map shows the content and the screen together, with a margin", () => {
		const view = { minX: 0, minY: 0, maxX: 1000, maxY: 500 };
		const content = { minX: 5000, minY: 0, maxX: 6000, maxY: 500 };
		const fit = mapFit(content, view, { w: 240, h: 160 });
		// both ends are inside the box
		for (const [x, y] of [
			[view.minX, view.minY],
			[content.maxX, content.maxY],
		]) {
			const [mx, my] = toMap(fit, x, y);
			expect(mx).toBeGreaterThanOrEqual(0);
			expect(mx).toBeLessThanOrEqual(240);
			expect(my).toBeGreaterThanOrEqual(0);
			expect(my).toBeLessThanOrEqual(160);
		}
	});

	test("with no content the map follows the screen alone", () => {
		const view = { minX: -200, minY: -100, maxX: 200, maxY: 100 };
		const fit = mapFit(null, view, { w: 240, h: 160 });
		const [mx, my] = toMap(fit, 0, 0);
		expect(mx).toBeCloseTo(120);
		expect(my).toBeCloseTo(80);
	});

	test("a point of the map and the board are each other's inverse", () => {
		const fit = mapFit(
			{ minX: 0, minY: 0, maxX: 4000, maxY: 3000 },
			{ minX: 100, minY: 100, maxX: 1100, maxY: 700 },
			{ w: 240, h: 160 },
		);
		const [x, y] = fromMap(fit, ...toMap(fit, 1234, 567));
		expect(x).toBeCloseTo(1234);
		expect(y).toBeCloseTo(567);
	});

	test("a click on the map puts the screen's centre there", () => {
		const v = { x: 0, y: 0, scale: 2 };
		centreOn(v, [500, 300], 800, 600);
		expect(v.x).toBe(500 - 800 / 2 / 2);
		expect(v.y).toBe(300 - 600 / 2 / 2);
		expect(v.scale).toBe(2);
	});

	test("fitting the view shows all the content with a margin, within the zoom limits", () => {
		const v = { x: 0, y: 0, scale: 1 };
		fitView(v, { minX: 0, minY: 0, maxX: 4000, maxY: 2000 }, 1000, 600);
		expect(v.scale).toBeLessThan(0.25);
		expect(v.scale).toBeGreaterThanOrEqual(0.1);
		const centre = [v.x + 1000 / 2 / v.scale, v.y + 600 / 2 / v.scale];
		expect(centre[0]).toBeCloseTo(2000);
		expect(centre[1]).toBeCloseTo(1000);
		const huge = { x: 0, y: 0, scale: 1 };
		fitView(huge, { minX: 0, minY: 0, maxX: 1e7, maxY: 1e7 }, 1000, 600);
		expect(huge.scale).toBe(0.1); // the least the board allows
		const tiny = { x: 0, y: 0, scale: 1 };
		fitView(tiny, { minX: 0, minY: 0, maxX: 5, maxY: 5 }, 1000, 600);
		expect(tiny.scale).toBeLessThanOrEqual(1); // never zoomed in past 100% to show a speck
	});
});
