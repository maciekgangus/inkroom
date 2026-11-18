import { describe, expect, test } from "vitest";
import type { ElementKind, Stroke } from "./board";
import {
	ADJUSTABLE,
	AXES_STEP,
	adjustFromPoint,
	adjustHandle,
	outlineOf,
	partsOf,
	shapeParts,
} from "./shape-parts";
import { polygonPoints } from "./shapes";

type Vec = [number, number];
const A: Vec = [100, 100];
const B: Vec = [340, 280]; // a box 240 wide, 180 tall
const parts = (kind: ElementKind, a: Vec = A, b: Vec = B) => {
	const p = shapeParts(kind, a, b);
	if (!p) throw new Error(`no parts for ${kind}`);
	return p;
};
const all = (kind: ElementKind) => {
	const p = parts(kind);
	return [...p.lines, ...p.hidden].flat();
};

const BASIC: ElementKind[] = [
	"triangle",
	"righttriangle",
	"righttrapezoid",
	"trapezoid",
	"parallelogram",
	"rhombus",
];
const REGULAR: ElementKind[] = ["pentagon", "hexagon", "octagon", "star"];
const ROUNDED: ElementKind[] = ["roundrect", "semicircle", "quadrant"];
const SOLIDS: ElementKind[] = [
	"cube",
	"cuboid",
	"cylinder",
	"parallelepiped",
	"pyramid",
	"cone",
	"sphere",
	"tetrahedron",
	"hexprism",
	"octahedron",
	"pyramidfrustum",
	"conefrustum",
];
const CURVES: ElementKind[] = ["sine", "cosine", "bell", "scurve", "parabola"];
const EVERY: ElementKind[] = [
	...BASIC,
	...REGULAR,
	...ROUNDED,
	...SOLIDS,
	...CURVES,
	"axes",
];

describe("shapeParts (R-039, R-040)", () => {
	test.each(EVERY)("%s fills its box exactly and stays inside it", (kind) => {
		const pts = all(kind);
		expect(pts.length).toBeGreaterThan(1);
		const xs = pts.map((p) => p[0]);
		const ys = pts.map((p) => p[1]);
		expect(Math.min(...xs)).toBeCloseTo(100, 3);
		expect(Math.max(...xs)).toBeCloseTo(340, 3);
		expect(Math.min(...ys)).toBeCloseTo(100, 3);
		expect(Math.max(...ys)).toBeCloseTo(280, 3);
	});

	test.each([...BASIC, ...REGULAR, ...ROUNDED, ...SOLIDS])(
		"%s has an outline to fill and to hit",
		(kind) => {
			const fill = parts(kind).fill;
			expect(fill.length).toBeGreaterThanOrEqual(3);
			for (const [x, y] of fill) {
				expect(x).toBeGreaterThanOrEqual(100 - 1e-6);
				expect(x).toBeLessThanOrEqual(340 + 1e-6);
				expect(y).toBeGreaterThanOrEqual(100 - 1e-6);
				expect(y).toBeLessThanOrEqual(280 + 1e-6);
			}
		},
	);

	test.each([...CURVES, "axes"] as ElementKind[])(
		"%s is open: nothing to fill",
		(kind) => {
			expect(parts(kind).fill).toEqual([]);
		},
	);

	test.each([...BASIC, ...REGULAR, ...ROUNDED, ...CURVES])(
		"%s has no hidden edges",
		(kind) => {
			expect(parts(kind).hidden).toEqual([]);
		},
	);

	test.each(SOLIDS.filter((k) => k !== "cube"))(
		"the solid %s shows its hidden edges",
		(kind) => {
			expect(parts(kind).hidden.length).toBeGreaterThan(0);
		},
	);

	test("a cube shows only what can be seen", () => {
		expect(parts("cube").hidden).toEqual([]);
	});

	test("nothing is drawn for kinds that are not parametric", () => {
		expect(shapeParts("rect", A, B)).toBeNull();
		expect(shapeParts("text", A, B)).toBeNull();
		expect(shapeParts(undefined, A, B)).toBeNull();
	});

	test("the old polygons keep their outline, orientation included", () => {
		for (const kind of ["trapezoid", "rhombus", "parallelogram"] as const) {
			expect(parts(kind).fill).toEqual(polygonPoints(kind, A, B));
			expect(parts(kind, B, A).fill).toEqual(polygonPoints(kind, B, A));
		}
	});
});

