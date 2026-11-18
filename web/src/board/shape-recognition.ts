import type { Point } from "./board";

type Vec = [number, number];

/** A shape a hand-drawn stroke was recognised as (R-095), in the fields of a board element. */
export interface Recognized {
	kind: "line" | "ellipse" | "rect" | "triangle";
	/** A line: its ends; the others: two opposite corners of the (unrotated) box. */
	points: [Point, Point];
	/** Rotation around the centre of the box, for a tilted rectangle or ellipse. */
	rot?: number;
	/** A triangle: its three vertices as fractions of the box (R-047). */
	verts?: [number, number][];
}

/** Strokes smaller than this (board units, box diagonal) are handwriting, not a shape. */
const MIN_DIAG = 80;
/** The angle step a line snaps to (as with Shift, R-024) and how near it must be to snap. */
const ANGLE_STEP = Math.PI / 12;
const LINE_SNAP = (5 * Math.PI) / 180;
/** A box this close to square (the shorter side within this share of the longer) becomes square. */
const SQUARE_SHARE = 0.12;
/** A rectangle or ellipse this close to the axes is made straight. */
const AXIS_SNAP = (8 * Math.PI) / 180;
/** Points kept for the fits: more adds nothing, fewer keeps the cost small. */
const SAMPLES = 64;

const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** `n` points evenly spaced along the polyline (by length). */
function resample(pts: Vec[], n: number, length: number): Vec[] {
	const out: Vec[] = [];
	const step = length / (n - 1);
	let next = 0;
	let walked = 0;
	for (let i = 1; i < pts.length && out.length < n; i++) {
		const seg = dist(pts[i - 1], pts[i]);
		while (out.length < n && walked + seg >= next - 1e-9) {
			const t = seg === 0 ? 0 : (next - walked) / seg;
			out.push([
				pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
				pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
			]);
			next += step;
		}
		walked += seg;
	}
	while (out.length < n) out.push(pts[pts.length - 1]);
	return out;
}

/** The corners of the stroke by Douglas-Peucker, the first and last point included. */
function simplify(pts: Vec[], eps: number): Vec[] {
	const keep = new Uint8Array(pts.length);
	keep[0] = keep[pts.length - 1] = 1;
	const stack: [number, number][] = [[0, pts.length - 1]];
	while (stack.length) {
		const [lo, hi] = stack.pop() as [number, number];
		const [ax, ay] = pts[lo];
		const [bx, by] = pts[hi];
		const len = Math.hypot(bx - ax, by - ay) || 1;
		let far = -1;
		let farD = eps;
		for (let i = lo + 1; i < hi; i++) {
			const d =
				Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) /
				len;
			const dd =
				len === 1 && ax === bx && ay === by ? dist(pts[i], pts[lo]) : d;
			if (dd > farD) {
				farD = dd;
				far = i;
			}
		}
		if (far >= 0) {
			keep[far] = 1;
			stack.push([lo, far], [far, hi]);
		}
	}
	return pts.filter((_, i) => keep[i]);
}

/** Distance from `p` to the closed polygon `poly`. */
function toOutline(p: Vec, poly: Vec[]): number {
	let best = Infinity;
	for (let i = 0; i < poly.length; i++) {
		const a = poly[i];
		const b = poly[(i + 1) % poly.length];
		const dx = b[0] - a[0];
		const dy = b[1] - a[1];
		const len2 = dx * dx + dy * dy || 1;
		const t = Math.max(
			0,
			Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2),
		);
		best = Math.min(
			best,
			Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy),
		);
	}
	return best;
}

