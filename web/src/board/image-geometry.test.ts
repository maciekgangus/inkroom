import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import {
	defaultSize,
	fitWithin,
	hitHandle,
	imageRect,
	moveRect,
	placeCentered,
	resizeFromCorner,
} from "./image-geometry";

function image(a: [number, number], b: [number, number]): Stroke {
	return {
		id: "i",
		authorId: "a",
		color: "#000",
		size: 1,
		z: 0,
		kind: "image",
		src: "x",
		points: [
			[...a, 0.5],
			[...b, 0.5],
		],
	};
}

describe("fitWithin", () => {
	test("shrinks the longer side to the limit and keeps the proportions", () => {
		expect(fitWithin(4000, 3000, 2048)).toEqual({ w: 2048, h: 1536 });
		expect(fitWithin(3000, 4000, 2048)).toEqual({ w: 1536, h: 2048 });
	});

	test("never enlarges", () => {
		expect(fitWithin(800, 600, 2048)).toEqual({ w: 800, h: 600 });
	});
});

describe("imageRect", () => {
	test("is the box between the two corners, whichever way they were stored", () => {
		expect(imageRect(image([10, 20], [110, 80]))).toEqual({
			minX: 10,
			minY: 20,
			maxX: 110,
			maxY: 80,
		});
		expect(imageRect(image([110, 80], [10, 20]))).toEqual({
			minX: 10,
			minY: 20,
			maxX: 110,
			maxY: 80,
		});
	});
});

describe("defaultSize", () => {
	const view = { minX: 0, minY: 0, maxX: 1000, maxY: 800 };

	test("keeps the natural size when it is small", () => {
		expect(defaultSize(300, 200, view)).toEqual({ w: 300, h: 200 });
	});

	test("shrinks a big image to 60% of the view width, keeping proportions", () => {
		expect(defaultSize(3000, 1500, view)).toEqual({ w: 600, h: 300 });
	});

	test("also respects 60% of the view height", () => {
		const s = defaultSize(1000, 3000, view); // tall
		expect(s.h).toBeCloseTo(480);
		expect(s.w / s.h).toBeCloseTo(1 / 3);
	});
});

describe("placeCentered", () => {
	test("returns the top-left corner that centres the image in the view", () => {
		expect(
			placeCentered(
				{ w: 200, h: 100 },
				{ minX: 100, minY: 0, maxX: 500, maxY: 300 },
			),
		).toEqual([200, 100]);
	});
});

describe("moveRect", () => {
	test("shifts the rectangle", () => {
		expect(moveRect({ minX: 0, minY: 0, maxX: 10, maxY: 20 }, 5, -3)).toEqual({
			minX: 5,
			minY: -3,
			maxX: 15,
			maxY: 17,
		});
	});
});

describe("resizeFromCorner", () => {
	const r = { minX: 100, minY: 100, maxX: 300, maxY: 200 }; // 200 x 100

	test("dragging the south-east corner outwards grows it, anchored at the north-west", () => {
		const n = resizeFromCorner(r, "se", [500, 300], 20);
		expect([n.minX, n.minY]).toEqual([100, 100]);
		expect((n.maxX - n.minX) / (n.maxY - n.minY)).toBeCloseTo(2);
		expect(n.maxX - n.minX).toBeCloseTo(400);
	});

	test("the opposite corner stays put for every corner", () => {
		const nw = resizeFromCorner(r, "nw", [50, 50], 20);
		expect([nw.maxX, nw.maxY]).toEqual([300, 200]);
		const ne = resizeFromCorner(r, "ne", [400, 50], 20);
		expect([ne.minX, ne.maxY]).toEqual([100, 200]);
		const sw = resizeFromCorner(r, "sw", [20, 300], 20);
		expect([sw.maxX, sw.minY]).toEqual([300, 100]);
	});

	test("proportions are always kept", () => {
		for (const corner of ["nw", "ne", "sw", "se"] as const) {
			const n = resizeFromCorner(r, corner, [37, 411], 20);
			expect((n.maxX - n.minX) / (n.maxY - n.minY)).toBeCloseTo(2);
		}
	});

	test("cannot shrink below the minimum width, and cannot flip over the anchor", () => {
		const n = resizeFromCorner(r, "se", [90, 90], 20); // past the anchor
		expect(n.maxX - n.minX).toBeCloseTo(20);
		expect([n.minX, n.minY]).toEqual([100, 100]);
	});
});

describe("hitHandle", () => {
	const r = { minX: 100, minY: 100, maxX: 300, maxY: 200 };

	test("finds the corner under the pointer", () => {
		expect(hitHandle(r, [102, 98], 10)).toBe("nw");
		expect(hitHandle(r, [298, 99], 10)).toBe("ne");
		expect(hitHandle(r, [101, 203], 10)).toBe("sw");
		expect(hitHandle(r, [305, 205], 10)).toBe("se");
	});

	test("returns null away from the corners", () => {
		expect(hitHandle(r, [200, 150], 10)).toBeNull();
		expect(hitHandle(r, [150, 100], 10)).toBeNull();
	});
});
