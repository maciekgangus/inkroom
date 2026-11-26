import { describe, expect, test } from "vitest";
import { Board, type Point, type Stroke } from "./board";
import { intersects, strokeBounds } from "./bounds";
import { findHit, findObjectHit, objectHit, strokeHit } from "./hit";
import { fontsChanged } from "./text";
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

	test("queryView hands the renderer the board's own array when the rect spans too many cells", () => {
		const rnd = mulberry32(99);
		const board = new Board();
		for (let i = 0; i < 250; i++)
			board.addStroke(
				freehand(rnd, `s${i}`, i + 1, rnd() * 40000, rnd() * 40000, 100),
			);
		const huge = rect(-1e6, -1e6, 2e6, 2e6); // far beyond 64 cells
		expect(board.queryView(huge)).toBe(board.strokes);
		const small = rect(0, 0, 500, 500);
		expect(board.queryView(small).map((s) => s.id)).toEqual(scan(board, small));
	});

	test("queries stay 1:1 with a linear scan when a font loads and texts are reindexed", () => {
		const rnd = mulberry32(7);
		const board = new Board();
		for (let i = 0; i < 250; i++) {
			const x = (rnd() * 2 - 1) * 20000;
			const y = (rnd() * 2 - 1) * 20000;
			if (i % 3 === 0) {
				const s = base(`t${i}`, i + 1);
				s.kind = "text";
				s.text = i % 6 === 0 ? "**bold** line" : "plain";
				if (i % 9 === 0) s.width = 200 + rnd() * 400;
				s.points = [[x, y, 0.5]];
				board.addStroke(s);
			} else board.addStroke(freehand(rnd, `s${i}`, i + 1, x, y, 150));
		}
		fontsChanged(); // the font arrived: text boxes are measured again (R-044, R-101)
		board.reindexText();
		for (let q = 0; q < 40; q++) {
			const x = (rnd() * 2 - 1) * 20000;
			const y = (rnd() * 2 - 1) * 20000;
			const r = rect(x, y, [100, 3000, 50000][q % 3], 800);
			expect(board.queryRect(r).map((s) => s.id)).toEqual(scan(board, r));
		}
	});
});

/**
 * The required property-style check (R-118): hundreds of seeded random operations on a Board,
 * then many random rects (small, medium, large, negative coordinates) and point queries —
 * `queryRect`/`queryPoint` must equal the reference linear scan element by element, in the
 * exact `(z, id)` order, after every series of operations.
 */
