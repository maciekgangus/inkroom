import type { ElementKind, Stroke } from "./board";
import { clamp } from "./clamp";
import { isPolygonKind, polygonPoints } from "./shapes";

type Vec = [number, number];

/**
 * A shape as lines (R-039): `lines` are drawn solid, `hidden` are the edges of a solid that sit
 * behind it (drawn dotted), `fill` is the outer contour used to fill the shape and to hit its
 * inside (empty for curves and the coordinate system, which have no inside).
 */
export interface ShapeParts {
	lines: Vec[][];
	hidden: Vec[][];
	fill: Vec[];
	/** Lines drawn much thinner than the rest (the marks of a coordinate system). */
	fine?: Vec[][];
	/** Numbers written beside the marks, centred on the given point. */
	labels?: { text: string; x: number; y: number }[];
	/** The lines of a coordinate plane's cells, very light (R-084). */
	grid?: Vec[][];
	/** Every second line of the plane's cells, a little stronger. */
	cluster?: Vec[][];
	/** The sheet, the arrow heads and the text of a coordinate plane (R-084). */
	plane?: PlaneLook;
}

/** What a coordinate plane is made of (R-084); each has a default when the element has none. */
export interface PlaneOptions {
	cell: number;
	grid: boolean;
	axes: boolean;
	/** The width of the axes, from which the heads and the gaps to the numbers follow. */
	axisWidth: number;
	/** The x axis is in multiples of π, its cells a twelfth of π (R-084). */
	pi?: boolean;
}

/** The size of a cell of a coordinate plane, in board units. */
export const PLANE_CELL = 40;
/** The least side of a new coordinate plane, so that a graph on it makes sense (R-084). */
export const PLANE_MIN_SIDE = 240;
/** The side of the plane a click gives. */
export const PLANE_DEFAULT_SIDE = 480;

/** Distance (board units) between the marks of the coordinate system's axes (R-040). */
export const AXES_STEP = 24;

/** The height of the numbers on the marks of the axes, in board units. */
export const LABEL_PX = 11;

interface Box {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	w: number;
	h: number;
	cx: number;
	cy: number;
}

const closed = (pts: Vec[]): Vec[] => [...pts, pts[0]];

/** Points of an ellipse arc from angle t0 to t1 (radians, y down), n steps. */
function arc(
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	t0: number,
	t1: number,
	n = 48,
): Vec[] {
	return Array.from({ length: n + 1 }, (_, i) => {
		const t = t0 + ((t1 - t0) * i) / n;
		return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as Vec;
	});
}

/** The corners of a regular polygon with its first corner at angle `start` (a unit circle). */
function regular(n: number, start: number): Vec[] {
	return Array.from({ length: n }, (_, k) => {
		const t = start + (2 * Math.PI * k) / n;
		return [Math.cos(t), Math.sin(t)] as Vec;
	});
}

/** A star: corners alternate between the outer and the inner radius. */
function star(points: number, inner: number): Vec[] {
	return Array.from({ length: points * 2 }, (_, k) => {
		const t = -Math.PI / 2 + (Math.PI * k) / points;
		const r = k % 2 === 0 ? 1 : inner;
		return [r * Math.cos(t), r * Math.sin(t)] as Vec;
	});
}

