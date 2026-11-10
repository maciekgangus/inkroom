import { describe, expect, test } from "vitest";
import type { ElementKind, Stroke } from "./board";
import { AXES_STEP, partsOf, shapeParts } from "./shape-parts";
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
const CURVES: ElementKind[] = ["sine", "bell", "scurve", "parabola"];
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

	test("a sine crosses the middle and reaches the top and the bottom", () => {
		const y = ys("sine");
		expect(Math.min(...y)).toBeCloseTo(100, 1);
		expect(Math.max(...y)).toBeCloseTo(280, 1);
		expect(y.some((v) => v < 190) && y.some((v) => v > 190)).toBe(true);
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
	const ticks = (a: Vec, b: Vec) =>
		parts("axes", a, b).lines.filter((l) => l.length === 2);

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
