import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import {
	frameCorners,
	frameOf,
	hitFrameHandle,
	needsFrame,
	oppositeCorner,
	rotationHandlePos,
} from "./selection-frame";

const base = { id: "e", authorId: "a", color: "#000", size: 4, z: 0 };
const rect = (
	a: [number, number],
	b: [number, number],
	rot?: number,
): Stroke => ({
	...base,
	kind: "rect",
	...(rot ? { rot } : {}),
	points: [
		[...a, 0.5],
		[...b, 0.5],
	],
});

const close = (a: number[], b: number[]) => {
	for (const [i, v] of a.entries()) expect(v).toBeCloseTo(b[i], 6);
};

describe("frameOf", () => {
	test("nothing selected, no frame", () => {
		expect(frameOf([])).toBeNull();
	});

	test("one element: its own box and rotation", () => {
		expect(frameOf([rect([0, 0], [100, 50], 0.5)])).toEqual({
			cx: 50,
			cy: 25,
			w: 100,
			h: 50,
			rot: 0.5,
		});
	});

	test("several elements: the upright box around all of them as they appear", () => {
		const f = frameOf([rect([0, 0], [10, 10]), rect([100, 40], [120, 60])]);
		expect(f).toEqual({ cx: 60, cy: 30, w: 120, h: 60, rot: 0 });
	});

	test("several elements account for their rotation", () => {
		const f = frameOf([
			rect([0, 0], [100, 50], Math.PI / 2),
			rect([200, 0], [210, 10]),
		]);
		expect(f?.rot).toBe(0);
		expect(f?.w).toBeCloseTo(210 - 25);
	});
});

describe("frameCorners", () => {
	test("an upright frame has its corners in nw, ne, se, sw order", () => {
		expect(frameCorners({ cx: 50, cy: 25, w: 100, h: 50, rot: 0 })).toEqual([
			[0, 0],
			[100, 0],
			[100, 50],
			[0, 50],
		]);
	});

	test("a rotated frame has rotated corners", () => {
		const c = frameCorners({ cx: 0, cy: 0, w: 20, h: 10, rot: Math.PI / 2 });
		close(c[0], [5, -10]); // the nw corner (-10, -5) turned a quarter turn
	});
});

describe("rotationHandlePos", () => {
	test("sits above the top edge of an upright frame", () => {
		close(
			rotationHandlePos({ cx: 50, cy: 25, w: 100, h: 50, rot: 0 }, 30),
			[50, -30],
		);
	});

	test("follows the frame's rotation", () => {
		// a quarter turn clockwise: "up" now points to the right
		close(
			rotationHandlePos({ cx: 0, cy: 0, w: 20, h: 10, rot: Math.PI / 2 }, 30),
			[5 + 30, 0],
		);
	});
});

describe("hitFrameHandle", () => {
	const f = { cx: 50, cy: 25, w: 100, h: 50, rot: 0 };

	test("finds corners", () => {
		expect(hitFrameHandle(f, [2, 1], 10, 30)).toBe("nw");
		expect(hitFrameHandle(f, [99, 2], 10, 30)).toBe("ne");
		expect(hitFrameHandle(f, [101, 49], 10, 30)).toBe("se");
		expect(hitFrameHandle(f, [-3, 52], 10, 30)).toBe("sw");
	});

	test("finds the rotation handle", () => {
		expect(hitFrameHandle(f, [50, -29], 10, 30)).toBe("rot");
	});

	test("finds nothing in the middle or far away", () => {
		expect(hitFrameHandle(f, [50, 25], 10, 30)).toBeNull();
		expect(hitFrameHandle(f, [400, 400], 10, 30)).toBeNull();
	});

	test("works on a rotated frame", () => {
		const turned = { cx: 0, cy: 0, w: 20, h: 10, rot: Math.PI / 2 };
		expect(hitFrameHandle(turned, [5, -10], 4, 30)).toBe("nw");
		expect(hitFrameHandle(turned, [35, 0], 4, 30)).toBe("rot");
	});
});

describe("oppositeCorner", () => {
	test("is the corner across the frame", () => {
		expect([
			oppositeCorner("nw"),
			oppositeCorner("ne"),
			oppositeCorner("se"),
			oppositeCorner("sw"),
		]).toEqual(["se", "sw", "nw", "ne"]);
	});
});

describe("needsFrame (R-034)", () => {
	const pt = (x: number, y: number) => [x, y, 0.5] as [number, number, number];
	const el = (kind?: Stroke["kind"]): Stroke => ({
		...base,
		...(kind ? { kind } : {}),
		points: [pt(0, 0), pt(10, 10)],
	});

	test("a lone stroke, line or text glows instead of getting a box", () => {
		expect(needsFrame([el()])).toBe(false);
		expect(needsFrame([el("line")])).toBe(false);
		expect(needsFrame([el("text")])).toBe(false);
	});

	test("images and shapes keep their frame with handles", () => {
		expect(needsFrame([el("image")])).toBe(true);
		expect(needsFrame([el("rect")])).toBe(true);
		expect(needsFrame([el("circle")])).toBe(true);
	});

	test("several elements always get a frame, and nothing selected needs none", () => {
		expect(needsFrame([el(), el("line")])).toBe(true);
		expect(needsFrame([])).toBe(false);
	});
});
