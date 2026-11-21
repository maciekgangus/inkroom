import { describe, expect, test } from "vitest";
import type { Point, Stroke } from "./board";
import {
	forEachPoint,
	MIN_PACKED_POINTS,
	packedOf,
	packStroke,
	pointCount,
} from "./points";
import { translateEl } from "./transform";

/** A hand-drawn looking stroke: `n` points two decimals apart with a pressure of three. */
function wiggle(n: number, x0 = 100.25, y0 = 50.5): Stroke {
	const points: Point[] = [];
	for (let i = 0; i < n; i++)
		points.push([
			Math.round((x0 + i * 1.37 + Math.sin(i / 3) * 4) * 100) / 100,
			Math.round((y0 + Math.cos(i / 4) * 9 + i * 0.21) * 100) / 100,
			Math.round((0.3 + 0.4 * Math.abs(Math.sin(i / 7))) * 1000) / 1000,
		]);
	return { id: "s1", authorId: "a", color: "#111111", size: 2, z: 1, points };
}

/** Every number of `got` within `eps` of the one of `want` (a float is not the double it was made of). */
function expectClose(got: Point[], want: Point[], eps = 1e-3): void {
	expect(got).toHaveLength(want.length);
	got.forEach((p, i) => {
		for (let k = 0; k < 3; k++)
			expect(Math.abs(p[k] - want[i][k])).toBeLessThan(k < 2 ? eps : 1e-6);
	});
}

describe("packStroke (R-100)", () => {
	test("a freehand stroke reads back the same numbers", () => {
		const s = wiggle(200);
		const before = JSON.parse(JSON.stringify(s.points)) as Point[];
		expect(packStroke(s)).toBe(true);
		expect(packedOf(s)).toBeInstanceOf(Float32Array);
		expectClose(s.points, before);
		expect(pointCount(s)).toBe(200);
	});

	test("serialises with the keys of the plain stroke and the same numbers", () => {
		const s = wiggle(120);
		const plain = JSON.parse(JSON.stringify(s)) as Stroke;
		packStroke(s);
		const out = JSON.parse(JSON.stringify(s)) as Stroke;
		expect(Object.keys(out)).toEqual(Object.keys(plain));
		const { points: a, ...restOut } = out;
		const { points: b, ...restPlain } = plain;
		expect(restOut).toEqual(restPlain);
		expectClose(a, b);
	});

	test("numbers with many decimals keep them to the precision of a float", () => {
		const s = wiggle(20);
		s.points[3] = [12.3456789, 98.7654321, 0.123456789];
		packStroke(s);
		expectClose([s.points[3]], [[12.3456789, 98.7654321, 0.123456789]], 1e-4);
	});

	test("packing what a packed stroke reports gives the same floats again", () => {
		const s = wiggle(200, 14200.37, 7900.91);
		packStroke(s);
		const first = s.points.map((p) => [...p]);
		const again: Stroke = {
			...s,
			points: s.points.map((p) => [...p] as Point),
		};
		packStroke(again);
		expect(again.points).toEqual(first);
	});

	test("a stroke far from the origin keeps its precision", () => {
		const s = wiggle(300, 14200.37, 7900.91);
		const before = JSON.parse(JSON.stringify(s.points)) as Point[];
		packStroke(s);
		expectClose(s.points, before);
	});

	test("a stroke a million units away stays within a hundredth", () => {
		const s = wiggle(100, 1_000_000.37, 2_000_000.91);
		const before = s.points.map((p) => [...p]);
		packStroke(s);
		s.points.forEach((p, i) => {
			expect(Math.abs(p[0] - before[i][0])).toBeLessThan(0.5);
			expect(Math.abs(p[1] - before[i][1])).toBeLessThan(0.5);
		});
	});

	test("short strokes, shapes, texts and images stay arrays", () => {
		const short = wiggle(MIN_PACKED_POINTS - 1);
		expect(packStroke(short)).toBe(false);
		expect(packedOf(short)).toBeUndefined();
		for (const kind of ["line", "rect", "circle", "text", "image", "plane"]) {
			const el = { ...wiggle(40), kind } as Stroke;
			expect(packStroke(el)).toBe(false);
		}
		expect(packStroke({ ...wiggle(40), kind: "stroke" })).toBe(true);
	});

	test("a stroke with a point that is not a number is left alone", () => {
		const s = wiggle(30);
		s.points[5] = [Number.NaN, 1, 0.5];
		expect(packStroke(s)).toBe(false);
		expect(Number.isNaN(s.points[5][0])).toBe(true);
	});

	test("packing twice does nothing the second time", () => {
		const s = wiggle(50);
		packStroke(s);
		const a = packedOf(s);
		expect(packStroke(s)).toBe(true);
		expect(packedOf(s)).toBe(a);
	});

	test("the element keeps its identity and its other fields", () => {
		const s = { ...wiggle(50), dash: "natural" as const, opacity: 0.5 };
		const same = s;
		packStroke(s);
		expect(s).toBe(same);
		expect(s.dash).toBe("natural");
		expect(Object.keys(s)).toContain("points");
	});

	test("a copy made by spreading is plain again", () => {
		const s = wiggle(50);
		packStroke(s);
		const copy = { ...s, color: "#ff0000" };
		expect(packedOf(copy)).toBeUndefined();
		expect(copy.points).toEqual(s.points);
	});

	test("writing points turns a packed stroke back into a plain one", () => {
		const s = wiggle(50);
		packStroke(s);
		s.points = [[1, 2, 0.5]];
		expect(packedOf(s)).toBeUndefined();
		expect(s.points).toEqual([[1, 2, 0.5]]);
	});

	test("forEachPoint and pointCount agree for packed and plain strokes", () => {
		const plain = wiggle(64);
		const packed = wiggle(64);
		packStroke(packed);
		const a: number[] = [];
		const b: number[] = [];
		forEachPoint(plain, (x, y, p) => a.push(x, y, p));
		forEachPoint(packed, (x, y, p) => b.push(x, y, p));
		expect(pointCount(packed)).toBe(pointCount(plain));
		expect(a.length).toBe(b.length);
		a.forEach((v, i) => {
			expect(Math.abs(v - b[i])).toBeLessThan(0.0006);
		});
	});

	test("reading points twice in a row gives the same array", () => {
		const s = wiggle(50);
		packStroke(s);
		expect(s.points).toBe(s.points);
	});

	test("50 moves and moves back leave the stroke where it was", () => {
		const s = wiggle(200, 14200.37, 7900.91);
		const start = JSON.parse(JSON.stringify(s.points)) as Point[];
		let cur: Stroke = s;
		for (let i = 0; i < 50; i++) {
			cur = translateEl(cur, i % 2 ? -13.37 : 13.37, i % 2 ? 7.91 : -7.91);
			packStroke(cur); // what the board does with every new version
		}
		expectClose(cur.points, start, 0.01);
	});
});
