import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import {
	defaultSize,
	fitWithin,
	imageRect,
	placeCentered,
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