/** The angle of the main axis of the points (radians, -pi/2 to pi/2). */
function principalAngle(pts: Vec[]): number {
	let mx = 0;
	let my = 0;
	for (const [x, y] of pts) {
		mx += x;
		my += y;
	}
	mx /= pts.length;
	my /= pts.length;
	let sxx = 0;
	let syy = 0;
	let sxy = 0;
	for (const [x, y] of pts) {
		sxx += (x - mx) ** 2;
		syy += (y - my) ** 2;
		sxy += (x - mx) * (y - my);
	}
	return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

/** The box of `pts` in a frame turned by `rot`: its centre in the board and its two half sides. */
function boxIn(pts: Vec[], rot: number) {
	const c = Math.cos(rot);
	const s = Math.sin(rot);
	let minU = Infinity;
	let maxU = -Infinity;
	let minV = Infinity;
	let maxV = -Infinity;
	for (const [x, y] of pts) {
		const u = x * c + y * s;
		const v = -x * s + y * c;
		minU = Math.min(minU, u);
		maxU = Math.max(maxU, u);
		minV = Math.min(minV, v);
		maxV = Math.max(maxV, v);
	}
	const cu = (minU + maxU) / 2;
	const cv = (minV + maxV) / 2;
	return {
		cx: cu * c - cv * s,
		cy: cu * s + cv * c,
		a: (maxU - minU) / 2,
		b: (maxV - minV) / 2,
	};
}

const corners = (
	cx: number,
	cy: number,
	a: number,
	b: number,
): [Point, Point] => [
	[cx - a, cy - b, 0.5],
	[cx + a, cy + b, 0.5],
];

/**
 * A box from a fit: a tilt within a few degrees of an axis is made straight, a tilt past 45
 * degrees is the same box a quarter turn the other way, and nearly equal sides become equal.
 */
function boxShape(
	pts: Vec[],
	rot: number,
): { cx: number; cy: number; a: number; b: number; rot: number } {
	const quarter = Math.PI / 2;
	let angle = rot - Math.round(rot / quarter) * quarter;
	if (Math.abs(angle) <= AXIS_SNAP) angle = 0;
	const { cx, cy, a, b } = boxIn(pts, angle);
	const side =
		Math.min(a, b) >= (1 - SQUARE_SHARE) * Math.max(a, b) ? (a + b) / 2 : 0;
	return { cx, cy, a: side || a, b: side || b, rot: angle };
}

/** How far the points are, on average and at most, from an ellipse of a box (0 = on it). */
function ellipseError(
	pts: Vec[],
	box: { cx: number; cy: number; a: number; b: number; rot: number },
) {
	const c = Math.cos(box.rot);
	const s = Math.sin(box.rot);
	let sum = 0;
	let max = 0;
	for (const [x, y] of pts) {
		const dx = x - box.cx;
		const dy = y - box.cy;
		const u = (dx * c + dy * s) / box.a;
		const v = (-dx * s + dy * c) / box.b;
		const e = Math.abs(Math.hypot(u, v) - 1);
		sum += e;
		max = Math.max(max, e);
	}
	return { mean: sum / pts.length, max };
}

/** The angle between two directions, 0 to pi. */
function turn(a: Vec, b: Vec, c: Vec): number {
	const x1 = b[0] - a[0];
	const y1 = b[1] - a[1];
	const x2 = c[0] - b[0];
	const y2 = c[1] - b[1];
	const d = Math.atan2(x1 * y2 - y1 * x2, x1 * x2 + y1 * y2);
	return Math.abs(d);
}

/**
 * Recognises a hand-drawn stroke as a line, ellipse (circle), rectangle (square) or triangle
 * (R-095), or returns null when nothing fits well enough (the stroke then stays as drawn). Cost is
 * linear in the number of points and runs once, when the pen is held still.
 */
export function recognizeShape(points: Point[]): Recognized | null {
	if (points.length < 6) return null;
	// Long strokes are thinned first: the fits need no more than every few points.
	const stride = Math.ceil(points.length / 800);
	const raw: Vec[] = [];
	for (let i = 0; i < points.length; i += stride)
		raw.push([points[i][0], points[i][1]]);
	const last = points[points.length - 1];
	raw.push([last[0], last[1]]);

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let length = 0;
	for (let i = 0; i < raw.length; i++) {
		const [x, y] = raw[i];
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
		if (i) length += dist(raw[i - 1], raw[i]);
	}
	const diag = Math.hypot(maxX - minX, maxY - minY);
	if (diag < MIN_DIAG || length === 0) return null;

	const ends = dist(raw[0], raw[raw.length - 1]);
	const closed = ends <= 0.4 * diag && length >= 1.5 * diag;
	const sample = resample(raw, SAMPLES, length);

	if (!closed) return recognizeLine(raw, sample, length, ends);

	// An ellipse is tried first: a smooth outline fits it, a corner does not.
	const theta = principalAngle(sample);
	const ellipse = boxShape(sample, theta);
	const ellErr = ellipseError(sample, ellipse);
	const round =
		ellipse.a > 0.1 * diag &&
		ellipse.b > 0.1 * diag &&
		ellErr.mean <= 0.11 &&
		ellErr.max <= 0.34;

	const poly = polygon(raw, diag);
	if (poly) {
		const err = polyError(sample, poly.vertices);
		if (err.mean <= 0.055 * diag && err.max <= 0.15 * diag) {
			// Corners that fit as well as a round line would are the safer reading.
			if (!round || err.mean < ellErr.mean * diag * 0.5)
				return poly.shape(sample);
		}
	}
	if (round) {
		return {
			kind: "ellipse",
			points: corners(ellipse.cx, ellipse.cy, ellipse.a, ellipse.b),
			...(ellipse.rot ? { rot: ellipse.rot } : {}),
		};
	}
	return null;
}

function recognizeLine(
	raw: Vec[],
	sample: Vec[],
	length: number,
	ends: number,
): Recognized | null {
	if (ends < 0.7 * length) return null; // curved, a loop or a scribble
	// Measured from the chord through both ends, which is what the line becomes.
	const chord = dist(raw[0], raw[raw.length - 1]);
	const dx = raw[raw.length - 1][0] - raw[0][0];
	const dy = raw[raw.length - 1][1] - raw[0][1];
	let worst = 0;
	let sumSq = 0;
	for (const [x, y] of sample) {
		const d = Math.abs(dx * (raw[0][1] - y) - (raw[0][0] - x) * dy) / chord;
		worst = Math.max(worst, d);
		sumSq += d * d;
	}
	if (Math.sqrt(sumSq / sample.length) > 0.045 * chord || worst > 0.1 * chord)
		return null;
	let theta = Math.atan2(dy, dx);
	const snapped = Math.round(theta / ANGLE_STEP) * ANGLE_STEP;
	if (Math.abs(theta - snapped) <= LINE_SNAP) theta = snapped;
	const a: Vec = raw[0];
	return {
		kind: "line",
		points: [
			[a[0], a[1], 0.5],
			[a[0] + chord * Math.cos(theta), a[1] + chord * Math.sin(theta), 0.5],
		],
	};
}

/** The corners of a closed stroke, with what to turn them into. */
function polygon(raw: Vec[], diag: number) {
	const simple = simplify(raw, 0.07 * diag);
	let v = simple.slice(0, -1); // the last point is where the stroke meets its start
	if (v.length < 3) return null;
	// Where the stroke starts and ends is a corner only if the line turns there.
	for (let pass = 0; pass < 2; pass++) {
		for (let i = 0; i < v.length && v.length > 3; i++) {
			const t = turn(
				v[(i + v.length - 1) % v.length],
				v[i],
				v[(i + 1) % v.length],
			);
			if (t < (30 * Math.PI) / 180) {
				v = v.filter((_, k) => k !== i);
				i--;
			}
		}
	}
	if (v.length === 3) {
		const [bx0, by0, bx1, by1] = bounds(v);
		if (bx1 - bx0 < 0.1 * diag || by1 - by0 < 0.1 * diag) return null;
		return {
			vertices: v,
			shape: (): Recognized => ({
				kind: "triangle",
				points: [
					[bx0, by0, 0.5],
					[bx1, by1, 0.5],
				],
				verts: v.map(([x, y]): [number, number] => [
					(x - bx0) / (bx1 - bx0),
					(y - by0) / (by1 - by0),
				]),
			}),
		};
	}
	if (v.length === 4) {
		for (let i = 0; i < 4; i++) {
			const t = turn(v[(i + 3) % 4], v[i], v[(i + 1) % 4]);
			if (Math.abs(t - Math.PI / 2) > (36 * Math.PI) / 180) return null;
		}
		// The mean direction of the four sides, modulo a quarter turn.
		let sx = 0;
		let sy = 0;
		for (let i = 0; i < 4; i++) {
			const a = v[i];
			const b = v[(i + 1) % 4];
			const phi = Math.atan2(b[1] - a[1], b[0] - a[0]);
			sx += Math.cos(4 * phi);
			sy += Math.sin(4 * phi);
		}
		const rot = Math.atan2(sy, sx) / 4;
		return {
			vertices: v,
			shape: (sample: Vec[]): Recognized => {
				const box = boxShape(sample, rot);
				return {
					kind: "rect",
					points: corners(box.cx, box.cy, box.a, box.b),
					...(box.rot ? { rot: box.rot } : {}),
				};
			},
		};
	}
	return null;
}

function bounds(v: Vec[]): [number, number, number, number] {
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const [x, y] of v) {
		x0 = Math.min(x0, x);
		y0 = Math.min(y0, y);
		x1 = Math.max(x1, x);
		y1 = Math.max(y1, y);
	}
	return [x0, y0, x1, y1];
}

function polyError(sample: Vec[], poly: Vec[]) {
	let sum = 0;
	let max = 0;
	for (const p of sample) {
		const d = toOutline(p, poly);
		sum += d;
		max = Math.max(max, d);
	}
	return { mean: sum / sample.length, max };
}
