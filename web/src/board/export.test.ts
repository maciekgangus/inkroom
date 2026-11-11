import { describe, expect, it } from "vitest";
import type { Stroke } from "./board";
import { exportRegion, exportSize, pdfFromJpeg } from "./export";

const rect = (id: string, x: number, y: number, w: number, h: number): Stroke =>
	({
		id,
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

const view = { minX: 0, minY: 0, maxX: 800, maxY: 600 };

describe("exportRegion", () => {
	it("takes the screen's view as it is", () => {
		expect(exportRegion([rect("a", 5000, 5000, 10, 10)], view, "view")).toEqual(
			view,
		);
	});

	it("takes all the content with a margin for the whole board", () => {
		const r = exportRegion(
			[rect("a", 100, 100, 50, 50), rect("b", 400, 300, 100, 100)],
			view,
			"board",
		);
		expect(r).not.toBeNull();
		expect(r?.minX).toBeLessThan(100);
		expect(r?.minY).toBeLessThan(100);
		expect(r?.maxX).toBeGreaterThan(500);
		expect(r?.maxY).toBeGreaterThan(400);
	});

	it("has nothing to export from an empty board", () => {
		expect(exportRegion([], view, "board")).toBeNull();
	});
});

describe("exportSize", () => {
	it("doubles a small region for a sharp picture", () => {
		expect(exportSize({ minX: 0, minY: 0, maxX: 400, maxY: 300 })).toEqual({
			scale: 2,
			width: 800,
			height: 600,
		});
	});

	it("keeps a huge region within the largest side", () => {
		const s = exportSize({ minX: 0, minY: 0, maxX: 20000, maxY: 10000 });
		expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(4096);
		expect(s.width / s.height).toBeCloseTo(2, 1);
	});
});

describe("pdfFromJpeg", () => {
	const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
	const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

	it("wraps the picture in a one page PDF of the given size", () => {
		const pdf = text(pdfFromJpeg(jpeg, 800, 600, 400, 300));
		expect(pdf.startsWith("%PDF-1.4")).toBe(true);
		expect(pdf).toContain("/MediaBox [0 0 400 300]");
		expect(pdf).toContain("/Filter /DCTDecode");
		expect(pdf).toContain("/Width 800");
		expect(pdf).toContain("/Height 600");
		expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
	});

	it("points the cross reference table at the real objects", () => {
		const bytes = pdfFromJpeg(jpeg, 8, 6, 8, 6);
		const pdf = text(bytes);
		const start = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
		expect(pdf.slice(start, start + 4)).toBe("xref");
		const offsets = [...pdf.slice(start).matchAll(/(\d{10}) 00000 n/g)].map(
			(m) => Number(m[1]),
		);
		expect(offsets).toHaveLength(5);
		offsets.forEach((o, i) => {
			expect(pdf.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
		});
	});
});
