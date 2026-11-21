import type { Point, Stroke } from "./board";

/**
 * The points of a freehand stroke kept in one Float32Array (R-100), about a fifth of the memory
 * of an array of `[x, y, pressure]` arrays (a point of the arrays costs ~54 bytes, a packed one 12).
 *
 * Layout: `[ox, oy, dx0, dy0, p0, dx1, dy1, p1, ...]`. The origin `(ox, oy)` is the first point
 * rounded to a float; the other points are stored relative to it, so a stroke far from the origin of
 * the board keeps its precision (a float has 24 bits of it: 0.001 units up to 16000 units away from
 * the first point). The wire format and the database are untouched: a packed stroke still says
 * `points: [[x, y, p], ...]` to `JSON.stringify` and to every reader of `stroke.points`.
 *
 * The packing is in place. The element keeps its identity (the board, the selection and the history
 * hold the same object), its `points` becomes an accessor that unpacks on demand, and the packed
 * array lives under a symbol that is not enumerable, so `{ ...element }` copies the unpacked
 * points and none of the packed state: a copy is a plain element again until the board takes it.
 *
 * Unpacking gives the floats back as they are, not rounded: a stroke is then drawn like the
 * original to within three levels of a colour channel at its edges (rounding to 0.01 units was
 * tried and moved edges by up to a seventh of a pixel, because the pen's outline is sensitive to
 * its input). Packing again gives the same floats, so a stroke that is moved and packed over and
 * over does not drift. Both ends of a connection pack what they get, so a stroke is the same
 * everywhere.
 *
 * Hot code reads through `pointCount`, `packedOf` and `forEachPoint` and never unpacks.
 */

const PACKED = Symbol("packedPoints");

type WithPacked = Stroke & { [PACKED]?: Float32Array };

/** A stroke shorter than this stays an array: a tap, a dot or a shape is not worth the bookkeeping. */
export const MIN_PACKED_POINTS = 8;

const HEADER = 2;
const STRIDE = 3;

/** The packed array of a stroke, or undefined for one that holds its points as an array. */
export function packedOf(s: Stroke): Float32Array | undefined {
	return (s as WithPacked)[PACKED];
}

/** How many points a stroke has, without unpacking it. */
export function pointCount(s: Stroke): number {
	const a = packedOf(s);
	return a ? (a.length - HEADER) / STRIDE : s.points.length;
}

/** x of point `i` of a packed array. */
export const packedX = (a: Float32Array, i: number): number =>
	a[0] + a[HEADER + STRIDE * i];

/** y of point `i` of a packed array. */
export const packedY = (a: Float32Array, i: number): number =>
	a[1] + a[HEADER + STRIDE * i + 1];

/** Pressure of point `i` of a packed array. */
export const packedP = (a: Float32Array, i: number): number =>
	a[HEADER + STRIDE * i + 2];

/** Calls `f(x, y, pressure)` for every point of a stroke, packed or not, allocating nothing. */
export function forEachPoint(
	s: Stroke,
	f: (x: number, y: number, p: number) => void,
): void {
	const a = packedOf(s);
	if (!a) {
		for (const p of s.points) f(p[0], p[1], p[2]);
		return;
	}
	const n = (a.length - HEADER) / STRIDE;
	for (let i = 0; i < n; i++) f(packedX(a, i), packedY(a, i), packedP(a, i));
}

/** The points as arrays of numbers. */
function unpack(a: Float32Array): Point[] {
	const n = (a.length - HEADER) / STRIDE;
	const out = new Array<Point>(n);
	for (let i = 0; i < n; i++)
		out[i] = [packedX(a, i), packedY(a, i), packedP(a, i)];
	return out;
}

// The last unpacking is kept: code that reads `stroke.points` several times in a row (an index in
// a loop, `.length` and then an item) gets the same array and does not unpack each time.
let lastPacked: Float32Array | null = null;
let lastPoints: Point[] = [];

function getPoints(this: WithPacked): Point[] {
	const a = this[PACKED];
	if (!a) return [];
	if (a === lastPacked) return lastPoints;
	lastPoints = unpack(a);
	lastPacked = a;
	return lastPoints;
}

/** Writing `points` of a packed stroke turns it back into a plain one. */
function setPoints(this: WithPacked, value: Point[]): void {
	delete this[PACKED];
	Object.defineProperty(this, "points", {
		value,
		writable: true,
		enumerable: true,
		configurable: true,
	});
}

/**
 * Packs the points of a freehand stroke with enough points, in place. Anything else (a shape, a
 * text, an image, a short stroke, a stroke already packed, one with a point that is not a number)
 * is left as it is. Returns whether the stroke is packed afterwards.
 */
export function packStroke(s: Stroke): boolean {
	if (packedOf(s)) return true;
	if (s.kind && s.kind !== "stroke") return false;
	const pts = s.points;
	const n = pts.length;
	if (n < MIN_PACKED_POINTS) return false;
	const a = new Float32Array(HEADER + STRIDE * n);
	const ox = Math.fround(pts[0][0]);
	const oy = Math.fround(pts[0][1]);
	a[0] = ox;
	a[1] = oy;
	let sum = 0;
	for (let i = 0; i < n; i++) {
		const p = pts[i];
		const k = HEADER + STRIDE * i;
		a[k] = p[0] - ox;
		a[k + 1] = p[1] - oy;
		a[k + 2] = p[2];
		sum += a[k] + a[k + 1] + a[k + 2];
	}
	if (!Number.isFinite(sum)) return false;
	try {
		Object.defineProperty(s, PACKED, {
			value: a,
			writable: true,
			enumerable: false,
			configurable: true,
		});
		Object.defineProperty(s, "points", {
			get: getPoints,
			set: setPoints,
			enumerable: true,
			configurable: true,
		});
	} catch {
		// a frozen object: it stays as it is
		return false;
	}
	return true;
}
