import { describe, expect, test } from "vitest";
import type { Point } from "./board";
import { decimate, lodTier, lodTolerance } from "./lod";

describe("lodTier", () => {
	test("a view at half scale or closer needs every point, farther ones a coarser tier", () => {
		expect(lodTier(2)).toBe(0);
		expect(lodTier(1)).toBe(0);
		expect(lodTier(0.5)).toBe(0);
		expect(lodTier(0.3)).toBe(1);
		expect(lodTier(0.25)).toBe(1);
		expect(lodTier(0.2)).toBe(2);
		expect(lodTier(0.1)).toBe(3);
		expect(lodTier(0.0001)).toBe(4); // capped
	});

	test("the tolerance doubles with the tier and is none for the finest", () => {
		expect(lodTolerance(0)).toBe(0);
		expect(lodTolerance(1)).toBeCloseTo(0.8);
		expect(lodTolerance(2)).toBeCloseTo(1.6);
		expect(lodTolerance(3)).toBeCloseTo(3.2);
	});

	test("the tolerance is at most 0.4 px on the screen at the closest scale of its tier", () => {
		for (const scale of [0.5, 0.33, 0.25, 0.2, 0.125, 0.1, 0.07, 0.0625]) {
			const t = lodTier(scale);
			expect(lodTolerance(t) * scale).toBeLessThanOrEqual(0.4 + 1e-9);
		}
	});
});

/** The distance of p from the segment a-b. */
function dist(p: Point, a: Point, b: Point): number {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const len2 = dx * dx + dy * dy;
	const t = len2
		? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
		: 0;
	return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

describe("decimate", () => {
	test("without a tolerance every point stays, and the very same list is returned", () => {
		const pts: Point[] = [
			[0, 0, 0.5],
			[1, 1, 0.5],
			[2, 0, 0.5],
		];
		expect(decimate(pts, 0, 4)).toBe(pts);
	});

	test("points on a straight line with a steady pressure collapse to the two ends", () => {
		const pts: Point[] = Array.from({ length: 100 }, (_, i) => [i, 2 * i, 0.5]);
		const out = decimate(pts, 0.8, 4);
		expect(out).toEqual([pts[0], pts[99]]);
	});

	test("a corner stays", () => {
		const pts: Point[] = [
			...Array.from({ length: 20 }, (_, i): Point => [i, 0, 0.5]),
			...Array.from({ length: 20 }, (_, i): Point => [19, i + 1, 0.5]),
		];
		const out = decimate(pts, 0.8, 4);
		expect(out).toContainEqual([19, 0, 0.5]);
		expect(out.length).toBeLessThan(pts.length);
	});

	test("the ends are always kept, a tap stays a tap", () => {
		const one: Point[] = [[5, 5, 0.5]];
		expect(decimate(one, 3, 4)).toEqual(one);
		const two: Point[] = [
			[5, 5, 0.5],
			[5.1, 5, 0.5],
		];
		expect(decimate(two, 3, 4)).toEqual(two);
	});

	test("no dropped point is farther than the tolerance from the simplified line", () => {
		let seed = 7;
		const rnd = () => {
			seed = (seed * 16807) % 2147483647;
			return seed / 2147483647;
		};
		for (const tol of [0.8, 1.6, 3.2]) {
			const pts: Point[] = [];
			let x = 0;
			let y = 0;
			for (let i = 0; i < 300; i++) {
				x += 2 + rnd() * 3;
				y += (rnd() - 0.5) * 6;
				pts.push([x, y, 0.5]);
			}
			const out = decimate(pts, tol, 4);
			expect(out.length).toBeLessThan(pts.length);
			// each original point lies near the segment of the output that spans it
			let j = 0;
			for (const p of pts) {
				while (j < out.length - 2 && out[j + 1][0] < p[0]) j++;
				expect(dist(p, out[j], out[j + 1])).toBeLessThanOrEqual(tol + 1e-9);
			}
		}
	});

	test("a bump of pressure that the pen's width shows is not smoothed away", () => {
		// a straight line whose pressure rises from 0.1 to 1 and falls back: the width changes by
		// 0.9 * size in the middle, which two end points could not tell
		const pts: Point[] = Array.from({ length: 50 }, (_, i) => [
			i * 4,
			0,
			0.1 + 0.9 * Math.sin((Math.PI * i) / 49),
		]);
		const flat: Point[] = pts.map((p) => [p[0], p[1], 0.5]);
		expect(decimate(flat, 0.8, 12).length).toBe(2);
		expect(decimate(pts, 0.8, 12).length).toBeGreaterThan(2);
	});

	test("a steady change of pressure along a line is carried by the two ends", () => {
		const pts: Point[] = Array.from({ length: 50 }, (_, i) => [
			i * 4,
			0,
			0.1 + (0.9 * i) / 49,
		]);
		expect(decimate(pts, 0.8, 12).length).toBe(2);
	});

	test("pressure is the one of the points that stay", () => {
		const pts: Point[] = [
			[0, 0, 0.2],
			[10, 0.1, 0.9],
			[20, 0, 0.4],
		];
		for (const p of decimate(pts, 5, 1)) expect(pts).toContain(p);
	});
});