describe("2D shapes", () => {
	test("a triangle has its apex at the top middle", () => {
		const f = parts("triangle").fill;
		expect(f).toHaveLength(3);
		expect(f).toContainEqual([220, 100]);
		expect(f).toContainEqual([340, 280]);
		expect(f).toContainEqual([100, 280]);
	});

	test("a right triangle has its right angle at the bottom left", () => {
		const f = parts("righttriangle").fill;
		expect(f).toContainEqual([100, 100]);
		expect(f).toContainEqual([100, 280]);
		expect(f).toContainEqual([340, 280]);
	});

	test("a right trapezoid has a vertical left side and a slanted right one", () => {
		const f = parts("righttrapezoid").fill;
		expect(f).toHaveLength(4);
		expect(f.filter((p) => p[0] === 100)).toHaveLength(2);
	});

	test.each([
		["pentagon", 5],
		["hexagon", 6],
		["octagon", 8],
		["star", 10],
	] as const)(
		"a %s has %i corners and is symmetric about its vertical axis",
		(kind, n) => {
			const f = parts(kind).fill;
			expect(f).toHaveLength(n);
			for (const [x, y] of f) {
				const mirror = f.find(
					(q) => Math.abs(q[0] - (440 - x)) < 1e-6 && Math.abs(q[1] - y) < 1e-6,
				);
				expect(mirror).toBeDefined();
			}
		},
	);

	test("a star alternates between outer and inner corners", () => {
		const f = parts("star").fill;
		const c: Vec = [220, 190];
		const r = f.map((p) => Math.hypot((p[0] - c[0]) / 120, (p[1] - c[1]) / 90));
		for (let i = 0; i < r.length; i += 2)
			expect(r[i]).toBeGreaterThan(r[i + 1]);
	});

	test("a rounded rectangle has more than four corners, rounded", () => {
		const f = parts("roundrect").fill;
		expect(f.length).toBeGreaterThan(8);
		expect(f.some((p) => p[0] === 100 && p[1] === 100)).toBe(false); // the box corner is cut off
	});

	test("a semicircle has a flat bottom and a round top", () => {
		const f = parts("semicircle").fill;
		expect(
			f.filter((p) => Math.abs(p[1] - 280) < 1e-6).length,
		).toBeGreaterThanOrEqual(2);
		expect(
			f.some((p) => Math.abs(p[0] - 220) < 1e-6 && Math.abs(p[1] - 100) < 1e-6),
		).toBe(true);
	});

	test("a quarter circle has its corner at the bottom left", () => {
		const f = parts("quadrant").fill;
		expect(f).toContainEqual([100, 280]);
		expect(f.some((p) => p[0] === 340 && Math.abs(p[1] - 280) < 1e-6)).toBe(
			true,
		);
		expect(f.some((p) => p[1] === 100 && Math.abs(p[0] - 100) < 1e-6)).toBe(
			true,
		);
	});

	test("dragging upward turns a triangle over, so its apex is at the bottom", () => {
		const f = parts("triangle", B, A).fill; // the second corner is above the first
		expect(f).toContainEqual([220, 280]);
	});

	test("dragging to the left mirrors a right triangle", () => {
		const f = parts("righttriangle", [340, 100], [100, 280]).fill;
		expect(f).toContainEqual([340, 100]);
		expect(f).toContainEqual([340, 280]);
	});
});

describe("curves", () => {
	const ys = (kind: ElementKind) => parts(kind).lines[0].map((p) => p[1]);

	test("a sine is one period, 0 to 2π: from the middle up to the top, down to the bottom, back to the middle", () => {
		const y = ys("sine");
		const n = y.length - 1;
		expect(Math.min(...y)).toBeCloseTo(100, 1);
		expect(Math.max(...y)).toBeCloseTo(280, 1);
		expect(y[0]).toBeCloseTo(190, 1); // 0
		expect(y[n / 4]).toBeCloseTo(100, 1); // π/2: the top (up is up on the screen)
		expect(y[n / 2]).toBeCloseTo(190, 1); // π
		expect(y[(3 * n) / 4]).toBeCloseTo(280, 1); // 3π/2: the bottom
		expect(y[n]).toBeCloseTo(190, 1); // 2π
	});

	test("a cosine is one period too, but starts at the top: 1, 0, -1, 0, 1", () => {
		const y = ys("cosine");
		const n = y.length - 1;
		expect(y[0]).toBeCloseTo(100, 1); // 0: the top
		expect(y[n / 4]).toBeCloseTo(190, 1); // π/2
		expect(y[n / 2]).toBeCloseTo(280, 1); // π: the bottom
		expect(y[(3 * n) / 4]).toBeCloseTo(190, 1); // 3π/2
		expect(y[n]).toBeCloseTo(100, 1); // 2π: the top again
	});

	test("a bell peaks in the middle and falls to the bottom at both ends", () => {
		const line = parts("bell").lines[0];
		const peak = line.reduce((a, p) => (p[1] < a[1] ? p : a));
		expect(peak[0]).toBeCloseTo(220, 0);
		expect(peak[1]).toBeCloseTo(100, 1);
		expect(line[0][1]).toBeGreaterThan(270);
		expect(line[line.length - 1][1]).toBeGreaterThan(270);
	});

	test("an S curve rises smoothly from the bottom left to the top right", () => {
		const line = parts("scurve").lines[0];
		for (let i = 1; i < line.length; i++)
			expect(line[i][1]).toBeLessThanOrEqual(line[i - 1][1] + 1e-9);
		expect(line[0][1]).toBeCloseTo(280, 1);
		expect(line[line.length - 1][1]).toBeCloseTo(100, 1);
	});

	test("a parabola opens upward with its vertex at the bottom middle", () => {
		const line = parts("parabola").lines[0];
		const vertex = line.reduce((a, p) => (p[1] > a[1] ? p : a));
		expect(vertex[0]).toBeCloseTo(220, 0);
		expect(vertex[1]).toBeCloseTo(280, 1);
		expect(line[0][1]).toBeCloseTo(100, 1);
	});

	test("dragging upward turns a curve over", () => {
		const line = parts("parabola", B, A).lines[0];
		const vertex = line.reduce((a, p) => (p[1] < a[1] ? p : a));
		expect(vertex[1]).toBeCloseTo(100, 1); // now the vertex is at the top
	});
});

