import { describe, expect, test } from "vitest";
import { MAX_SCALE, MIN_SCALE, Viewport } from "./viewport";

describe("Viewport", () => {
	test("starts at the origin with scale 1, so screen and board coordinates match", () => {
		const v = new Viewport();
		expect(v.toWorld(30, 40)).toEqual([30, 40]);
		expect(v.toScreen(30, 40)).toEqual([30, 40]);
	});

	test("toWorld and toScreen are inverse for any view", () => {
		const v = new Viewport();
		v.x = -120;
		v.y = 75;
		v.scale = 2.5;
		const [wx, wy] = v.toWorld(310, 205);
		const [sx, sy] = v.toScreen(wx, wy);
		expect(sx).toBeCloseTo(310);
		expect(sy).toBeCloseTo(205);
	});

	test("panBy moves the content with the pointer", () => {
		const v = new Viewport();
		const before = v.toWorld(100, 100);
		v.panBy(30, -20); // content moves right 30 and up 20
		expect(v.toScreen(before[0], before[1])).toEqual([130, 80]);
	});

	test("panBy distance on screen does not depend on scale", () => {
		const v = new Viewport();
		v.scale = 2;
		const before = v.toWorld(100, 100);
		v.panBy(30, 0);
		expect(v.toScreen(before[0], before[1])[0]).toBeCloseTo(130);
	});

	test("zoomAt keeps the point under the cursor fixed", () => {
		const v = new Viewport();
		v.x = 50;
		v.y = -10;
		const before = v.toWorld(400, 300);
		v.zoomAt(400, 300, 2);
		expect(v.scale).toBe(2);
		const [sx, sy] = v.toScreen(before[0], before[1]);
		expect(sx).toBeCloseTo(400);
		expect(sy).toBeCloseTo(300);
	});

	test("zoom is clamped to the allowed range", () => {
		const v = new Viewport();
		v.zoomAt(0, 0, 1000);
		expect(v.scale).toBe(MAX_SCALE);
		v.zoomAt(0, 0, 1e-6);
		expect(v.scale).toBe(MIN_SCALE);
	});

	test("zooming past the limit does not move the view", () => {
		const v = new Viewport();
		v.zoomAt(200, 200, 1000);
		const { x, y } = v;
		v.zoomAt(200, 200, 2); // already at the limit
		expect([v.x, v.y]).toEqual([x, y]);
	});

	test("setScaleAt sets an absolute scale around a point", () => {
		const v = new Viewport();
		v.scale = 3;
		const before = v.toWorld(500, 250);
		v.setScaleAt(500, 250, 1);
		expect(v.scale).toBe(1);
		const [sx, sy] = v.toScreen(before[0], before[1]);
		expect(sx).toBeCloseTo(500);
		expect(sy).toBeCloseTo(250);
	});

	test("worldRect is the visible part of the board", () => {
		const v = new Viewport();
		v.x = 100;
		v.y = 50;
		v.scale = 2;
		expect(v.worldRect(800, 600)).toEqual({ minX: 100, minY: 50, maxX: 500, maxY: 350 });
	});
});
