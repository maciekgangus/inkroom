import { describe, expect, test } from "vitest";
import type { Point } from "./board";
import { type Recognized, recognizeShape } from "./shape-recognition";

/** The two points of a recognised shape; fails the test when nothing was recognised. */
function ends(r: Recognized | null): [Point, Point] {
	if (!r) throw new Error("nothing was recognised");
	return r.points;
}

/** A small seeded generator, so the noisy samples are the same on every run. */
function rng(seed: number) {
	let s = seed;
	return () => {
		s = (s * 1664525 + 1013904223) % 4294967296;
		return s / 4294967296;
	};
}

const noisy = (pts: [number, number][], amp: number, seed = 1): Point[] => {
	const r = rng(seed);
	return pts.map(([x, y]) => [
		x + (r() - 0.5) * amp,
		y + (r() - 0.5) * amp,
		0.5,
	]);
};

/** Points along a polyline, about `step` apart. */
function along(corners: [number, number][], step = 6): [number, number][] {
	const out: [number, number][] = [];
	for (let i = 0; i < corners.length - 1; i++) {
		const [ax, ay] = corners[i];
		const [bx, by] = corners[i + 1];
		const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
		for (let k = 0; k < n; k++)
			out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
	}
	out.push(corners[corners.length - 1]);
	return out;
}

const ellipsePts = (
	cx: number,
	cy: number,
	a: number,
	b: number,
	rot = 0,
	turn = 1.02,
): [number, number][] => {
	const out: [number, number][] = [];
	const n = 60;
	for (let i = 0; i <= n; i++) {
		const t = (i / n) * Math.PI * 2 * turn + 0.7;
		const x = a * Math.cos(t);
		const y = b * Math.sin(t);
		out.push([
			cx + x * Math.cos(rot) - y * Math.sin(rot),
			cy + x * Math.sin(rot) + y * Math.cos(rot),
		]);
	}
	return out;
};