describe("solids", () => {
	test("dragging does not turn a solid over: it keeps standing on its base", () => {
		for (const kind of SOLIDS) {
			const up = JSON.stringify(parts(kind, B, A));
			const down = JSON.stringify(parts(kind, A, B));
			expect(up).toBe(down);
		}
	});

	test("a cone stands on a round base with its apex at the top middle", () => {
		const p = parts("cone");
		expect(
			p.fill.some((q) => Math.abs(q[0] - 220) < 1e-6 && q[1] === 100),
		).toBe(true);
		expect(Math.max(...p.fill.map((q) => q[1]))).toBeCloseTo(280, 1);
	});

	test("the outline of a sphere is round: every point is on the ellipse", () => {
		for (const [x, y] of parts("sphere").fill) {
			expect(Math.hypot((x - 220) / 120, (y - 190) / 90)).toBeCloseTo(1, 3);
		}
	});

	test("a cylinder has two straight sides and ellipses at both ends", () => {
		const p = parts("cylinder");
		expect(p.lines.length).toBeGreaterThanOrEqual(3);
		expect(p.hidden).toHaveLength(1); // the back half of the bottom ellipse
	});

	test("a hexagonal prism has six corners on top", () => {
		const p = parts("hexprism");
		const top = p.lines.find((l) => l.length === 7); // closed hexagon: first point repeated
		expect(top).toBeDefined();
	});
});

describe("the coordinate system", () => {
	const ticks = (a: Vec, b: Vec) => parts("axes", a, b).fine ?? [];

	test("has two axes through the centre with arrow heads", () => {
		const p = parts("axes");
		const horizontal = p.lines.find(
			(l) =>
				l.length === 2 &&
				l[0][1] === 190 &&
				l[1][1] === 190 &&
				l[1][0] - l[0][0] > 100,
		);
		const vertical = p.lines.find(
			(l) =>
				l.length === 2 &&
				l[0][0] === 220 &&
				l[1][0] === 220 &&
				Math.abs(l[1][1] - l[0][1]) > 100,
		);
		expect(horizontal).toBeDefined();
		expect(vertical).toBeDefined();
		expect(p.lines.filter((l) => l.length === 3)).toHaveLength(2); // an arrow head on each axis
	});

	test("units are marked at the same distance from the origin on both sides", () => {
		const marks = ticks(A, B).filter(
			(l) => l[0][1] !== l[1][1] && l[0][0] === l[1][0] && l[0][0] !== 220,
		);
		const xs = marks.map((l) => l[0][0] - 220).sort((a, b) => a - b);
		expect(xs.length).toBeGreaterThan(2);
		for (const x of xs) expect(Math.abs(x) % AXES_STEP).toBeCloseTo(0, 6);
		expect(xs.map((x) => -x).sort((a, b) => a - b)).toEqual(xs); // symmetric
	});

	test("stretching the frame lengthens the axes and adds marks, the spacing stays", () => {
		const count = (a: Vec, b: Vec) => ticks(a, b).length;
		const small = count([0, 0], [240, 240]);
		const wide = count([0, 0], [480, 240]);
		expect(wide).toBeGreaterThan(small);
		const xs = ticks([0, 0], [480, 240])
			.filter((l) => l[0][0] === l[1][0] && l[0][0] !== 240)
			.map((l) => l[0][0] - 240);
		for (const x of xs) expect(Math.abs(x) % AXES_STEP).toBeCloseTo(0, 6);
	});

	test("dragging does not mirror it", () => {
		expect(JSON.stringify(parts("axes", B, A))).toBe(
			JSON.stringify(parts("axes", A, B)),
		);
	});
});

