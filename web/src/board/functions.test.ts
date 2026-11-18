import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import {
	evalFn,
	type Frame,
	fnLabel,
	MAX_FNS,
	newFn,
	type PlaneFn,
	planeFrame,
	sampleFn,
	sanitizeFns,
} from "./functions";
import { PLANE_CELL, partsOf } from "./shape-parts";

const fn = (k: PlaneFn["k"], c: number[], extra: Partial<PlaneFn> = {}) =>
	({ id: "f", k, c, color: "#d32f2f", w: 2, ...extra }) as PlaneFn;

/** A 480 x 480 sheet centred at (240, 240) with cells of 40: one unit is 40 px both ways. */
const frame: Frame = {
	cx: 240,
	cy: 240,
	x0: 0,
	y0: 0,
	x1: 480,
	y1: 480,
	ux: 40,
	uy: 40,
};

describe("evalFn", () => {
	test("the presets give their formulas", () => {
		expect(evalFn(fn("linear", [2, 1]), 3)).toBe(7);
		expect(evalFn(fn("quad", [1, -2, 1]), 3)).toBe(4);
		expect(evalFn(fn("quad", [2, 1, -3], { canon: true }), 2)).toBe(-1); // 2(x-1)^2-3
		expect(evalFn(fn("cubic", [1, 0, 0, 1]), 2)).toBe(9);
		expect(evalFn(fn("abs", [2, 1, 1]), -2)).toBe(7); // 2|x-1|+1
		expect(evalFn(fn("exp", [3, 2]), 3)).toBe(24);
		expect(evalFn(fn("log", [1, 2]), 8)).toBeCloseTo(3, 10);
		expect(evalFn(fn("sqrt", [2, 1, 1]), 5)).toBe(5); // 2*sqrt(4)+1
		expect(evalFn(fn("hom", [2, 1, 3]), 3)).toBe(4); // 2/(3-1)... a/(x-p)+q = 2/2+3
		expect(evalFn(fn("sin", [2, 1, 0, 1]), Math.PI / 2)).toBeCloseTo(3, 10);
		expect(evalFn(fn("cos", [1, 1, 0, 0]), Math.PI)).toBeCloseTo(-1, 10);
		expect(evalFn(fn("tan", [1, 1, 0, 0]), Math.PI / 4)).toBeCloseTo(1, 10);
	});

	test("outside the domain it is NaN", () => {
		expect(evalFn(fn("log", [1, 2]), -1)).toBeNaN();
		expect(evalFn(fn("log", [1, 1]), 5)).toBeNaN(); // base 1
		expect(evalFn(fn("sqrt", [1, 0, 0]), -1)).toBeNaN();
		expect(evalFn(fn("hom", [1, 2, 0]), 2)).toBeNaN();
		expect(evalFn(fn("exp", [1, -2]), 1)).toBeNaN(); // a negative base
	});
});

describe("sampleFn", () => {
	const inside = (lines: [number, number][][]) =>
		lines.every((l) =>
			l.every(([x, y]) => x >= -1 && x <= 481 && y >= -481 && y <= 961),
		);

	test("a line is one polyline through the right points", () => {
		const lines = sampleFn(fn("linear", [1, 0]), frame);
		expect(lines).toHaveLength(1);
		for (const [x, y] of lines[0]) expect(y).toBeCloseTo(240 - (x - 240), 6);
	});

	test("a sheet of 12 units has the curve only across the sheet", () => {
		const lines = sampleFn(fn("linear", [0, 0]), frame);
		const xs = lines.flat().map((p) => p[0]);
		expect(Math.min(...xs)).toBeCloseTo(0, 6);
		expect(Math.max(...xs)).toBeCloseTo(480, 6);
	});

	test("1/x breaks at the asymptote instead of joining the branches", () => {
		const lines = sampleFn(fn("hom", [1, 0, 0]), frame);
		expect(lines.length).toBeGreaterThanOrEqual(2);
		for (const l of lines) {
			const left = l.every((p) => p[0] < 240);
			const right = l.every((p) => p[0] > 240);
			expect(left || right).toBe(true);
		}
	});

	test("tan breaks at every asymptote", () => {
		const lines = sampleFn(fn("tan", [1, 1, 0, 0]), frame);
		// 12 units hold about 4 asymptotes: at least 4 pieces
		expect(lines.length).toBeGreaterThanOrEqual(4);
		for (const l of lines)
			for (let i = 1; i < l.length; i++)
				expect(Math.abs(l[i][1] - l[i - 1][1])).toBeLessThan(480);
	});

	test("log has no points where it is undefined", () => {
		const lines = sampleFn(fn("log", [1, 2]), frame);
		for (const p of lines.flat()) expect(p[0]).toBeGreaterThan(240);
	});

	test("points stay near the sheet however steep the curve is", () => {
		const lines = sampleFn(fn("exp", [1, 3]), frame);
		expect(lines.length).toBeGreaterThan(0);
		expect(inside(lines)).toBe(true);
	});

	test("in π numbering one x unit is a radian: sin has its period of 2π", () => {
		const pi: Frame = { ...frame, ux: 40 };
		const lines = sampleFn(fn("sin", [1, 1, 0, 0]), pi);
		const pts = lines.flat();
		// at x = π/2 radians from the middle the curve is at y = 1 unit above the axis
		const target = 240 + (Math.PI / 2) * pi.ux;
		const near = pts.reduce((a, b) =>
			Math.abs(b[0] - target) < Math.abs(a[0] - target) ? b : a,
		);
		expect(near[1]).toBeCloseTo(240 - 40, 0);
	});

	test("it does not take more points than a fixed cap", () => {
		const huge: Frame = { ...frame, x0: -50000, x1: 50000, ux: 40 };
		const n = sampleFn(fn("sin", [1, 1, 0, 0]), huge).flat().length;
		expect(n).toBeLessThanOrEqual(6000);
	});
});

