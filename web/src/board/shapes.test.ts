import { afterEach, describe, expect, test, vi } from "vitest";
import { shapeParts } from "./shape-parts";
import {
	hasInside,
	isPolygonKind,
	loadShape,
	pointInPolygon,
	polygonPoints,
	SHAPE_GROUPS,
	SHAPES,
	saveShape,
} from "./shapes";

describe("polygon shapes (R-033)", () => {
	const a: [number, number] = [0, 0];
	const b: [number, number] = [100, 50];

	test("a rhombus joins the middles of the four sides", () => {
		expect(polygonPoints("rhombus", a, b)).toEqual([
			[50, 0],
			[100, 25],
			[50, 50],
			[0, 25],
		]);
	});

	test("a trapezoid is narrower at the top", () => {
		expect(polygonPoints("trapezoid", a, b)).toEqual([
			[25, 0],
			[75, 0],
			[100, 50],
			[0, 50],
		]);
	});

	test("a parallelogram leans to the right", () => {
		expect(polygonPoints("parallelogram", a, b)).toEqual([
			[25, 0],
			[100, 0],
			[75, 50],
			[0, 50],
		]);
	});

	test("dragging upward turns a trapezoid upside down, so its wide side is on top", () => {
		const set = (pts: number[][]) => new Set(pts.map((p) => p.join()));
		const upsideDown = set([
			[0, 0],
			[100, 0],
			[75, 50],
			[25, 50],
		]);
		// dragged from the bottom up, whichever side it started: a trapezoid is symmetric sideways
		expect(set(polygonPoints("trapezoid", [0, 50], [100, 0]))).toEqual(
			upsideDown,
		);
		expect(set(polygonPoints("trapezoid", [100, 50], [0, 0]))).toEqual(
			upsideDown,
		);
	});

	test("dragging to the left mirrors a parallelogram", () => {
		expect(polygonPoints("parallelogram", [100, 0], [0, 50])).toEqual([
			[75, 0],
			[0, 0],
			[25, 50],
			[100, 50],
		]);
	});

	test("dragging up and left together gives the shape back as dragged down and right, turned", () => {
		const down = polygonPoints("parallelogram", [0, 0], [100, 50]);
		const up = polygonPoints("parallelogram", [100, 50], [0, 0]);
		// the same outline, only the corners are listed from the other end
		expect(new Set(up.map((p) => p.join()))).toEqual(
			new Set(down.map((p) => p.join())),
		);
	});

	test("a rhombus looks the same whichever way it was dragged", () => {
		const norm = (pts: number[][]) => new Set(pts.map((p) => p.join()));
		const a2 = polygonPoints("rhombus", a, b);
		expect(norm(polygonPoints("rhombus", b, a))).toEqual(norm(a2));
		expect(norm(polygonPoints("rhombus", [100, 0], [0, 50]))).toEqual(norm(a2));
	});

	test("only the three polygon kinds are polygons", () => {
		for (const k of ["trapezoid", "rhombus", "parallelogram"] as const)
			expect(isPolygonKind(k)).toBe(true);
		for (const k of [
			"rect",
			"ellipse",
			"circle",
			"line",
			"text",
			undefined,
		] as const)
			expect(isPolygonKind(k)).toBe(false);
	});

	test("pointInPolygon tells inside from outside", () => {
		const rhombus = polygonPoints("rhombus", a, b);
		expect(pointInPolygon(rhombus, 50, 25)).toBe(true);
		expect(pointInPolygon(rhombus, 5, 2)).toBe(false); // a corner of the box, outside the rhombus
		expect(pointInPolygon(rhombus, 120, 25)).toBe(false);
	});
});

describe("the list of shapes (R-039)", () => {
	test("is in the categories of the catalog, rectangle first", () => {
		expect(SHAPE_GROUPS.map((g) => g.title)).toEqual([
			"Podstawowe wielokąty",
			"Regularne wielokąty",
			"Zaokrąglone kształty",
			"Bryły 3D",
			"Krzywe",
			"Wykresy",
		]);
		expect(SHAPES[0].kind).toBe("rect");
		expect(SHAPES[0].label).toBe("Prostokąt");
	});

	test("has every shape of the catalog once, each with a Polish name", () => {
		const kinds = SHAPES.map((s) => s.kind);
		expect(new Set(kinds).size).toBe(kinds.length);
		expect(kinds).toHaveLength(7 + 4 + 4 + 12 + 4 + 1);
		for (const s of SHAPES) expect(s.label.length).toBeGreaterThan(0);
	});

	test("everything but the rectangle and the oval is drawn from lines", () => {
		for (const s of SHAPES) {
			const lines = s.kind !== "rect" && s.kind !== "ellipse";
			expect(isPolygonKind(s.kind)).toBe(lines);
			expect(shapeParts(s.kind, [0, 0], [100, 80]) !== null).toBe(lines);
		}
	});
});

describe("the remembered shape", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});
	const fakeStorage = () => {
		const data = new Map<string, string>();
		return {
			getItem: (k: string) => data.get(k) ?? null,
			setItem: (k: string, v: string) => void data.set(k, v),
		};
	};

	test("defaults to the rectangle", () => {
		vi.stubGlobal("localStorage", fakeStorage());
		expect(loadShape()).toBe("rect");
	});

	test("remembers the last chosen shape on the device", () => {
		vi.stubGlobal("localStorage", fakeStorage());
		saveShape("rhombus");
		expect(loadShape()).toBe("rhombus");
	});

	test("ignores a value that is not a shape, and storage that throws", () => {
		const s = fakeStorage();
		s.setItem("inkroom.shape", "heptagon");
		vi.stubGlobal("localStorage", s);
		expect(loadShape()).toBe("rect");
		vi.stubGlobal("localStorage", {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
		});
		expect(loadShape()).toBe("rect");
		expect(() => saveShape("rhombus")).not.toThrow();
	});
});

describe("hasInside", () => {
	test("is false for the curves and the coordinate system, true for the other shapes", () => {
		for (const kind of ["sine", "bell", "scurve", "parabola", "axes"] as const)
			expect(hasInside(kind)).toBe(false);
		for (const kind of [
			"rect",
			"ellipse",
			"circle",
			"triangle",
			"cube",
			"star",
		] as const)
			expect(hasInside(kind)).toBe(true);
	});
});