describe("property: indexed queries equal a linear scan (R-118)", () => {
	test("600 seeded random operations, then random rects and points", () => {
		const rnd = mulberry32(0x5eed118);
		const board = new Board();
		let z = 0;
		let n = 0;
		const pos = (spread = 30000): number => (rnd() * 2 - 1) * spread;

		const randomStroke = (): Stroke => {
			const k = rnd();
			const x = pos();
			const y = pos();
			const s = base(`e${n++}`, ++z);
			if (k < 0.45) {
				// Freehand, packed on insert (R-100); the huge ones land in the large bucket.
				const spread = rnd() < 0.08 ? 80000 : 300;
				s.points = Array.from(
					{ length: 24 },
					(): Point => [
						x + (rnd() - 0.5) * spread,
						y + (rnd() - 0.5) * spread,
						0.5,
					],
				);
				if (rnd() < 0.1) s.rot = rnd() * Math.PI * 2;
			} else if (k < 0.6) {
				s.kind = "rect";
				const d = rnd() < 0.1 ? 50000 : 400;
				s.points = [
					[x, y, 0.5],
					[x + d, y + d / 2, 0.5],
				];
			} else if (k < 0.68) {
				s.kind = "circle";
				const r = rnd() < 0.1 ? 30000 : 200;
				s.points = [
					[x, y, 0.5],
					[x + r, y, 0.5],
				];
			} else if (k < 0.76) {
				// An ellipse: its hit test reaches beyond its box, so it always sits in `large`.
				s.kind = "ellipse";
				const w = 20 + rnd() * 400;
				const h = 4 + rnd() * (w / 20); // thin ones make the hit reach far along the major axis
				s.points = [
					[x, y, 0.5],
					[x + w, y + h, 0.5],
				];
				if (rnd() < 0.3) s.rot = rnd() * Math.PI * 2;
			} else if (k < 0.84) {
				// A shape drawn from parts (a cube's back edges stick out of its box).
				s.kind = rnd() < 0.5 ? "cube" : "trapezoid";
				const w = 20 + rnd() * 600;
				const h = 20 + rnd() * 400;
				s.points = [
					[x, y, 0.5],
					[x + w, y + h, 0.5],
				];
				if (rnd() < 0.3) s.rot = rnd() * Math.PI * 2;
			} else if (k < 0.92) {
				s.kind = "text";
				s.text = rnd() < 0.5 ? "plain line" : "**bold** and _it_";
				if (rnd() < 0.5) s.width = 100 + rnd() * 500;
				s.points = [[x, y, 0.5]];
			} else if (k < 0.97) {
				s.kind = "image";
				s.src = "img1";
				s.points = [
					[x, y, 0.5],
					[x + 800, y + 600, 0.5],
				];
			} else {
				s.points = []; // an empty element: non-finite box, must never hang a cell loop
			}
			return s;
		};

		const moved = (s: Stroke): Stroke => ({
			...s,
			points: s.points.map(
				(p): Point => [p[0] + pos(5000), p[1] + pos(5000), p[2]],
			),
			rot: rnd() < 0.3 ? rnd() * 6.28 : s.rot,
		});

		const check = (label: string): void => {
			for (let q = 0; q < 8; q++) {
				const x = pos(35000);
				const y = pos(35000);
				const size = [40, 900, 5000, 90000][q % 4];
				const r = rect(x, y, size, size);
				expect(
					board.queryRect(r).map((s) => s.id),
					`${label} rect ${q}`,
				).toEqual(scan(board, r));
			}
			for (let q = 0; q < 4; q++) {
				const x = pos(35000);
				const y = pos(35000);
				const rad = [10, 300, 4000][q % 3];
				// A point query must be a superset of everything the hit tests can catch...
				const cands = board.queryPoint(x, y, rad);
				const ids = new Set(cands.map((s) => s.id));
				for (const s of board.strokes) {
					if (strokeHit(s, x, y, rad) || objectHit(s, x, y, rad))
						expect(ids.has(s.id), `${label} point ${q} superset ${s.id}`).toBe(
							true,
						);
				}
				// ...and the topmost hit over the candidates must equal a full scan's.
				expect(
					findHit(cands, x, y, rad)?.id ?? null,
					`${label} point ${q} eraser`,
				).toBe(findHit(board.strokes, x, y, rad)?.id ?? null);
				expect(
					findObjectHit(cands, x, y, rad)?.id ?? null,
					`${label} point ${q} click`,
				).toBe(findObjectHit(board.strokes, x, y, rad)?.id ?? null);
			}
		};

		// Start past the fallback size, so the index path is what gets compared.
		for (let i = 0; i < 250; i++) board.addStroke(randomStroke());
		check("initial");

		for (let op = 0; op < 600; op++) {
			const k = rnd();
			const ids = board.strokes.map((s) => s.id);
			const anyId = (): string => ids[Math.floor(rnd() * ids.length)];
			const anyEl = (): Stroke | undefined =>
				board.strokes.find((s) => s.id === anyId());
			if (k < 0.22) board.addStroke(randomStroke());
			else if (k < 0.3)
				board.addMany(
					"a",
					Array.from({ length: 1 + Math.floor(rnd() * 4) }, randomStroke),
				);
			else if (k < 0.45 && ids.length) {
				const el = anyEl();
				if (el) {
					const next = moved(el);
					if (rnd() < 0.25) next.z = ++z; // a new z moves it in the drawing order
					board.updateElement(rnd() < 0.5 ? "a" : "b", next);
				}
			} else if (k < 0.5 && ids.length) {
				board.updateMany(
					"a",
					Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => {
						const el = anyEl();
						return el ? moved(el) : randomStroke();
					}),
				);
			} else if (k < 0.6 && ids.length) board.eraseStroke("a", anyId());
			else if (k < 0.66 && ids.length)
				board.eraseMany(
					"a",
					Array.from({ length: 1 + Math.floor(rnd() * 3) }, anyId),
				);
			else if (k < 0.72) board.undo(rnd() < 0.7 ? "a" : "b");
			else if (k < 0.77) board.redo(rnd() < 0.7 ? "a" : "b");
			else if (k < 0.87) {
				const k2 = rnd();
				if (k2 < 0.4) board.applyRemote({ t: "add", stroke: randomStroke() });
				else if (k2 < 0.7 && ids.length) {
					const el = anyEl();
					if (el) board.applyRemote({ t: "update", stroke: moved(el) });
				} else if (ids.length) board.applyRemote({ t: "remove", id: anyId() });
			} else if (k < 0.9) {
				// A snapshot: the same elements, shuffled, maybe a few dropped.
				const all = [...board.strokes];
				for (let i = all.length - 1; i > 0; i--) {
					const j = Math.floor(rnd() * (i + 1));
					[all[i], all[j]] = [all[j], all[i]];
				}
				board.setStrokes(
					rnd() < 0.5 ? all : all.slice(0, Math.max(1, all.length - 3)),
				);
			} else board.reindexText();
			if (op % 5 === 4) check(`op ${op}`);
		}
		check("final");
		// A huge rect spans more cells than the query limit: the board's own array, uncopied.
		expect(board.queryView(rect(-1e6, -1e6, 2e6, 2e6))).toBe(board.strokes);
	});
});