describe("partsOf", () => {
	const stroke: Stroke = {
		id: "s",
		authorId: "a",
		color: "#000",
		size: 4,
		z: 1,
		kind: "pentagon",
		points: [
			[100, 100, 0.5],
			[340, 280, 0.5],
		],
	};

	test("is computed once per element, and null for others", () => {
		expect(partsOf(stroke)).toBe(partsOf(stroke));
		expect(partsOf({ ...stroke, kind: "rect" })).toBeNull();
		expect(partsOf({ ...stroke, points: [[0, 0, 0.5]] })).toBeNull();
	});
});

describe("adjustable shapes (R-041, phase 2)", () => {
	const top = (kind: ElementKind, adj?: number, a: Vec = A, b: Vec = B) => {
		const fill = shapeParts(kind, a, b, adj)?.fill ?? [];
		return fill
			.filter((p) => Math.abs(p[1] - Math.min(a[1], b[1])) < 1e-6)
			.map((p) => p[0])
			.sort((x, y) => x - y);
	};

	test("only these shapes have a parameter", () => {
		for (const kind of [
			"trapezoid",
			"parallelogram",
			"righttrapezoid",
			"triangle",
			"roundrect",
		] as const)
			expect(ADJUSTABLE.includes(kind)).toBe(true);
		for (const kind of [
			"rect",
			"ellipse",
			"star",
			"cube",
			"sine",
			"cosine",
			"axes",
			"rhombus",
		] as const)
			expect(ADJUSTABLE.includes(kind)).toBe(false);
	});

	test("without a parameter the shapes are as they were", () => {
		expect(shapeParts("trapezoid", A, B, undefined)?.fill).toEqual(
			shapeParts("trapezoid", A, B)?.fill,
		);
		expect(top("trapezoid")).toEqual([160, 280]); // 25 % in from each side of the 240 wide box
	});

	test("the slant of a trapezoid and of a parallelogram", () => {
		expect(top("trapezoid", 0.1)).toEqual([124, 316]);
		expect(top("trapezoid", 0)).toEqual([100, 340]); // a rectangle
		expect(top("parallelogram", 0.5)).toEqual([220, 340]);
	});

	test("the right trapezoid's slanted side", () => {
		expect(top("righttrapezoid", 0.5)).toEqual([100, 220]);
		expect(top("righttrapezoid")).toEqual([100, 280]);
	});

	test("the apex of a triangle", () => {
		expect(top("triangle", 0)).toEqual([100]);
		expect(top("triangle", 1)).toEqual([340]);
		expect(top("triangle")).toEqual([220]);
	});

	test("the radius of a rounded rectangle, a share of the shorter side", () => {
		const small = shapeParts("roundrect", A, B, 0.1)?.fill ?? [];
		const big = shapeParts("roundrect", A, B, 0.5)?.fill ?? [];
		// the first point of the outline is where the top left arc ends: 180 * adj in from the corner
		expect(
			Math.min(...small.filter((p) => p[1] === 100).map((p) => p[0])),
		).toBeCloseTo(118);
		expect(
			Math.min(
				...big.filter((p) => Math.abs(p[1] - 100) < 1e-6).map((p) => p[0]),
			),
		).toBeCloseTo(190);
	});

	test("the parameter is kept between what looks right", () => {
		expect(top("trapezoid", 5)).toEqual(top("trapezoid", 0.5));
		expect(top("trapezoid", -1)).toEqual(top("trapezoid", 0));
	});
});

describe("the handle of an adjustable shape", () => {
	test("sits on the vertex the parameter moves", () => {
		expect(adjustHandle("trapezoid", A, B)).toEqual([160, 100]);
		expect(adjustHandle("trapezoid", A, B, 0.1)).toEqual([124, 100]);
		expect(adjustHandle("parallelogram", A, B)).toEqual([160, 100]);
		expect(adjustHandle("righttrapezoid", A, B)).toEqual([280, 100]);
		expect(adjustHandle("triangle", A, B)).toEqual([220, 100]);
		expect(adjustHandle("roundrect", A, B)).toEqual([145, 100]); // radius 0.25 of the shorter side, 180
	});

	test("follows the orientation of the shape", () => {
		expect(adjustHandle("trapezoid", B, A)).toEqual([280, 280]); // dragged up and left: turned over
		expect(adjustHandle("triangle", [340, 100], [100, 280], 0.25)).toEqual([
			280, 100,
		]); // mirrored
	});

	test("has nothing to offer for the others", () => {
		expect(adjustHandle("rect", A, B)).toBeNull();
		expect(adjustHandle("cube", A, B)).toBeNull();
	});

	test("moving the handle gives the parameter back, whatever the orientation", () => {
		for (const [a, b] of [
			[A, B],
			[B, A],
			[
				[340, 100],
				[100, 280],
			],
			[
				[100, 280],
				[340, 100],
			],
		] as [Vec, Vec][]) {
			for (const kind of [
				"trapezoid",
				"parallelogram",
				"righttrapezoid",
				"triangle",
				"roundrect",
			] as const) {
				const h = adjustHandle(kind, a, b, 0.3) as Vec;
				expect(adjustFromPoint(kind, a, b, h)).toBeCloseTo(0.3, 6);
			}
		}
	});

	test("is clamped to the range of the shape", () => {
		expect(adjustFromPoint("trapezoid", A, B, [900, 100])).toBe(0.5);
		expect(adjustFromPoint("trapezoid", A, B, [-900, 100])).toBe(0);
		expect(adjustFromPoint("triangle", A, B, [900, 100])).toBe(1);
		expect(adjustFromPoint("roundrect", A, B, [900, 100])).toBe(0.5);
	});
});

