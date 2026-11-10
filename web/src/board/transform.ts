import type { Point, Stroke } from "./board";
import { fontSizeOf, textBox } from "./text";
import type { Rect } from "./viewport";

type Vec = [number, number];

/**
 * The box around an element's geometry before its rotation, with no padding. Rotation
 * (`rot`) turns the element around the centre of this box (ADR 0008).
 */
export function geomBox(el: Stroke): Rect {
	if (el.kind === "text") return textBox(el);
	if (el.kind === "circle") {
		const [c, e] = el.points;
		const r = Math.hypot(e[0] - c[0], e[1] - c[1]);
		return { minX: c[0] - r, minY: c[1] - r, maxX: c[0] + r, maxY: c[1] + r };
	}
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const [x, y] of el.points) {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}
	return { minX, minY, maxX, maxY };
}

/** The point an element rotates around. */
export function centerOf(el: Stroke): Vec {
	const b = geomBox(el);
	return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

export function rotatePoint(p: Vec, around: Vec, angle: number): Vec {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const dx = p[0] - around[0];
	const dy = p[1] - around[1];
	return [around[0] + dx * cos - dy * sin, around[1] + dx * sin + dy * cos];
}

/** A board point seen in the element's own frame, as if it were not rotated. */
export function toLocal(el: Stroke, p: Vec): Vec {
	return el.rot ? rotatePoint(p, centerOf(el), -el.rot) : p;
}

/** The corners of the element's box on the board (rotation applied): nw, ne, se, sw. */
export function elementCorners(el: Stroke): [Vec, Vec, Vec, Vec] {
	const b = geomBox(el);
	const c = centerOf(el);
	const corners: [Vec, Vec, Vec, Vec] = [
		[b.minX, b.minY],
		[b.maxX, b.minY],
		[b.maxX, b.maxY],
		[b.minX, b.maxY],
	];
	return el.rot
		? (corners.map((p) => rotatePoint(p, c, el.rot as number)) as [
				Vec,
				Vec,
				Vec,
				Vec,
			])
		: corners;
}

/** The axis-aligned box around the element as it appears on the board. */
export function worldBounds(el: Stroke): Rect {
	const xs = elementCorners(el).map((p) => p[0]);
	const ys = elementCorners(el).map((p) => p[1]);
	return {
		minX: Math.min(...xs),
		minY: Math.min(...ys),
		maxX: Math.max(...xs),
		maxY: Math.max(...ys),
	};
}

const mapPoints = (el: Stroke, f: (p: Point) => Point): Stroke => ({
	...el,
	points: el.points.map(f),
});

/** Where a line's two ends are on the board, its turn applied (R-041). */
export function lineEnds(el: Stroke): [Vec, Vec] {
	const c = centerOf(el);
	const [a, b] = el.points;
	return [
		rotatePoint([a[0], a[1]], c, el.rot ?? 0),
		rotatePoint([b[0], b[1]], c, el.rot ?? 0),
	];
}

/** The element with its turn moved into its points, so it has none (for editing a line's ends). */
export function bakeRotation(el: Stroke): Stroke {
	if (!el.rot) return el;
	const c = centerOf(el);
	const { rot, ...rest } = el;
	return {
		...rest,
		points: el.points.map((p) => {
			const [x, y] = rotatePoint([p[0], p[1]], c, rot);
			return [x, y, p[2]] as Point;
		}),
	};
}

/** The element moved by (dx, dy). */
export function translateEl(el: Stroke, dx: number, dy: number): Stroke {
	return mapPoints(el, (p) => [p[0] + dx, p[1] + dy, p[2]]);
}

/** The element scaled uniformly by `k` about a board point. */
export function scaleEl(el: Stroke, anchor: Vec, k: number): Stroke {
	return scaleElBy(el, anchor, k, k, 0);
}

/**
 * The element scaled about a board point by `kx` and `ky` along the axes of a frame turned by
 * `angle`, so a corner handle can stretch width and height independently. Line width stays.
 * The element's centre moves like every other point; its geometry scales in its own axes,
 * which line up with the frame's (or swap with them at a quarter turn). A circle, a text and
 * an element turned in between cannot be sheared, so they grow evenly by the geometric mean.
 */
export function scaleElBy(
	el: Stroke,
	anchor: Vec,
	kx: number,
	ky: number,
	angle: number,
): Stroke {
	const c = centerOf(el);
	let nc: Vec;
	let lx: number;
	let ly: number;
	if (kx === ky) {
		nc = [
			anchor[0] + kx * (c[0] - anchor[0]),
			anchor[1] + kx * (c[1] - anchor[1]),
		];
		lx = kx;
		ly = ky;
	} else {
		const v = rotatePoint(c, anchor, -angle);
		nc = rotatePoint(
			[
				anchor[0] + kx * (v[0] - anchor[0]),
				anchor[1] + ky * (v[1] - anchor[1]),
			],
			anchor,
			angle,
		);
		const rel = Math.abs(wrapAngle((el.rot ?? 0) - angle));
		const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
		const even = Math.sqrt(kx * ky);
		if (el.kind === "circle" || el.kind === "text") {
			lx = ly = even;
		} else if (near(rel, 0) || near(rel, Math.PI)) {
			[lx, ly] = [kx, ky];
		} else if (near(rel, Math.PI / 2)) {
			[lx, ly] = [ky, kx];
		} else {
			lx = ly = even;
		}
	}
	const scaled = mapPoints(el, (p) => [
		nc[0] + lx * (p[0] - c[0]),
		nc[1] + ly * (p[1] - c[1]),
		p[2],
	]);
	return el.kind === "text"
		? { ...scaled, fontSize: fontSizeOf(el) * Math.sqrt(lx * ly) }
		: scaled;
}

function wrapAngle(a: number): number {
	const turn = 2 * Math.PI;
	return ((((a + Math.PI) % turn) + turn) % turn) - Math.PI;
}

/** The element turned by `delta` radians around a board point (its own centre for a lone element). */
export function rotateEl(el: Stroke, pivot: Vec, delta: number): Stroke {
	const c = centerOf(el);
	const nc = rotatePoint(c, pivot, delta);
	const moved = translateEl(el, nc[0] - c[0], nc[1] - c[1]);
	return { ...moved, rot: wrapAngle((el.rot ?? 0) + delta) };
}

/** Rounds an angle to the nearest multiple of `step`. */
export function snapAngle(angle: number, step: number): number {
	return Math.round(angle / step) * step;
}

/** Pulls an angle onto the nearest right angle if it is within `tolerance`, else leaves it. */
export function softSnapAngle(angle: number, tolerance: number): number {
	const quarter = Math.PI / 2;
	const nearest = Math.round(angle / quarter) * quarter;
	return Math.abs(angle - nearest) <= tolerance ? nearest : angle;
}
