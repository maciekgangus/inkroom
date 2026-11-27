import { describe, expect, test } from "vitest";
import { Board, type ElementKind, type Point, type Stroke } from "./board";
import { intersects, strokeBounds } from "./bounds";
import { findHit, findObjectHit, objectHit, strokeHit } from "./hit";
import { isPolygonKind, SHAPES } from "./shapes";
import { cellSpan } from "./spatial-index";
import { fontsChanged, textBox } from "./text";
import { centerOf, rotatePoint } from "./transform";
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

	test("queryPoint catches rotated box-hit corners for image, filled rect, and text", () => {
		const board = new Board();
		// Past SMALL_BOARD (200) at far-away coordinates so only the index path runs.
		for (let i = 0; i < 210; i++) {
			const x = 10000 + i * 20;
			board.addStroke({
				...base(`fill${i}`, i + 1),
				points: [
					[x, 10000, 0.5],
					[x + 5, 10005, 0.5],
				],
			});
		}
		const rotImage: Stroke = {
			...base("rot-img", 300),
			kind: "image",
			src: "img1",
			size: 1,
			rot: Math.PI / 4,
			points: [
				[0, 0, 0.5],
				[100, 100, 0.5],
			],
		};
		const rotRect: Stroke = {
			...base("rot-rect", 301),
			kind: "rect",
			fill: "#fcc",
			size: 2,
			rot: Math.PI / 4,
			points: [
				[1000, 0, 0.5],
				[1100, 100, 0.5],
			],
		};
		const rotText: Stroke = {
			...base("rot-text", 302),
			kind: "text",
			text: "hello",
			fontSize: 16,
			rot: Math.PI / 4,
			points: [[2000, 0, 0.5]],
		};
		board.addStroke(rotImage);
		board.addStroke(rotRect);
		board.addStroke(rotText);

		// Rotated image: local (-9.9, -9.9) is within radius 10 of [0..100, 0..100],
		// sitting 9.9 * sqrt(2) ≈ 14.0 units above strokeBounds.minY.
		const imgY = 50 - 59.9 * Math.SQRT2;
		expect(objectHit(rotImage, 50, imgY, 10)).toBe(true);
		expect(board.queryPoint(50, imgY, 10).map((s) => s.id)).toContain(
			"rot-img",
		);
		expect(
			findObjectHit(board.queryPoint(50, imgY, 10), 50, imgY, 10)?.id,
		).toBe(findObjectHit(board.strokes, 50, imgY, 10)?.id);

		// Rotated filled rect: local (989.1, -10.9) is within reach 10 + size/2 = 11,
		// sitting 8.9 * sqrt(2) ≈ 12.6 units above strokeBounds.minY.
		const rectY = 50 - 60.9 * Math.SQRT2;
		expect(objectHit(rotRect, 1050, rectY, 10)).toBe(true);
		expect(board.queryPoint(1050, rectY, 10).map((s) => s.id)).toContain(
			"rot-rect",
		);
		expect(
			findObjectHit(board.queryPoint(1050, rectY, 10), 1050, rectY, 10)?.id,
		).toBe(findObjectHit(board.strokes, 1050, rectY, 10)?.id);

		// Zoomed-out rotated text (radius = 80 > fontSize = 16): rotated expanded corner sits
		// (79.5 - 16) * sqrt(2) ≈ 89.8 units outside strokeBounds.
		const tb = textBox(rotText);
		const [tx, ty] = rotatePoint(
			[tb.minX - 79.5, tb.minY - 79.5],
			centerOf(rotText),
			rotText.rot ?? 0,
		);
		expect(objectHit(rotText, tx, ty, 80)).toBe(true);
		expect(board.queryPoint(tx, ty, 80).map((s) => s.id)).toContain("rot-text");
		expect(findObjectHit(board.queryPoint(tx, ty, 80), tx, ty, 80)?.id).toBe(
			findObjectHit(board.strokes, tx, ty, 80)?.id,
		);
	});

	test("regular polygon shapes and coordinate planes sit in grid cells instead of large", () => {
		const board = new Board();
		for (let i = 0; i < 210; i++) {
			const x = i * 30;
			board.addStroke({
				...base(`fill${i}`, i + 1),
				points: [
					[x, 0, 0.5],
					[x + 10, 10, 0.5],
				],
			});
		}
		board.addStroke({
			...base("far-tri", 300),
			kind: "triangle",
			points: [
				[20000, 20000, 0.5],
				[20200, 20200, 0.5],
			],
		});
		board.addStroke({
			...base("far-cube", 301),
			kind: "cube",
			points: [
				[20300, 20000, 0.5],
				[20500, 20200, 0.5],
			],
		});
		board.addStroke({
			...base("far-plane", 302),
			kind: "plane",
			points: [
				[20600, 20000, 0.5],
				[21000, 20400, 0.5],
			],
		});

		const nearIds = new Set(board.queryPoint(100, 100, 10).map((s) => s.id));
		expect(nearIds.has("far-tri")).toBe(false);
		expect(nearIds.has("far-cube")).toBe(false);
		expect(nearIds.has("far-plane")).toBe(false);
	});

	test("all polygon/part kinds satisfy queryPoint superset across rotated, filled, and edge-case variants", () => {
		const board = new Board();
		for (let i = 0; i < 210; i++) {
			const x = 50000 + i * 30;
			board.addStroke({
				...base(`fill${i}`, i + 1),
				points: [
					[x, 50000, 0.5],
					[x + 10, 50010, 0.5],
				],
			});
		}
		const kinds: ElementKind[] = [
			...SHAPES.map((s) => s.kind).filter((k) => isPolygonKind(k)),
			"plane",
		];
		let z = 300;
		const placed: {
			stroke: Stroke;
			cx: number;
			cy: number;
			w: number;
			h: number;
		}[] = [];
		let idx = 0;
		for (const kind of kinds) {
			for (const rot of [0, Math.PI / 4]) {
				for (const fill of [undefined, "#ffcc80"]) {
					const x = (idx % 16) * 2000;
					const y = Math.floor(idx / 16) * 2000;
					const w = 120;
					const h = 90;
					const stroke: Stroke = {
						...base(`p-${kind}-${rot ? "r" : "0"}-${fill ? "f" : "u"}`, ++z),
						kind,
						size: 4,
						...(rot ? { rot } : {}),
						...(fill ? { fill } : {}),
						points: [
							[x, y, 0.5],
							[x + w, y + h, 0.5],
						],
					};
					board.addStroke(stroke);
					placed.push({ stroke, cx: x + w / 2, cy: y + h / 2, w, h });
					idx++;
				}
			}
		}
		// Tiny axes (< 4 units) whose arrowheads exceed the points box, plus out-of-unit verts.
		const tinyAxes: Stroke = {
			...base("tiny-axes", ++z),
			kind: "axes",
			size: 2,
			points: [
				[-2000, -2000, 0.5],
				[-1998, -1998, 0.5],
			],
		};
		const outVerts: Stroke = {
			...base("out-verts", ++z),
			kind: "triangle",
			size: 4,
			verts: [
				[-0.5, 0],
				[1.5, 0],
				[0.5, 1.5],
			],
			points: [
				[-4000, -2000, 0.5],
				[-3900, -1900, 0.5],
			],
		};
		board.addStroke(tinyAxes);
		board.addStroke(outVerts);
		placed.push(
			{ stroke: tinyAxes, cx: -1999, cy: -1999, w: 2, h: 2 },
			{ stroke: outVerts, cx: -3950, cy: -1950, w: 100, h: 100 },
		);

		const radius = 12;
		for (const { stroke, cx, cy, w, h } of placed) {
			const probes: [number, number][] = [
				[cx, cy],
				[cx - w / 2, cy - h / 2],
				[cx + w / 2, cy - h / 2],
				[cx - w / 2, cy + h / 2],
				[cx + w / 2, cy + h / 2],
				[cx - w * 0.75, cy - h * 0.75],
				[cx + w * 0.75, cy + h * 0.75],
				[cx, cy - h * 0.75],
				[cx, cy + h * 0.75],
				[cx - w * 0.6, cy],
			];
			for (const [px, py] of probes) {
				const cands = board.queryPoint(px, py, radius);
				if (
					strokeHit(stroke, px, py, radius) ||
					objectHit(stroke, px, py, radius)
				) {
					expect(
						cands.some((s) => s.id === stroke.id),
						`missing ${stroke.id} at (${px}, ${py})`,
					).toBe(true);
				}
				expect(findHit(cands, px, py, radius)?.id ?? null).toBe(
					findHit(board.strokes, px, py, radius)?.id ?? null,
				);
				expect(findObjectHit(cands, px, py, radius)?.id ?? null).toBe(
					findObjectHit(board.strokes, px, py, radius)?.id ?? null,
				);
			}
		}
	});

	test("onChange listeners see updated strokes and spatial index after updateElement (same z and new z)", () => {
		const board = new Board();
		for (let i = 0; i < 210; i++) {
			const x = 10000 + i * 30;
			board.addStroke({
				...base(`fill${i}`, i + 1),
				points: [
					[x, 10000, 0.5],
					[x + 10, 10010, 0.5],
				],
			});
		}
		const target: Stroke = {
			...base("target", 300),
			kind: "rect",
			points: [
				[0, 0, 0.5],
				[50, 50, 0.5],
			],
		};
		board.addStroke(target);

		const observations: {
			inStrokes: boolean;
			inNewRect: boolean;
			inOldRect: boolean;
		}[] = [];
		let expected: Stroke = target;
		let oldBox = rect(0, 0, 50, 50);
		let newBox = rect(0, 0, 50, 50);

		board.onChange(() => {
			observations.push({
				inStrokes: board.strokes.includes(expected),
				inNewRect: board.queryRect(newBox).some((s) => s.id === "target"),
				inOldRect: board.queryRect(oldBox).some((s) => s.id === "target"),
			});
		});

		// Same z: moved from [0..50] to [3000..3050].
		const movedSameZ: Stroke = {
			...target,
			points: [
				[3000, 3000, 0.5],
				[3050, 3050, 0.5],
			],
		};
		expected = movedSameZ;
		oldBox = rect(0, 0, 50, 50);
		newBox = rect(3000, 3000, 50, 50);
		board.updateElement("a", movedSameZ);

		expect(observations).toEqual([
			{ inStrokes: true, inNewRect: true, inOldRect: false },
		]);

		// New z: moved from [3000..3050] to [6000..6050].
		observations.length = 0;
		const movedNewZ: Stroke = {
			...movedSameZ,
			z: 400,
			points: [
				[6000, 6000, 0.5],
				[6050, 6050, 0.5],
			],
		};
		expected = movedNewZ;
		oldBox = rect(3000, 3000, 50, 50);
		newBox = rect(6000, 6000, 50, 50);
		board.updateElement("a", movedNewZ);

		expect(observations).toEqual([
			{ inStrokes: true, inNewRect: true, inOldRect: false },
		]);
	});

	test("cellSpan and queryRect treat inverted rects as empty", () => {
		const invBoth: Rect = { minX: 10000, minY: 10000, maxX: 0, maxY: 0 };
		const invX: Rect = { minX: 50000, minY: 0, maxX: 0, maxY: 50000 };
		expect(cellSpan(invBoth)).toBe(0);
		expect(cellSpan(invX)).toBe(0);

		const board = new Board();
		for (let i = 0; i < 210; i++) {
			board.addStroke({
				...base(`fill${i}`, i + 1),
				points: [
					[i * 30, 0, 0.5],
					[i * 30 + 10, 10, 0.5],
				],
			});
		}
		board.addStroke({
			...base("ell", 300),
			kind: "ellipse",
			points: [
				[100, 100, 0.5],
				[300, 200, 0.5],
			],
		});
		expect(board.queryRect(invBoth)).toEqual([]);
		expect(board.queryRect(invX)).toEqual([]);
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
