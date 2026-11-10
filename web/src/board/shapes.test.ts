import { afterEach, describe, expect, test, vi } from "vitest";
import {
	isPolygonKind,
	loadShape,
	pointInPolygon,
	polygonPoints,
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

	test("the corners may be given in any order", () => {
		expect(polygonPoints("rhombus", b, a)).toEqual(
			polygonPoints("rhombus", a, b),
		);
		expect(polygonPoints("trapezoid", [100, 0], [0, 50])).toEqual(
			polygonPoints("trapezoid", a, b),
		);
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

describe("the list of shapes", () => {
	test("offers rectangle, circle and oval, trapezoid, rhombus and parallelogram, rectangle first", () => {
		expect(SHAPES.map((s) => s.kind)).toEqual([
			"rect",
			"ellipse",
			"trapezoid",
			"rhombus",
			"parallelogram",
		]);
		expect(SHAPES[0].label).toBe("Prostokąt");
		for (const s of SHAPES) expect(s.label.length).toBeGreaterThan(0);
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
		s.setItem("inkroom.shape", "hexagon");
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
