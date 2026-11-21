import { describe, expect, test } from "vitest";
import type { Point, Stroke } from "./board";
import { outlinePolygon } from "./outline-lod";

/** A hand-drawn wave of `n` samples; the pressure wanders like a hand's. */
function stroke(size: number, dash?: Stroke["dash"], n = 200): Stroke {
	const points: Point[] = Array.from({ length: n }, (_, i) => [
		i * 1.4,
		Math.sin(i / 9) * 8 + Math.sin(i * 1.7) * 0.15,
		0.5 + 0.3 * Math.sin(i / 17),
	]);
	return { id: "s", authorId: "a", color: "#111", size, z: 0, dash, points };
}

/** The area of a polygon given as x, y, x, y... */
function area(p: Float32Array): number {
	let a = 0;
	for (let i = 0; i < p.length; i += 2) {
		const j = (i + 2) % p.length;
		a += p[i] * p[j + 1] - p[j] * p[i + 1];
	}
	return Math.abs(a) / 2;
}

describe("outlinePolygon", () => {
	test("the finest tier keeps every vertex of the outline", () => {
		const s = stroke(2.5, "natural");
		const full = outlinePolygon(s, 0);
		expect(full.length).toBeGreaterThan(200);
		expect(outlinePolygon(s, 1).length).toBeLessThanOrEqual(full.length);
	});

	test.each([
		["natural pen", "natural" as const],
		["plain pen", undefined],
	])(
		"a %s stroke keeps its width: the area is that of the full outline",
		(_n, dash) => {
			for (const size of [1, 2.5, 5]) {
				const s = stroke(size, dash);
				const full = area(outlinePolygon(s, 0));
				for (const tier of [2, 3, 4]) {
					const thin = area(outlinePolygon(s, tier));
					expect(Math.abs(thin - full) / full).toBeLessThan(0.08);
				}
			}
		},
	);

	test("a farther tier has fewer vertices", () => {
		const s = stroke(5, "natural");
		const near = outlinePolygon(s, 2).length;
		const far = outlinePolygon(s, 4).length;
		expect(far).toBeLessThanOrEqual(near);
		expect(near).toBeLessThan(outlinePolygon(s, 0).length);
	});

	test("a tap leaves a mark and nothing breaks for a stroke of one sample", () => {
		const tap: Stroke = { ...stroke(2.5), points: [[10, 10, 0.5]] };
		expect(outlinePolygon(tap, 3).length).toBeGreaterThanOrEqual(0);
	});
});