describe("free vertices (R-047)", () => {
	test("verts, fractions of the box, replace the outline of a polygon shape", () => {
		const verts: Vec[] = [
			[0, 0],
			[1, 0],
			[0.5, 1],
		];
		const parts = shapeParts("trapezoid", A, B, undefined, verts);
		expect(parts?.fill).toEqual([
			[100, 100],
			[340, 100],
			[220, 280],
		]);
		expect(parts?.lines[0]).toEqual([...(parts?.fill ?? []), [100, 100]]);
		expect(parts?.hidden).toEqual([]);
	});

	test("partsOf follows the verts of the element", () => {
		const s = {
			id: "x",
			authorId: "a",
			color: "#000",
			size: 4,
			z: 1,
			kind: "trapezoid" as const,
			points: [
				[100, 100, 0.5],
				[340, 280, 0.5],
			] as [number, number, number][],
			verts: [
				[0, 0],
				[1, 0],
				[1, 1],
			] as Vec[],
		};
		expect(partsOf(s)?.fill).toHaveLength(3);
	});

	test("outlineOf gives the vertices of a plain polygon, whatever the shape", () => {
		expect(outlineOf("trapezoid", A, B)).toHaveLength(4);
		expect(outlineOf("triangle", A, B)).toHaveLength(3);
		expect(outlineOf("rect", A, B)).toEqual([
			[100, 100],
			[340, 100],
			[340, 280],
			[100, 280],
		]);
		expect(outlineOf("hexagon", A, B)).toHaveLength(6);
	});

	test("what has no corners to move gives none", () => {
		for (const kind of [
			"ellipse",
			"circle",
			"sphere",
			"sine",
			"cosine",
			"axes",
			"roundrect",
		] as const)
			expect(outlineOf(kind, A, B)).toBeNull();
	});
});

describe("the corners of solids (R-050)", () => {
	const counts: [ElementKind, number][] = [
		["cube", 7], // drawn as a solid seen from the front: its back corner is hidden by it
		["cuboid", 8],
		["parallelepiped", 8],
		["pyramid", 5],
		["tetrahedron", 4],
		["hexprism", 12],
		["octahedron", 6],
		["pyramidfrustum", 8],
	];
	test.each(counts)("%s has %i corners to move", (kind, n) => {
		expect(outlineOf(kind, A, B)).toHaveLength(n);
	});

	test("what is round has none", () => {
		for (const kind of ["cylinder", "cone", "sphere", "conefrustum"] as const)
			expect(outlineOf(kind, A, B)).toBeNull();
	});

	test("every edge of the solid ends on one of the corners", () => {
		for (const [kind] of counts) {
			const corners = outlineOf(kind, A, B) as Vec[];
			const parts = shapeParts(kind, A, B);
			for (const p of [
				...(parts?.lines ?? []),
				...(parts?.hidden ?? []),
			].flat())
				expect(
					corners.some((c) => Math.hypot(c[0] - p[0], c[1] - p[1]) < 1e-6),
				).toBe(true);
		}
	});

	test("moving a corner moves it on every edge that meets there, and nothing else", () => {
		const corners = outlineOf("cube", A, B) as Vec[];
		const before = shapeParts("cube", A, B);
		// the fractions of the box, the corner 0 pulled out to (-0.2, -0.3)
		const verts = corners.map(
			(c, i): Vec =>
				i === 0 ? [-0.2, -0.3] : [(c[0] - 100) / 240, (c[1] - 100) / 180],
		);
		const after = shapeParts("cube", A, B, undefined, verts);
		const moved = (parts: typeof before) =>
			[...(parts?.lines ?? []), ...(parts?.hidden ?? [])].flat();
		const was = moved(before);
		const now = moved(after);
		expect(now).toHaveLength(was.length);
		expect(after?.lines).toHaveLength(before?.lines.length ?? 0);
		expect(after?.hidden).toHaveLength(before?.hidden.length ?? 0);
		const target: Vec = [100 + -0.2 * 240, 100 + -0.3 * 180];
		now.forEach((p, i) => {
			const atCorner =
				Math.hypot(was[i][0] - corners[0][0], was[i][1] - corners[0][1]) < 1e-6;
			if (atCorner) expect(p).toEqual(target);
			else expect(p).toEqual(was[i]);
		});
	});

	test("the silhouette to fill follows the corners", () => {
		const corners = outlineOf("pyramid", A, B) as Vec[];
		const verts = corners.map(
			(c, i): Vec =>
				i === 4 ? [0.5, -1] : [(c[0] - 100) / 240, (c[1] - 100) / 180],
		);
		const fill = shapeParts("pyramid", A, B, undefined, verts)?.fill ?? [];
		expect(fill.some((p) => p[1] < 100 - 100)).toBe(true); // the apex is far above the box
	});
});