describe("recognizeShape (R-095)", () => {
	test("a nearly straight stroke becomes a line between its ends", () => {
		const pts = noisy(
			along([
				[10, 10],
				[310, 60],
			]),
			3,
		);
		const r = recognizeShape(pts);
		expect(r?.kind).toBe("line");
		expect(r?.points[0][0]).toBeCloseTo(10, -1);
		expect(r?.points[1][0]).toBeCloseTo(310, -1);
	});

	test("a line close to horizontal is made exactly horizontal", () => {
		const r = recognizeShape(
			noisy(
				along([
					[10, 100],
					[400, 108],
				]),
				2,
			),
		);
		expect(r?.kind).toBe("line");
		expect(r?.points[0][1]).toBeCloseTo(r?.points[1][1] ?? 0, 5);
	});

	test("a wobbly circle becomes an ellipse with equal axes", () => {
		const r = recognizeShape(noisy(ellipsePts(200, 200, 100, 100), 6));
		expect(r?.kind).toBe("ellipse");
		const [a, b] = ends(r);
		expect(Math.abs(b[0] - a[0])).toBeCloseTo(Math.abs(b[1] - a[1]), 5);
		expect((a[0] + b[0]) / 2).toBeCloseTo(200, -1);
		expect(Math.abs(b[0] - a[0])).toBeGreaterThan(170);
	});

	test("a wide oval stays an ellipse, not a circle", () => {
		const r = recognizeShape(noisy(ellipsePts(300, 150, 160, 70), 5, 2));
		expect(r?.kind).toBe("ellipse");
		const [a, b] = ends(r);
		expect(Math.abs(b[0] - a[0])).toBeGreaterThan(1.6 * Math.abs(b[1] - a[1]));
	});

	test("a tilted oval keeps its tilt", () => {
		const r = recognizeShape(noisy(ellipsePts(300, 300, 170, 60, 0.6), 4, 3));
		expect(r?.kind).toBe("ellipse");
		expect(Math.abs(r?.rot ?? 0)).toBeGreaterThan(0.4);
	});

	test("a hand-drawn rectangle becomes an axis-aligned rectangle", () => {
		const rect = along([
			[50, 50],
			[350, 55],
			[348, 220],
			[52, 215],
			[48, 46],
		]);
		const r = recognizeShape(noisy(rect, 5, 4));
		expect(r?.kind).toBe("rect");
		expect(r?.rot ?? 0).toBe(0);
		const [a, b] = ends(r);
		expect(Math.abs(b[0] - a[0])).toBeGreaterThan(280);
		expect(Math.abs(b[1] - a[1])).toBeGreaterThan(150);
	});

	test("a rectangle with nearly equal sides becomes a square", () => {
		const sq = along([
			[50, 50],
			[250, 54],
			[252, 250],
			[48, 248],
			[49, 49],
		]);
		const r = recognizeShape(noisy(sq, 5, 5));
		expect(r?.kind).toBe("rect");
		const [a, b] = ends(r);
		expect(Math.abs(b[0] - a[0])).toBeCloseTo(Math.abs(b[1] - a[1]), 5);
	});

	test("a tilted rectangle keeps its tilt", () => {
		const c = Math.cos(0.5);
		const s = Math.sin(0.5);
		const rot = ([x, y]: [number, number]): [number, number] => [
			300 + x * c - y * s,
			300 + x * s + y * c,
		];
		const corners = (
			[
				[-150, -70],
				[150, -70],
				[150, 70],
				[-150, 70],
				[-150, -70],
			] as [number, number][]
		).map(rot);
		const r = recognizeShape(noisy(along(corners), 4, 6));
		expect(r?.kind).toBe("rect");
		expect(Math.abs(r?.rot ?? 0)).toBeGreaterThan(0.3);
	});

	test("a closed stroke with three corners becomes a triangle with free vertices", () => {
		const tri = along([
			[200, 40],
			[330, 260],
			[70, 255],
			[203, 44],
		]);
		const r = recognizeShape(noisy(tri, 5, 7));
		expect(r?.kind).toBe("triangle");
		expect(r?.verts).toHaveLength(3);
		for (const [fx, fy] of r?.verts ?? []) {
			expect(fx).toBeGreaterThanOrEqual(0);
			expect(fx).toBeLessThanOrEqual(1);
			expect(fy).toBeGreaterThanOrEqual(0);
			expect(fy).toBeLessThanOrEqual(1);
		}
	});

	test("a squiggle is left as it is", () => {
		const squiggle: [number, number][] = [];
		for (let i = 0; i < 80; i++)
			squiggle.push([10 + i * 5, 100 + Math.sin(i / 3) * 45]);
		expect(recognizeShape(noisy(squiggle, 3, 8))).toBeNull();
	});

	test("handwriting-sized and tiny strokes are left as they are", () => {
		expect(
			recognizeShape(
				noisy(
					along(
						[
							[0, 0],
							[8, 3],
						],
						1,
					),
					0.5,
				),
			),
		).toBeNull();
		expect(recognizeShape([[0, 0, 0.5]])).toBeNull();
	});

	test("an open arc is not closed into a shape", () => {
		const arc = ellipsePts(200, 200, 100, 100, 0, 0.5);
		expect(recognizeShape(noisy(arc, 3, 9))?.kind).not.toBe("ellipse");
	});

	test("a long stroke is handled in one pass", () => {
		const big = noisy(ellipsePts(500, 500, 400, 300, 0, 1.01), 5, 10);
		const many: Point[] = [];
		for (let i = 0; i < 20; i++) many.push(...big);
		const t = performance.now();
		recognizeShape(many);
		expect(performance.now() - t).toBeLessThan(200);
	});

	describe("messier drawings are met half way", () => {
		test.each([
			[1, 18],
			[2, 22],
			[3, 26],
		])(
			"a very uneven circle (noise %i, amp %i) is still an ellipse",
			(seed, amp) => {
				const pts = ellipsePts(300, 300, 110, 100, 0, 1.0).map(
					([x, y], i): [number, number] => [
						x + Math.sin(i / 4) * 9,
						y + Math.cos(i / 5) * 9,
					],
				);
				expect(recognizeShape(noisy(pts, amp, seed))?.kind).toBe("ellipse");
			},
		);

		test("a circle left open by a gap of a few degrees is still an ellipse", () => {
			const arc = ellipsePts(300, 300, 100, 100, 0, 0.93);
			expect(recognizeShape(noisy(arc, 8, 11))?.kind).toBe("ellipse");
		});

		test("a lopsided rectangle with bowed sides and slack corners is a rectangle", () => {
			const rect = along(
				[
					[50, 50],
					[380, 40],
					[372, 226],
					[44, 240],
					[62, 70],
				],
				7,
			).map(([x, y], i): [number, number] => [
				x + Math.sin(i / 3) * 6,
				y + Math.cos(i / 4) * 6,
			]);
			expect(recognizeShape(noisy(rect, 12, 12))?.kind).toBe("rect");
		});

		test("a rectangle whose corners are far from square (up to about 30 degrees off) still is", () => {
			const skew = along(
				[
					[50, 60],
					[370, 40],
					[400, 230],
					[70, 250],
					[52, 62],
				],
				7,
			);
			expect(recognizeShape(noisy(skew, 6, 13))?.kind).toBe("rect");
		});

		test("a sloppy triangle with rounded corners is a triangle", () => {
			const tri = along(
				[
					[210, 40],
					[345, 270],
					[60, 262],
					[206, 56],
				],
				7,
			).map(([x, y], i): [number, number] => [
				x + Math.sin(i / 3) * 7,
				y + Math.cos(i / 4) * 7,
			]);
			expect(recognizeShape(noisy(tri, 12, 14))?.kind).toBe("triangle");
		});

		test("a wavering line is still a line", () => {
			const line = along(
				[
					[40, 300],
					[520, 330],
				],
				8,
			).map(([x, y], i): [number, number] => [x, y + Math.sin(i / 4) * 9]);
			expect(recognizeShape(noisy(line, 8, 15))?.kind).toBe("line");
		});
	});

	describe("handwriting is never straightened", () => {
		const loopAt = (
			cx: number,
			cy: number,
			rx: number,
			ry: number,
			turns = 1.05,
		) => ellipsePts(cx, cy, rx, ry, 0, turns);
		const samples: Record<string, [number, number][]> = {
			"a small o": loopAt(100, 100, 12, 13),
			"a tall 0": loopAt(100, 100, 9, 19),
			"a wide 0": loopAt(100, 100, 17, 12),
			"an 8": [...loopAt(100, 80, 11, 11, 1), ...loopAt(100, 104, 13, 13, 1)],
			"an a": [
				...loopAt(100, 100, 11, 12, 1.1),
				...along(
					[
						[111, 90],
						[111, 114],
					],
					3,
				),
			],
			"an e": [
				...along(
					[
						[88, 100],
						[113, 98],
					],
					3,
				),
				...ellipsePts(100, 100, 13, 13, 0, 0.85),
			],
			"a 6": [
				...along(
					[
						[110, 70],
						[92, 100],
					],
					3,
				),
				...loopAt(100, 108, 11, 11, 1),
			],
			"a big handwritten o": loopAt(100, 100, 25, 26),
		};
		test.each(Object.keys(samples))("%s stays as written", (name) => {
			expect(recognizeShape(noisy(samples[name], 1.5, 21))).toBeNull();
		});
	});
});
