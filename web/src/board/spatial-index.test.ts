import { describe, expect, test } from "vitest";
import { Board, type Point, type Stroke } from "./board";
import { intersects, strokeBounds } from "./bounds";
import type { Rect } from "./viewport";

/** Deterministic RNG (mulberry32), so the property tests always run the same sequence. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The reference: a linear scan of the sorted list, as the board did before R-118. */
const scan = (b: Board, r: Rect): string[] =>
	b.strokes.filter((s) => intersects(strokeBounds(s), r)).map((s) => s.id);

const rect = (x: number, y: number, w: number, h: number): Rect => ({
	minX: x,
	minY: y,
	maxX: x + w,
	maxY: y + h,
});

const base = (id: string, z: number): Stroke => ({
	id,
	authorId: "a",
	color: "#111",
	size: 4,
	z,
	points: [[0, 0, 0.5]],
});

/** A freehand stroke of 24 points, packed on insert (R-100). */
function freehand(
	rnd: () => number,
	id: string,
	z: number,
	x: number,
	y: number,
	spread: number,
): Stroke {
	const points: Point[] = [];
	for (let i = 0; i < 24; i++)
		points.push([x + (rnd() - 0.5) * spread, y + (rnd() - 0.5) * spread, 0.5]);
	return { ...base(id, z), points };
}

describe("Board spatial queries (R-118)", () => {
	test("queryRect matches a linear scan, in drawing order, past the fallback size", () => {
		const rnd = mulberry32(20261126);
		const board = new Board();
		for (let i = 0; i < 300; i++) {
			const x = (rnd() * 2 - 1) * 30000;
			const y = (rnd() * 2 - 1) * 30000;
			// Every seventh element is huge, so it lands in the large bucket (> 16 cells).
			const spread = i % 7 === 0 ? 60000 : 200;
			const s = freehand(rnd, `s${i}`, i + 1, x, y, spread);
			if (i % 5 === 0) {
				s.kind = "rect";
				s.points = [
					[x, y, 0.5],
					[x + spread, y + spread / 2, 0.5],
				];
			}
			board.addStroke(s);
		}
		for (let q = 0; q < 60; q++) {
			const x = (rnd() * 2 - 1) * 30000;
			const y = (rnd() * 2 - 1) * 30000;
			const w = [50, 1500, 40000][q % 3];
			const r = rect(x, y, w, w);
			expect(board.queryRect(r).map((s) => s.id)).toEqual(scan(board, r));
		}
	});
});