describe("the coordinate system: fine marks and numbers", () => {
	const axes = (numbered: boolean) =>
		shapeParts("axes", A, B, undefined, undefined, false, numbered);

	test("the marks of the units are a group of their own, so they can be drawn thin", () => {
		const p = axes(false);
		expect(p?.fine?.length).toBeGreaterThan(4);
		// the main lines and the arrow heads stay in `lines`: two axes and two heads
		expect(p?.lines).toHaveLength(4);
		for (const m of p?.fine ?? []) expect(m).toHaveLength(2);
	});

	test("without the option there are no numbers", () => {
		expect(axes(false)?.labels ?? []).toEqual([]);
	});

	test("with it every mark is numbered: 1 2 3 to the right and up, -1 -2 -3 to the left and down", () => {
		const labels = axes(true)?.labels ?? [];
		const text = labels.map((l) => l.text);
		for (const t of ["1", "2", "3", "-1", "-2", "-3"])
			expect(text).toContain(t);
		expect(text).not.toContain("0");
		const cx = 220; // the centre of the box
		const cy = 190;
		const one = labels.find((l) => l.text === "1" && l.y > cy); // under the horizontal axis
		const minusOne = labels.find((l) => l.text === "-1" && l.y > cy);
		expect(one?.x).toBeCloseTo(cx + AXES_STEP, 6);
		expect(minusOne?.x).toBeCloseTo(cx - AXES_STEP, 6);
		const beside = (l: { x: number }) => Math.abs(l.x - cx) < 20; // by the vertical axis
		const up = labels.find((l) => l.text === "1" && beside(l)); // beside the vertical axis
		expect(up?.y).toBeCloseTo(cy - AXES_STEP, 6); // up is up on the screen
		const down = labels.find((l) => l.text === "-1" && beside(l));
		expect(down?.y).toBeCloseTo(cy + AXES_STEP, 6);
	});

	test("an element carries the option: partsOf reads `numbered`", () => {
		const el = {
			id: "a",
			authorId: "x",
			color: "#111",
			size: 2,
			z: 1,
			kind: "axes",
			numbered: true,
			points: [
				[100, 100, 0.5],
				[340, 280, 0.5],
			],
		} as Stroke;
		expect((partsOf(el)?.labels ?? []).length).toBeGreaterThan(4);
		expect((partsOf({ ...el, numbered: undefined })?.labels ?? []).length).toBe(
			0,
		);
	});
});

