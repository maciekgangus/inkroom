// @vitest-environment node
import { describe, expect, test } from "vitest";
import type { Point, Stroke } from "./board";
import { paintElements } from "./canvas-renderer";
import { packedOf, packStroke } from "./points";
import { scaleElBy, translateEl } from "./transform";

/**
 * Packing the points must not change a pixel that matters (R-100). The strokes here have the
 * numbers a real pen gives (many decimals, a pressure from a stylus); one set is drawn as it
 * comes, the other after being packed (the numbers become floats), at three zooms.
 */

type Napi = typeof import("@napi-rs/canvas");
let napi: Napi | null = null;
try {
	napi = await import("@napi-rs/canvas");
} catch {
	napi = null;
}

/** A small seeded generator, so the strokes are the same on every run. */
function rng(seed: number): () => number {
	let a = seed;
	return () => {
		a = (a * 1664525 + 1013904223) % 4294967296;
		return a / 4294967296;
	};
}

function pen(
	id: string,
	seed: number,
	x0: number,
	y0: number,
	n: number,
	extra: Partial<Stroke> = {},
): Stroke {
	const r = rng(seed);
	const points: Point[] = [];
	let x = x0;
	let y = y0;
	let a = r() * 6.28;
	for (let i = 0; i < n; i++) {
		a += (r() - 0.5) * 0.9;
		const step = 1.5 + r() * 3.5;
		x += Math.cos(a) * step;
		y += Math.sin(a) * step;
		points.push([x, y, 0.2 + 0.7 * Math.abs(Math.sin(i / 11 + seed))]);
	}
	return {
		id,
		authorId: "a",
		color: "#1b3a8a",
		size: 3,
		z: seed,
		points,
		...extra,
	};
}

const clone = (s: Stroke): Stroke =>
	({ ...s, points: s.points.map((p) => [...p]) }) as Stroke;

/** The set of strokes: every kind of look that reads the points of a freehand stroke. */
function strokes(): Stroke[] {
	return [
		pen("natural", 1, 40, 60, 220, { dash: "natural", size: 2 }),
		pen("plain", 2, 60, 200, 180),
		pen("dashed", 3, 300, 80, 160, { dash: "dashed" }),
		pen("dotted", 4, 320, 220, 120, { dash: "dotted" }),
		pen("far", 5, 14200.37, 7900.91, 200, { dash: "natural" }),
		pen("turned", 6, 120, 320, 150, { rot: 0.6 }),
		pen("thin", 7, 220, 330, 90, { size: 0.5, opacity: 0.6 }),
	];
}

/** The most a colour channel may differ, in levels of 255 (measured: 3). */
const TOLERANCE = 8;

interface Look {
	label: string;
	scale: number;
	view: { minX: number; minY: number; maxX: number; maxY: number };
}

const NEAR = { minX: 0, minY: 0, maxX: 420, maxY: 400 };
const FAR = { minX: 14150, minY: 7850, maxX: 14570, maxY: 8250 };
const looks: Look[] = [
	{ label: "zoom 0.1", scale: 0.1, view: { ...NEAR, maxX: 4200, maxY: 4000 } },
	{ label: "zoom 1", scale: 1, view: NEAR },
	{ label: "zoom 4", scale: 4, view: { ...NEAR, maxX: 210, maxY: 200 } },
	{ label: "zoom 1 far", scale: 1, view: FAR },
];

function paint(set: Stroke[], look: Look): Uint8ClampedArray {
	if (!napi) throw new Error("no canvas");
	(globalThis as { Path2D?: unknown }).Path2D = napi.Path2D;
	const w = Math.round((look.view.maxX - look.view.minX) * look.scale);
	const h = Math.round((look.view.maxY - look.view.minY) * look.scale);
	const canvas = napi.createCanvas(w, h);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, w, h);
	ctx.setTransform(
		look.scale,
		0,
		0,
		look.scale,
		-look.view.minX * look.scale,
		-look.view.minY * look.scale,
	);
	paintElements(
		ctx as unknown as CanvasRenderingContext2D,
		set,
		look.view,
		null,
	);
	return ctx.getImageData(0, 0, w, h).data as unknown as Uint8ClampedArray;
}

/** How many pixels differ by more than `tolerance` levels in some channel, and the largest difference. */
function diff(
	a: Uint8ClampedArray,
	b: Uint8ClampedArray,
	tolerance: number,
): { pixels: number; max: number; ink: number } {
	let pixels = 0;
	let max = 0;
	let ink = 0;
	for (let i = 0; i < a.length; i += 4) {
		let d = 0;
		for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]));
		if (d > tolerance) pixels++;
		if (d > max) max = d;
		if (a[i] < 250 || a[i + 1] < 250 || a[i + 2] < 250) ink++;
	}
	return { pixels, max, ink };
}

describe.skipIf(!napi)("packed points draw the same pixels (R-100)", () => {
	for (const look of looks) {
		test(`${look.label}: no pixel differs by more than a few levels`, () => {
			const plain = strokes();
			const packed = strokes();
			for (const s of packed) expect(packStroke(s)).toBe(true);
			const d = diff(paint(plain, look), paint(packed, look), TOLERANCE);
			expect(d.ink).toBeGreaterThan(50); // the strokes are really in the picture
			// A float is not the double it was made of, so an edge pixel may take another shade of
			// grey (measured: at most 3 levels of 255); nothing may change by more.
			expect(d.pixels).toBe(0);
		});
	}

	test("a moved and scaled selection, packed again after each step, matches the plain one", () => {
		const look = looks[1];
		const base = strokes();
		const transform = (s: Stroke): Stroke =>
			scaleElBy(translateEl(s, 17.37, -9.11), [100, 100], 1.3, 0.8, 0.4);
		const plain = base.map((s) => transform(clone(s)));
		const packed = base.map((s) => {
			const c = clone(s);
			packStroke(c);
			const t = transform(c);
			packStroke(t);
			return t;
		});
		expect(packed.every((s) => !!packedOf(s))).toBe(true);
		const d = diff(paint(plain, look), paint(packed, look), TOLERANCE);
		// Two float roundings (before and after the move) can tip the outline of the pen at a very
		// sharp turn of these deliberately jagged strokes: a pixel or two (measured: one pixel,
		// 23 levels), never a visible change.
		expect(d.pixels).toBeLessThanOrEqual(3);
		expect(d.max).toBeLessThanOrEqual(40);
	});
});