/** The convex hull of some points (the silhouette of a solid). */
function hull(points: Vec[]): Vec[] {
	const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const cross = (o: Vec, a: Vec, b: Vec) =>
		(a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const build = (list: Vec[]) => {
		const out: Vec[] = [];
		for (const p of list) {
			while (
				out.length >= 2 &&
				cross(out[out.length - 2], out[out.length - 1], p) <= 0
			)
				out.pop();
			out.push(p);
		}
		out.pop();
		return out;
	};
	return [...build(pts), ...build([...pts].reverse())];
}

const map = (parts: ShapeParts, f: (p: Vec) => Vec): ShapeParts => ({
	lines: parts.lines.map((l) => l.map(f)),
	hidden: parts.hidden.map((l) => l.map(f)),
	fill: parts.fill.map(f),
});

/** Stretches the parts so that they fill the box exactly, whatever coordinates they were made in. */
function fitted(parts: ShapeParts, b: Box): ShapeParts {
	const all = [...parts.lines, ...parts.hidden].flat();
	const xs = all.map((p) => p[0]);
	const ys = all.map((p) => p[1]);
	const [minX, maxX, minY, maxY] = [
		Math.min(...xs),
		Math.max(...xs),
		Math.min(...ys),
		Math.max(...ys),
	];
	const sx = maxX - minX > 1e-9 ? b.w / (maxX - minX) : 0;
	const sy = maxY - minY > 1e-9 ? b.h / (maxY - minY) : 0;
	return map(parts, ([x, y]) => [
		sx ? b.x0 + (x - minX) * sx : b.cx,
		sy ? b.y0 + (y - minY) * sy : b.cy,
	]);
}

const solid = (...lines: Vec[][]): ShapeParts => ({
	lines,
	hidden: [],
	fill: [],
});

/** A box seen from the front and a little above and to the right (cube, cuboid, parallelepiped). */
function obliqueBox(
	bl: Vec,
	u: Vec,
	v: Vec,
	depth: Vec,
	hidden: boolean,
): ShapeParts {
	const add = (p: Vec, q: Vec): Vec => [p[0] + q[0], p[1] + q[1]];
	const f00 = bl;
	const f10 = add(bl, u);
	const f11 = add(f10, v);
	const f01 = add(bl, v);
	const g = (p: Vec) => add(p, depth);
	return {
		lines: [
			closed([f00, f10, f11, f01]),
			closed([f01, f11, g(f11), g(f01)]),
			closed([f10, g(f10), g(f11), f11]),
		],
		hidden: hidden
			? [
					[g(f00), g(f01)],
					[g(f00), g(f10)],
					[f00, g(f00)],
				]
			: [],
		fill: hull([f00, f10, g(f10), g(f11), g(f01), f01]),
	};
}

/** The generators, each in coordinates of its own that `fitted` then stretches over the box. */
const FIT: Partial<Record<ElementKind, (adj: number) => ShapeParts>> = {
	triangle: (adj) => {
		const p: Vec[] = [
			[adj * 100, 0],
			[100, 100],
			[0, 100],
		];
		return { lines: [closed(p)], hidden: [], fill: p };
	},
	righttriangle: () => {
		const p: Vec[] = [
			[0, 0],
			[100, 100],
			[0, 100],
		];
		return { lines: [closed(p)], hidden: [], fill: p };
	},
	righttrapezoid: (adj) => {
		const p: Vec[] = [
			[0, 0],
			[(1 - adj) * 100, 0],
			[100, 100],
			[0, 100],
		];
		return { lines: [closed(p)], hidden: [], fill: p };
	},
	pentagon: () => {
		const p = regular(5, -Math.PI / 2);
		return { lines: [closed(p)], hidden: [], fill: p };
	},
	hexagon: () => {
		const p = regular(6, 0);
		return { lines: [closed(p)], hidden: [], fill: p };
	},
	octagon: () => {
		const p = regular(8, Math.PI / 8);
		return { lines: [closed(p)], hidden: [], fill: p };
	},
	star: () => {
		const p = star(5, 0.382);
		return { lines: [closed(p)], hidden: [], fill: p };
	},
	cube: () => obliqueBox([0, 100], [70, 0], [0, -70], [30, -30], false),
	cuboid: () => obliqueBox([0, 100], [70, 0], [0, -70], [30, -30], true),
	parallelepiped: () =>
		obliqueBox([0, 100], [60, 0], [18, -60], [22, -22], true),
	cylinder: () => {
		const top = arc(50, 14, 50, 14, 0, 2 * Math.PI);
		const bottomFront = arc(50, 86, 50, 14, 0, Math.PI);
		const bottomBack = arc(50, 86, 50, 14, Math.PI, 2 * Math.PI);
		return {
			lines: [
				top,
				[
					[0, 14],
					[0, 86],
				],
				[
					[100, 14],
					[100, 86],
				],
				bottomFront,
			],
			hidden: [bottomBack],
			fill: [...arc(50, 14, 50, 14, Math.PI, 2 * Math.PI), ...bottomFront],
		};
	},
	cone: () => {
		const front = arc(50, 86, 50, 14, 0, Math.PI);
		return {
			lines: [
				[
					[50, 0],
					[0, 86],
				],
				[
					[50, 0],
					[100, 86],
				],
				front,
			],
			hidden: [arc(50, 86, 50, 14, Math.PI, 2 * Math.PI)],
			fill: [[50, 0], ...front],
		};
	},
	sphere: () => {
		const circle = arc(50, 50, 50, 50, 0, 2 * Math.PI, 64);
		return {
			lines: [circle, arc(50, 50, 50, 14, 0, Math.PI)],
			hidden: [arc(50, 50, 50, 14, Math.PI, 2 * Math.PI)],
			fill: circle.slice(0, -1),
		};
	},
	pyramid: () => {
		const [fl, fr, br, bl, apex]: Vec[] = [
			[0, 100],
			[70, 100],
			[100, 70],
			[30, 70],
			[50, 0],
		];
		return {
			lines: [
				[apex, fl],
				[apex, fr],
				[apex, br],
				[fl, fr],
				[fr, br],
			],
			hidden: [
				[bl, fl],
				[bl, br],
				[apex, bl],
			],
			fill: hull([apex, fl, fr, br, bl]),
		};
	},
	tetrahedron: () => {
		const [t, p1, p2, p3]: Vec[] = [
			[40, 0],
			[0, 85],
			[45, 100],
			[100, 75],
		];
		return {
			lines: [
				[t, p1],
				[t, p2],
				[t, p3],
				[p1, p2],
				[p2, p3],
			],
			hidden: [[p1, p3]],
			fill: hull([t, p1, p2, p3]),
		};
	},
	hexprism: () => {
		const e = 14;
		const h = 100 - 2 * e;
		const top: Vec[] = [
			[0, e],
			[25, 0],
			[75, 0],
			[100, e],
			[75, 2 * e],
			[25, 2 * e],
		];
		const bot: Vec[] = top.map(([x, y]) => [x, y + h] as Vec);
		return {
			lines: [
				closed(top),
				[top[0], bot[0]],
				[top[5], bot[5]],
				[top[4], bot[4]],
				[top[3], bot[3]],
				[bot[0], bot[5], bot[4], bot[3]],
			],
			hidden: [
				[bot[0], bot[1], bot[2], bot[3]],
				[top[1], bot[1]],
				[top[2], bot[2]],
			],
			fill: hull([...top, ...bot]),
		};
	},
	octahedron: () => {
		const [t, b, l, r, f, k]: Vec[] = [
			[50, 0],
			[50, 100],
			[0, 50],
			[100, 50],
			[45, 66],
			[55, 34],
		];
		return {
			lines: [
				[t, l],
				[t, f],
				[t, r],
				[b, l],
				[b, f],
				[b, r],
				[l, f],
				[f, r],
			],
			hidden: [
				[t, b],
				[l, k],
				[k, r],
				[t, k],
				[b, k],
			],
			fill: hull([t, b, l, r]),
		};
	},
	pyramidfrustum: () => {
		const [fl, fr, br, bl]: Vec[] = [
			[0, 100],
			[70, 100],
			[100, 70],
			[30, 70],
		];
		const c: Vec = [50, 85];
		const shrink = ([x, y]: Vec): Vec => [
			c[0] + 0.5 * (x - c[0]),
			25 + 0.5 * (y - c[1]),
		];
		const [tfl, tfr, tbr, tbl] = [fl, fr, br, bl].map(shrink);
		return {
			lines: [
				[fl, fr],
				[fr, br],
				closed([tfl, tfr, tbr, tbl]),
				[fl, tfl],
				[fr, tfr],
				[br, tbr],
			],
			hidden: [
				[bl, fl],
				[bl, br],
				[bl, tbl],
			],
			fill: hull([fl, fr, br, bl, tfl, tfr, tbr, tbl]),
		};
	},
	conefrustum: () => {
		const front = arc(50, 86, 50, 14, 0, Math.PI);
		const topBack = arc(50, 22, 30, 8, Math.PI, 2 * Math.PI);
		return {
			lines: [
				arc(50, 22, 30, 8, 0, 2 * Math.PI),
				[
					[20, 22],
					[0, 86],
				],
				[
					[80, 22],
					[100, 86],
				],
				front,
			],
			hidden: [arc(50, 86, 50, 14, Math.PI, 2 * Math.PI)],
			fill: [...topBack, ...front],
		};
	},
};

/** Kinds that turn over when dragged upward and mirror when dragged to the left (R-033). */
const FLIPPABLE: ElementKind[] = [
	"triangle",
	"righttriangle",
	"righttrapezoid",
	"pentagon",
	"hexagon",
	"octagon",
	"star",
	"roundrect",
	"semicircle",
	"quadrant",
	"sine",
	"cosine",
	"bell",
	"scurve",
	"parabola",
];

/** The shapes that are made in the real coordinates of the box (their curves depend on its size). */
function direct(
	kind: ElementKind,
	b: Box,
	adj: number,
	numbered = false,
	plane?: PlaneOptions,
): ShapeParts | null {
	const n = 96; // the quarters of a period (peaks and zeros of sine and cosine) fall on samples
	const along = (f: (u: number) => number): Vec[] =>
		Array.from({ length: n + 1 }, (_, i) => {
			const u = i / n;
			return [b.x0 + b.w * u, f(u)] as Vec;
		});
	switch (kind) {
		case "roundrect": {
			const r = Math.min(b.w, b.h) * adj;
			const corner = (cx: number, cy: number, t0: number) =>
				arc(cx, cy, r, r, t0, t0 + Math.PI / 2, 8);
			const p = [
				...corner(b.x0 + r, b.y0 + r, Math.PI),
				...corner(b.x1 - r, b.y0 + r, 1.5 * Math.PI),
				...corner(b.x1 - r, b.y1 - r, 0),
				...corner(b.x0 + r, b.y1 - r, 0.5 * Math.PI),
			];
			return { lines: [closed(p)], hidden: [], fill: p };
		}
		case "semicircle": {
			const p = arc(b.cx, b.y1, b.w / 2, b.h, Math.PI, 2 * Math.PI);
			return { lines: [closed(p)], hidden: [], fill: p };
		}
		case "quadrant": {
			const p: Vec[] = [
				[b.x0, b.y1],
				...arc(b.x0, b.y1, b.w, b.h, -Math.PI / 2, 0),
			];
			return { lines: [closed(p)], hidden: [], fill: p };
		}
		// One period, 0 to 2π, across the width of the box: the sine starts in the middle and goes
		// up (up is up on the screen), the cosine starts at the top.
		case "sine":
			return solid(along((u) => b.cy - (b.h / 2) * Math.sin(2 * Math.PI * u)));
		case "cosine":
			return solid(along((u) => b.cy - (b.h / 2) * Math.cos(2 * Math.PI * u)));
		case "bell": {
			// A Gauss bell, lowered so that both ends sit exactly on the bottom of the box.
			const g = (u: number) => Math.exp(-((u - 0.5) ** 2) / (2 * 0.13 ** 2));
			const g0 = g(0);
			return solid(along((u) => b.y1 - (b.h * (g(u) - g0)) / (1 - g0)));
		}
		case "scurve":
			return solid(along((u) => b.y1 - b.h * (3 * u * u - 2 * u ** 3)));
		case "parabola":
			return solid(along((u) => b.y1 - b.h * (2 * u - 1) ** 2));
		case "axes": {
			// Two axes with arrow heads through the centre, marked every AXES_STEP; as the frame
			// is stretched the axes grow and more marks appear (R-040).
			const a = Math.max(4, Math.min(10, b.w / 6, b.h / 6));
			const lines: Vec[][] = [
				[
					[b.x0, b.cy],
					[b.x1, b.cy],
				],
				[
					[b.cx, b.y1],
					[b.cx, b.y0],
				],
				[
					[b.x1 - a, b.cy - a * 0.45],
					[b.x1, b.cy],
					[b.x1 - a, b.cy + a * 0.45],
				],
				[
					[b.cx - a * 0.45, b.y0 + a],
					[b.cx, b.y0],
					[b.cx + a * 0.45, b.y0 + a],
				],
			];
			// The marks of the units are thin and apart from the axes; with the option they are numbered.
			const fine: Vec[][] = [];
			const labels: { text: string; x: number; y: number }[] = [];
			const across = Math.floor((b.w / 2 - a * 1.5) / AXES_STEP);
			for (let i = 1; i <= across; i++) {
				for (const s of [-1, 1]) {
					const x = b.cx + s * i * AXES_STEP;
					fine.push([
						[x, b.cy - 4],
						[x, b.cy + 4],
					]);
					labels.push({ text: String(s * i), x, y: b.cy + 4 + LABEL_PX * 0.7 });
				}
			}
			const up = Math.floor((b.h / 2 - a * 1.5) / AXES_STEP);
			for (let i = 1; i <= up; i++) {
				for (const s of [-1, 1]) {
					const y = b.cy + s * i * AXES_STEP;
					fine.push([
						[b.cx - 4, y],
						[b.cx + 4, y],
					]);
					// up is up on the screen: the positive numbers are above the centre
					labels.push({
						text: String(-s * i),
						x: b.cx - 6 - LABEL_PX * 0.55,
						y,
					});
				}
			}
			return { ...solid(...lines), fine, ...(numbered ? { labels } : {}) };
		}
		case "plane":
			return planeParts(b, numbered, plane);
		default:
			return null;
	}
}

/** The look of a coordinate plane that is not just lines: the sheet, the arrow heads, the text (R-084). */
export interface PlaneLook {
	x0: number;
	y0: number;
	w: number;
	h: number;
	/** The radius of the sheet's corners. */
	r: number;
	cell: number;
	/** The size of the numbers, in board units. */
	px: number;
	/** The filled arrow heads. */
	heads: Vec[][];
	/** The numbers and the letters x and y, each with where it stands and how it is aligned. */
	text: {
		t: string;
		x: number;
		y: number;
		align: "left" | "right" | "center";
		base: "top" | "middle" | "bottom";
		letter?: boolean;
		/** The size of this text as a part of the usual one; missing means 1. */
		scale?: number;
	}[];
}

/** A number as it is written on an axis: with a real minus sign. */
const planeNumber = (n: number): string => (n < 0 ? `\u2212${-n}` : String(n));

/**
 * A coordinate plane (R-084), a sheet of graph paper: a grid of cells from the middle with every
 * second line a little stronger, axes with filled arrow heads and numbers through the middle, and
 * the x and y at their tips. Stretching the box adds cells; their size stays. The sheet itself
 * (its frame, the heads, the text) is in `plane`; the renderer paints it.
 */
function planeParts(
	b: Box,
	numbered: boolean,
	options: PlaneOptions = {
		cell: PLANE_CELL,
		grid: true,
		axes: true,
		axisWidth: 3,
	},
): ShapeParts {
	const step = options.cell > 0 ? options.cell : PLANE_CELL;
	const lines: Vec[][] = [];
	const fine: Vec[][] = [];
	const grid: Vec[][] = [];
	const cluster: Vec[][] = [];
	// In π mode the cells along x are a twelfth of π and every sixth line, a half π, is stronger.
	const dx = options.pi ? (Math.PI * step) / 12 : step;
	if (options.grid) {
		const across = Math.floor(b.w / 2 / dx);
		for (let i = -across; i <= across; i++) {
			if (i === 0 && options.axes) continue; // the axis is drawn there
			const x = b.cx + i * dx;
			((options.pi ? i % 6 === 0 : i % 2 === 0) ? cluster : grid).push([
				[x, b.y0],
				[x, b.y1],
			]);
		}
		const up = Math.floor(b.h / 2 / step);
		for (let i = -up; i <= up; i++) {
			if (i === 0 && options.axes) continue;
			const y = b.cy + i * step;
			(i % 2 === 0 ? cluster : grid).push([
				[b.x0, y],
				[b.x1, y],
			]);
		}
	}
	const px = clamp(step * 0.3, 10, 15);
	const heads: Vec[][] = [];
	const text: PlaneLook["text"] = [];
	if (options.axes) {
		// The heads sit a little in from the edge; the axes stop under them.
		const a = Math.min(
			clamp(6 + 2 * options.axisWidth, 8, 18),
			b.w / 6,
			b.h / 6,
		);
		const xt = b.x1 - 3;
		const yt = b.y0 + 3;
		const gap = 3 + options.axisWidth / 2;
		lines.push(
			[
				[b.x0, b.cy],
				[xt - a * 0.7, b.cy],
			],
			[
				[b.cx, b.y1],
				[b.cx, yt + a * 0.7],
			],
		);
		heads.push(
			closed([
				[xt, b.cy],
				[xt - a, b.cy - a * 0.42],
				[xt - a * 0.8, b.cy],
				[xt - a, b.cy + a * 0.42],
			]),
			closed([
				[b.cx, yt],
				[b.cx - a * 0.42, yt + a],
				[b.cx, yt + a * 0.8],
				[b.cx + a * 0.42, yt + a],
			]),
		);
		if (!options.grid && !options.pi) {
			// Without the grid the units are marked on the axes.
			for (let i = 1; i <= Math.floor((b.w / 2 - a - px) / step); i++)
				for (const s of [-1, 1])
					fine.push([
						[b.cx + s * i * step, b.cy - 4],
						[b.cx + s * i * step, b.cy + 4],
					]);
			for (let i = 1; i <= Math.floor((b.h / 2 - a - px) / step); i++)
				for (const s of [-1, 1])
					fine.push([
						[b.cx - 4, b.cy + s * i * step],
						[b.cx + 4, b.cy + s * i * step],
					]);
		}
		if (numbered) {
			// A narrow cell has room for a number only at every k-th line.
			const every =
				[1, 2, 5, 10, 20, 50].find((n) => step * n >= 2.6 * px) ?? 100;
			const nx = Math.floor((b.w / 2 - a - px) / step);
			const ny = Math.floor((b.h / 2 - a - px) / step);
			if (!options.pi)
				for (let i = every; i <= nx; i += every)
					for (const s of [-1, 1])
						text.push({
							t: planeNumber(s * i),
							x: b.cx + s * i * step,
							y: b.cy + gap,
							align: "center",
							base: "top",
						});
			// up is up on the screen: the positive numbers are above the middle
			for (let i = every; i <= ny; i += every)
				for (const s of [-1, 1])
					text.push({
						t: planeNumber(-s * i),
						x: b.cx - gap,
						y: b.cy + s * i * step,
						align: "right",
						base: "middle",
					});
			if (options.pi) {
				// The x axis in π: every full π, every half π, and the small fractions of the first
				// quarter (π/6, π/4, π/3) on both sides. Where the cells are narrow, the fractions go.
				const reach = b.w / 2 - a - px;
				const room = Math.PI * step; // the length of π along x
				const small = px * 0.62;
				for (let k = 6; k * dx <= reach; k += 6) {
					const n = k / 6; // halves of π
					if (n % 2 === 1 && room < 50) continue;
					const half = n % 2 === 1;
					const name = half
						? `${n === 1 ? "" : n}\u03c0/2`
						: `${n / 2 === 1 ? "" : n / 2}\u03c0`;
					for (const s of [-1, 1]) {
						const x = b.cx + s * k * dx;
						text.push({
							t: s < 0 ? `\u2212${name}` : name,
							x,
							y: b.cy + gap,
							align: "center",
							base: "top",
							...(half ? { scale: 0.85 } : {}),
						});
						fine.push([
							[x, b.cy - (half ? 4.5 : 6)],
							[x, b.cy + (half ? 4.5 : 6)],
						]);
					}
				}
				if (room >= 100)
					for (const [k, name, row] of [
						[2, "\u03c0/6", 0],
						[3, "\u03c0/4", 1],
						[4, "\u03c0/3", 0],
					] as const) {
						if (k * dx > reach) continue;
						for (const s of [-1, 1]) {
							const x = b.cx + s * k * dx;
							text.push({
								t: s < 0 ? `\u2212${name}` : name,
								x,
								y: b.cy + gap + row * small * 1.15,
								align: "center",
								base: "top",
								scale: 0.62,
							});
							fine.push([
								[x, b.cy - 3],
								[x, b.cy + 3],
							]);
						}
					}
			}
			text.push(
				// In π mode the fractions crowd the place under the origin, so the 0 stands above.
				options.pi
					? {
							t: "0",
							x: b.cx - gap,
							y: b.cy - gap,
							align: "right",
							base: "bottom",
						}
					: {
							t: "0",
							x: b.cx - gap,
							y: b.cy + gap,
							align: "right",
							base: "top",
						},
				{
					t: "x",
					x: xt,
					y: b.cy - gap - a * 0.42,
					align: "right",
					base: "bottom",
					letter: true,
				},
				{
					t: "y",
					x: b.cx + gap + a * 0.42,
					y: yt,
					align: "left",
					base: "top",
					letter: true,
				},
			);
		}
	}
	const look: PlaneLook = {
		x0: b.x0,
		y0: b.y0,
		w: b.w,
		h: b.h,
		r: clamp(Math.min(b.w, b.h) * 0.015, 4, 10),
		cell: Math.min(step, dx),
		px,
		heads,
		text,
	};
	return { ...solid(...lines), fine, grid, cluster, plane: look };
}

/**
 * The lines of a shape drawn from two opposite corners (R-039, R-040), or null for a kind that
 * has its own path. The direction of the drag orients flat shapes (R-033); solids and the
 * coordinate system keep their position.
 */
export function shapeParts(
	kind: ElementKind | undefined,
	a: Vec,
	b: Vec,
	adj?: number,
	verts?: Vec[],
	/** The kind's own shape, whatever `verts` say (what a solid's skeleton is made from). */
	plain = false,
	/** A coordinate system numbered along its marks. */
	numbered = false,
	/** What a coordinate plane is made of (R-084). */
	plane?: PlaneOptions,
): ShapeParts | null {
	if (!kind || !isPolygonKind(kind)) return null;
	if (POLYHEDRA.includes(kind) && !plain)
		return solidParts(kind, a, b, adj, verts);
	if (verts && verts.length >= 3) {
		const { x0, y0, w, h } = boxOf(a, b);
		const poly = verts.map((v): Vec => [x0 + v[0] * w, y0 + v[1] * h]);
		return { lines: [closed(poly)], hidden: [], fill: poly };
	}
	if (kind === "trapezoid" || kind === "rhombus" || kind === "parallelogram") {
		const poly = polygonPoints(kind, a, b, parameter(kind, adj));
		return { lines: [closed(poly)], hidden: [], fill: poly };
	}
	const { x0, x1, y0, y1, w, h, flipX, flipY } = boxOf(a, b);
	const box: Box = {
		x0,
		y0,
		x1,
		y1,
		w,
		h,
		cx: (x0 + x1) / 2,
		cy: (y0 + y1) / 2,
	};
	const make = FIT[kind];
	const k = parameter(kind, adj);
	let parts = make
		? fitted(make(k), box)
		: direct(kind, box, k, numbered, plane);
	if (!parts) return null;
	if (FLIPPABLE.includes(kind)) {
		if (flipX || flipY) {
			parts = map(parts, ([x, y]) => [
				flipX ? x0 + x1 - x : x,
				flipY ? y0 + y1 - y : y,
			]);
		}
	}
	return parts;
}

const cache = new WeakMap<Stroke, ShapeParts | null>();

/** `shapeParts` of an element, computed once (elements are immutable). */
export function partsOf(s: Stroke): ShapeParts | null {
	if (cache.has(s)) return cache.get(s) ?? null;
	const [a, b] = s.points;
	const parts =
		a && b
			? shapeParts(
					s.kind,
					[a[0], a[1]],
					[b[0], b[1]],
					s.adj,
					s.verts,
					false,
					s.numbered,
					s.kind === "plane"
						? {
								cell: s.cell ?? PLANE_CELL,
								grid: s.grid !== false,
								axes: s.showAxes !== false,
								axisWidth: s.size,
								pi: s.pi === true,
							}
						: undefined,
				)
			: null;
	cache.set(s, parts);
	return parts;
}

/** The usual value of a shape's parameter and the range that looks right. */
const RANGE: Partial<
	Record<ElementKind, { def: number; min: number; max: number }>
> = {
	trapezoid: { def: 0.25, min: 0, max: 0.5 },
	parallelogram: { def: 0.25, min: 0, max: 0.9 },
	righttrapezoid: { def: 0.25, min: 0, max: 0.9 },
	triangle: { def: 0.5, min: 0, max: 1 },
	roundrect: { def: 0.25, min: 0, max: 0.5 },
};

/** The shapes that have a parameter and so a handle on one of their vertices (R-041). */
export const ADJUSTABLE = Object.keys(RANGE) as ElementKind[];

/** The parameter of a shape: the given one kept in range, the usual one if none was given. */
function parameter(kind: ElementKind, adj: number | undefined): number {
	const r = RANGE[kind];
	if (!r) return adj ?? 0;
	const value = adj === undefined || !Number.isFinite(adj) ? r.def : adj;
	return clamp(value, r.min, r.max);
}

/** The box of two corners and which way the shape was dragged (it is turned over or mirrored). */
function boxOf(a: Vec, b: Vec) {
	const x0 = Math.min(a[0], b[0]);
	const x1 = Math.max(a[0], b[0]);
	const y0 = Math.min(a[1], b[1]);
	const y1 = Math.max(a[1], b[1]);
	return {
		x0,
		x1,
		y0,
		y1,
		w: x1 - x0,
		h: y1 - y0,
		flipX: b[0] < a[0],
		flipY: b[1] < a[1],
	};
}

/**
 * Where the handle of an adjustable shape sits, on the vertex its parameter moves, before the
 * element's own turn (null for a shape without one): the top vertex of a trapezoid, a
 * parallelogram, a right trapezoid or a triangle, and the end of the top arc of a rounded
 * rectangle. It follows the orientation the shape was drawn in.
 */
export function adjustHandle(
	kind: ElementKind,
	a: Vec,
	b: Vec,
	adj?: number,
): Vec | null {
	if (!ADJUSTABLE.includes(kind)) return null;
	const { x0, x1, y0, y1, w, h, flipX, flipY } = boxOf(a, b);
	const k = parameter(kind, adj);
	const x =
		kind === "righttrapezoid"
			? x1 - k * w
			: kind === "roundrect"
				? x0 + k * Math.min(w, h)
				: x0 + k * w;
	return [flipX ? x0 + x1 - x : x, flipY ? y1 : y0];
}

/** The parameter that puts the handle where the pointer is (the inverse of `adjustHandle`), in range. */
export function adjustFromPoint(
	kind: ElementKind,
	a: Vec,
	b: Vec,
	at: Vec,
): number {
	const r = RANGE[kind];
	if (!r) return 0;
	const { x0, x1, w, h, flipX } = boxOf(a, b);
	const x = flipX ? x0 + x1 - at[0] : at[0];
	const size = kind === "roundrect" ? Math.min(w, h) : w;
	if (size <= 0) return r.def;
	const k = kind === "righttrapezoid" ? (x1 - x) / size : (x - x0) / size;
	return clamp(k, r.min, r.max);
}

/** The most corners that are offered as handles; a shape with arcs has too many to be useful. */
const MAX_VERTICES = 12;

/**
 * The corners of a shape that is a single plain polygon (before the element's turn), or null for
 * anything else: ellipses, solids, curves and shapes with arcs have no corners to move (R-047).
 * A rectangle has four.
 */
export function outlineOf(
	kind: ElementKind,
	a: Vec,
	b: Vec,
	adj?: number,
	verts?: Vec[],
): Vec[] | null {
	if (POLYHEDRA.includes(kind)) {
		const { x0, y0, w, h } = boxOf(a, b);
		const f =
			verts && verts.length === skeletonOf(kind).corners.length
				? verts
				: skeletonOf(kind).corners;
		return f.map((v): Vec => [x0 + v[0] * w, y0 + v[1] * h]);
	}
	if (kind === "rect") {
		const { x0, y0, x1, y1 } = boxOf(a, b);
		return [
			[x0, y0],
			[x1, y0],
			[x1, y1],
			[x0, y1],
		];
	}
	const parts = shapeParts(kind, a, b, adj, verts);
	if (!parts || parts.hidden.length > 0 || parts.lines.length !== 1)
		return null;
	const n = parts.fill.length;
	return n >= 3 && n <= MAX_VERTICES ? parts.fill : null;
}

/** The solids made of straight edges only; each corner of one can be moved (R-050). */
const POLYHEDRA: ElementKind[] = [
	"cube",
	"cuboid",
	"parallelepiped",
	"pyramid",
	"tetrahedron",
	"hexprism",
	"octahedron",
	"pyramidfrustum",
];

/**
 * A solid as corners and the edges between them: the corners in the unit box, and for every
 * visible and hidden edge the corners it runs through. Worked out once per kind from its shape.
 */
interface Skeleton {
	corners: Vec[];
	lines: number[][];
	hidden: number[][];
}
const skeletons = new Map<ElementKind, Skeleton>();

function skeletonOf(kind: ElementKind): Skeleton {
	let sk = skeletons.get(kind);
	if (sk) return sk;
	const unit = shapeParts(
		kind,
		[0, 0],
		[1, 1],
		undefined,
		undefined,
		true,
	) as ShapeParts;
	const corners: Vec[] = [];
	const index = (p: Vec): number => {
		let i = corners.findIndex(
			(c) => Math.hypot(c[0] - p[0], c[1] - p[1]) < 1e-6,
		);
		if (i < 0) i = corners.push([p[0], p[1]]) - 1;
		return i;
	};
	const lines = unit.lines.map((l) => l.map(index));
	const hidden = unit.hidden.map((l) => l.map(index));
	sk = { corners, lines, hidden };
	skeletons.set(kind, sk);
	return sk;
}

/** A solid with its corners where `verts` (fractions of the box) put them; the usual ones if none. */
function solidParts(
	kind: ElementKind,
	a: Vec,
	b: Vec,
	adj: number | undefined,
	verts: Vec[] | undefined,
): ShapeParts | null {
	const sk = skeletonOf(kind);
	if (!verts || verts.length !== sk.corners.length) {
		return shapeParts(kind, a, b, adj, undefined, true);
	}
	const { x0, y0, w, h } = boxOf(a, b);
	const at = verts.map((v): Vec => [x0 + v[0] * w, y0 + v[1] * h]);
	return {
		lines: sk.lines.map((l) => l.map((i) => at[i])),
		hidden: sk.hidden.map((l) => l.map((i) => at[i])),
		fill: hull(at),
	};
}