describe("the coordinate plane (R-084)", () => {
	const plane = (extra: Partial<Stroke> = {}, b: Vec = [400, 400]): Stroke => ({
		id: "p",
		authorId: "a",
		color: "#111",
		size: 3,
		z: 1,
		kind: "plane",
		numbered: true,
		points: [
			[0, 0, 0.5],
			[b[0], b[1], 0.5],
		],
		...extra,
	});
	const of = (s: Stroke) => {
		const p = partsOf(s);
		if (!p) throw new Error("no parts");
		return p;
	};

	test("a cell is 40 units: a 400 box has lines every 40 from the middle, every second one darker", () => {
		const p = of(plane());
		// 10 vertical and 10 horizontal lines besides the axes, +-1 to +-5 cells from the centre
		expect(p.grid?.length).toBe(12); // +-1, +-3, +-5, both ways
		expect(p.cluster?.length).toBe(8); // +-2, +-4 both ways
		const xs = new Set(
			[...(p.grid ?? []), ...(p.cluster ?? [])]
				.filter((l) => l.length === 2 && l[0][0] === l[1][0])
				.map((l) => l[0][0]),
		);
		expect([...xs].sort((a, b) => a - b)).toEqual([
			0, 40, 80, 120, 160, 240, 280, 320, 360, 400,
		]);
	});

	test("the axes cross at the middle and stop under a filled arrow head each", () => {
		const p = of(plane());
		expect(p.lines).toHaveLength(2);
		expect(p.plane?.heads).toHaveLength(2);
		const horizontal = p.lines.find((l) => l[0][1] === 200 && l[1][1] === 200);
		expect(horizontal).toBeDefined();
		// the axis ends inside the head, which stands a little in from the edge
		const tip = Math.max(...(p.plane?.heads[0] ?? []).map((v) => v[0]));
		expect(tip).toBeLessThan(400);
		expect(horizontal?.[1][0]).toBeLessThan(tip);
	});

	test("the size of a cell is the stroke's own: a bigger one has fewer lines", () => {
		const p = of(plane({ cell: 80 }));
		expect((p.grid?.length ?? 0) + (p.cluster?.length ?? 0)).toBeLessThan(
			12 + 8,
		);
		expect(p.grid?.length).toBe(4); // +-80 along each way
		expect(p.cluster?.length).toBe(4); // +-160 along each way
	});

	test("stretching the box adds cells, it does not change their size", () => {
		const small = of(plane({}, [400, 400]));
		const wide = of(plane({}, [800, 400]));
		const vertical = (q: typeof small) =>
			[...(q.grid ?? []), ...(q.cluster ?? [])].filter(
				(l) => l.length === 2 && l[0][0] === l[1][0],
			).length;
		expect(vertical(wide)).toBeGreaterThan(vertical(small));
		// the cell next to the middle is still 40 away
		const xs = [...(wide.grid ?? [])]
			.filter((l) => l[0][0] === l[1][0])
			.map((l) => Math.abs(l[0][0] - 400));
		expect(Math.min(...xs)).toBe(40);
	});

	test("the grid can be left out: only the frame and the axes remain", () => {
		const p = of(plane({ grid: false }));
		expect(p.grid ?? []).toHaveLength(0);
		expect(p.cluster ?? []).toHaveLength(0);
		expect(p.lines).toHaveLength(2);
		expect(p.plane?.text.length).toBeGreaterThan(0); // the axes keep their numbers
	});

	test("the axes can be left out, with their numbers", () => {
		const p = of(plane({ showAxes: false }));
		expect(p.lines).toHaveLength(0);
		expect(p.plane?.heads).toHaveLength(0);
		expect(p.plane?.text).toHaveLength(0);
	});

	test("numbers sit at every cell along both axes, and only when asked for", () => {
		const on = of(plane());
		const numbers = (on.plane?.text ?? []).filter(
			(l) => !l.letter && l.t !== "0",
		);
		expect(numbers).toHaveLength(16); // 4 cells each side of the middle, two axes
		expect(numbers.map((l) => l.t)).toEqual(
			expect.arrayContaining(["1", "\u22121", "4", "\u22124"]), // a real minus sign
		);
		const off = of(plane({ numbered: undefined }));
		expect(off.plane?.text ?? []).toHaveLength(0);
	});

	test("it has a 0 at the origin and the letters x and y at the tips of the axes", () => {
		const text = of(plane()).plane?.text ?? [];
		expect(text.find((l) => l.t === "0")).toBeDefined();
		expect(
			text
				.filter((l) => l.letter)
				.map((l) => l.t)
				.sort(),
		).toEqual(["x", "y"]);
	});

	test("a narrow cell is numbered only at every few lines, so the numbers never overlap", () => {
		const wide = of(plane({ cell: 40 })).plane?.text.length ?? 0;
		const narrow = of(plane({ cell: 10 }, [800, 800])).plane;
		const numbers = (narrow?.text ?? []).filter(
			(l) => !l.letter && l.t !== "0",
		);
		// cell 10: every fifth line, not 40 numbers per axis side
		expect(numbers.length).toBeLessThan(wide * 3);
		const xs = numbers
			.filter((l) => l.align === "center")
			.map((l) => l.x)
			.sort((a, b) => a - b);
		for (let i = 1; i < xs.length; i++)
			expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(30);
	});

	test("it has the sheet's shape: rounded corners, a size for the numbers that follows the cell", () => {
		const look = of(plane()).plane;
		expect(look?.r).toBeGreaterThanOrEqual(4);
		expect(look?.r).toBeLessThanOrEqual(10);
		expect(look?.px).toBeGreaterThanOrEqual(10);
		expect(look?.px).toBeLessThanOrEqual(15);
	});

	test("it has no inside to fill or to hit", () => {
		expect(of(plane()).fill).toHaveLength(0);
	});
});