describe("fnLabel", () => {
	test("writes the formula with its coefficients", () => {
		expect(fnLabel(fn("linear", [2, -1]))).toBe("y = 2x − 1");
		expect(fnLabel(fn("quad", [1, 0, -4]))).toBe("y = x² − 4");
		expect(fnLabel(fn("sin", [1, 2, 0, 0]))).toBe("y = sin(2x)");
	});
});

describe("newFn", () => {
	test("starts from the preset's coefficients", () => {
		const f = newFn("quad", "id1", "#1976d2");
		expect(f).toMatchObject({ id: "id1", k: "quad", color: "#1976d2" });
		expect(f.c).toHaveLength(3);
	});
});

describe("sanitizeFns", () => {
	const ok = { id: "a", k: "linear", c: [1, 0], color: "#000000", w: 2 };
	test("keeps a good list", () => {
		expect(sanitizeFns([ok])).toEqual([ok]);
	});
	test("rejects what is not a list of known functions", () => {
		expect(sanitizeFns("x")).toBeNull();
		expect(sanitizeFns([{ ...ok, k: "evil" }])).toBeNull();
		expect(sanitizeFns([{ ...ok, c: [1] }])).toBeNull(); // wrong number
		expect(sanitizeFns([{ ...ok, c: [1, Number.NaN] }])).toBeNull();
		expect(sanitizeFns([{ ...ok, c: [1, 99999] }])).toBeNull(); // beyond the bound
		expect(sanitizeFns([{ ...ok, color: "red; x" }])).toBeNull();
		expect(sanitizeFns([{ ...ok, w: 0 }])).toBeNull();
	});
	test("rejects more than the most allowed", () => {
		const many = Array.from({ length: MAX_FNS + 1 }, (_, i) => ({
			...ok,
			id: `f${i}`,
		}));
		expect(sanitizeFns(many)).toBeNull();
	});
});

describe("planeFrame: the curve lines up with the axes the plane draws", () => {
	const plane = (pi: boolean): Stroke => ({
		id: "p",
		authorId: "a",
		color: "#111",
		size: 3,
		z: 1,
		kind: "plane",
		numbered: true,
		pi,
		points: [
			[0, 0, 0.5],
			[800, 400, 0.5],
		],
	});
	const look = (s: Stroke) => {
		const l = partsOf(s)?.plane;
		if (!l) throw new Error("no plane");
		return l;
	};

	test("in π numbering the tick labelled π stands one π of x units from the origin", () => {
		const s = plane(true);
		const l = look(s);
		const fr = planeFrame(l, s.cell ?? PLANE_CELL);
		const tick = l.text.find((t) => t.t === "\u03c0" && t.x > fr.cx);
		expect(tick).toBeDefined();
		expect(fr.cx + Math.PI * fr.ux).toBeCloseTo(tick?.x ?? 0, 3);
	});

	test("sin(x) has its peak above π/2 and is back on the axis at π", () => {
		const s = plane(true);
		const l = look(s);
		const fr = planeFrame(l, PLANE_CELL);
		const pts = sampleFn(fn("sin", [1, 1, 0, 0]), fr).flat();
		const at = (x: number) =>
			pts.reduce((a, b) => (Math.abs(b[0] - x) < Math.abs(a[0] - x) ? b : a));
		expect(at(fr.cx + (Math.PI / 2) * fr.ux)[1]).toBeCloseTo(fr.cy - fr.uy, 0);
		expect(at(fr.cx + Math.PI * fr.ux)[1]).toBeCloseTo(fr.cy, 0);
	});

	test("with plain numbering one unit of x is one cell, as on y", () => {
		const s = plane(false);
		const l = look(s);
		const fr = planeFrame(l, PLANE_CELL);
		expect(fr.ux).toBe(PLANE_CELL);
		expect(fr.uy).toBe(PLANE_CELL);
	});
});
