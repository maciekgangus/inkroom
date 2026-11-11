import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import { previewRegion } from "./preview";

const rect = (x: number, y: number, w: number, h: number): Stroke =>
	({
		id: `r${x}${y}`,
		kind: "rect",
		points: [
			[x, y, 0.5],
			[x + w, y + h, 0.5],
		],
		color: "#000",
		size: 2,
		authorId: "t",
		z: 0,
	}) as Stroke;

const w = (r: { minX: number; maxX: number }) => r.maxX - r.minX;
const h = (r: { minY: number; maxY: number }) => r.maxY - r.minY;

describe("previewRegion (R-052)", () => {
	test("an empty board shows the empty page at its origin", () => {
		const r = previewRegion([], 4 / 3);
		expect(r.minX).toBe(0);
		expect(w(r) / h(r)).toBeCloseTo(4 / 3);
	});

	test("the region has the shape of the tile and holds everything on the board", () => {
		const strokes = [rect(100, 100, 50, 50), rect(900, 400, 100, 100)];
		const r = previewRegion(strokes, 4 / 3);
		expect(w(r) / h(r)).toBeCloseTo(4 / 3);
		expect(r.minX).toBeLessThan(100);
		expect(r.minY).toBeLessThan(100);
		expect(r.maxX).toBeGreaterThan(1000);
		expect(r.maxY).toBeGreaterThan(500);
	});

	test("a wide drawing is centred in a tile taller than it", () => {
		const r = previewRegion([rect(0, 0, 2000, 100)], 4 / 3);
		const centre = (r.minY + r.maxY) / 2;
		expect(centre).toBeCloseTo(50, 0);
	});

	test("a tall drawing is centred in a tile wider than it", () => {
		const r = previewRegion([rect(0, 0, 100, 2000)], 4 / 3);
		expect((r.minX + r.maxX) / 2).toBeCloseTo(50, 0);
	});
});