describe("the coordinate plane numbered in π (R-084)", () => {
	const piPlane = (
		extra: Partial<Stroke> = {},
		b: Vec = [400, 400],
	): Stroke => ({
		id: "pi",
		authorId: "a",
		color: "#111",
		size: 3,
		z: 1,
		kind: "plane",
		numbered: true,
		pi: true,
		points: [
			[0, 0, 0.5],
			[b[0], b[1], 0.5],
		],
		...extra,
	});
	const of = (s: Stroke) => {
		const p = partsOf(s);
		if (!p) throw new Error("no parts");
		return p;
	};
	const xs = (p: ReturnType<typeof of>) =>
		(p.plane?.text ?? []).filter((l) => l.align === "center").map((l) => l.t);
	const PI = Math.PI * 40; // pi along the x axis, in board units, with a cell of 40

	test("a cell along x is a twelfth of π (15 degrees); every sixth line, a half π, is the stronger one", () => {
		const p = of(piPlane());
		const lines = [...(p.grid ?? []), ...(p.cluster ?? [])].filter(
			(l) => l.length === 2 && l[0][0] === l[1][0],
		);
		const at = (list: typeof lines) =>
			list.map((l) => l[0][0] - 200).sort((a, b) => a - b);
		const d = PI / 12;
		const major = at(
			(p.cluster ?? []).filter((l) => l.length === 2 && l[0][0] === l[1][0]),
		);
		expect(major.some((x) => Math.abs(x - PI / 2) < 1e-6)).toBe(true);
		expect(major.some((x) => Math.abs(x - d) < 1e-6)).toBe(false);
		const all = at(lines);
		expect(all.some((x) => Math.abs(x - d) < 1e-6)).toBe(true); // π/12
	});

	test("the rows of the grid across are the usual cells of the plane", () => {
		const p = of(piPlane());
		const across = [...(p.grid ?? []), ...(p.cluster ?? [])].filter(
			(l) => l.length === 2 && l[0][1] === l[1][1],
		);
		expect(across.length).toBeGreaterThan(0);
		expect(new Set(across.map((l) => l[0][1])).has(200 - 40)).toBe(true);
	});

	test("the full multiples of π and the halves are written everywhere along x", () => {
		const t = xs(of(piPlane({}, [800, 400])));
		for (const label of [
			"π",
			"\u2212π",
			"π/2",
			"\u2212π/2",
			"3π/2",
			"\u22123π/2",
		])
			expect(t).toContain(label);
	});

	test("π/6, π/4 and π/3 are written only in the first quarter, positive and negative", () => {
		const t = xs(of(piPlane({}, [800, 400])));
		for (const label of [
			"π/6",
			"π/4",
			"π/3",
			"\u2212π/6",
			"\u2212π/4",
			"\u2212π/3",
		])
			expect(t).toContain(label);
		for (const label of ["5π/6", "3π/4", "2π/3", "7π/6", "5π/4", "4π/3"])
			expect(t).not.toContain(label);
	});

	test("the small fractions are small, and stand in two rows so that they do not overlap", () => {
		const text = of(piPlane()).plane?.text ?? [];
		const small = text.filter((l) => ["π/6", "π/4", "π/3"].includes(l.t));
		const half = text.find((l) => l.t === "π/2");
		const full = text.find((l) => l.t === "π");
		expect(small.length).toBeGreaterThan(0);
		for (const l of small) expect(l.scale ?? 1).toBeLessThan(half?.scale ?? 1);
		expect(half?.scale ?? 1).toBeLessThan(full?.scale ?? 1);
		const rows = new Set(small.map((l) => l.y));
		expect(rows.size).toBe(2);
		// within one row, two neighbours are far enough apart
		for (const y of rows) {
			const row = small
				.filter((l) => l.y === y && l.x > 200)
				.map((l) => l.x)
				.sort((a, b) => a - b);
			for (let i = 1; i < row.length; i++)
				expect(row[i] - row[i - 1]).toBeGreaterThanOrEqual(20);
		}
	});

	test("the y axis keeps its numbers 1 2 3, and a 0 stands at the origin", () => {
		const text = of(piPlane()).plane?.text ?? [];
		const ys = text
			.filter((l) => l.align === "right" && l.t !== "0")
			.map((l) => l.t);
		expect(ys).toEqual(
			expect.arrayContaining(["1", "\u22121", "2", "\u22122"]),
		);
		expect(text.find((l) => l.t === "0")).toBeDefined();
	});

	test("every label has a mark on the axis, the longer the more important", () => {
		const p = of(piPlane());
		const ticks = (p.fine ?? []).filter(
			(l) => l.length === 2 && l[0][0] === l[1][0],
		);
		const at = (x: number) =>
			ticks.find((l) => Math.abs(l[0][0] - (200 + x)) < 1e-6);
		const len = (l: Vec[] | undefined) => (l ? Math.abs(l[1][1] - l[0][1]) : 0);
		expect(len(at(PI))).toBeGreaterThan(len(at(PI / 2)));
		expect(len(at(PI / 2))).toBeGreaterThan(len(at(PI / 3)));
		expect(len(at(PI / 3))).toBeGreaterThan(0);
	});

	test("on a narrow plane the fractions are left out so that nothing is crowded", () => {
		const t = xs(of(piPlane({ cell: 10 }, [400, 400])));
		expect(t).not.toContain("π/6");
		expect(t).toContain("π");
	});

	test("without π numbering the x axis has the usual numbers", () => {
		const t = xs(of(piPlane({ pi: undefined })));
		expect(t).toContain("1");
		expect(t).not.toContain("π");
	});

	test("with the numbers off, π mode writes nothing", () => {
		expect(of(piPlane({ numbered: undefined })).plane?.text ?? []).toHaveLength(
			0,
		);
	});
});
