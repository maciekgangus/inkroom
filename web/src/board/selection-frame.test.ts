import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import {
	edgePos,
	frameCorners,
	frameOf,
	hitFrameHandle,
	oppositeCorner,
	oppositeEdge,
	pointInFrame,
	rotationHandlePos,
	showsBox,
} from "./selection-frame";
import { rotateEl } from "./transform";

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

describe("showsBox (R-034)", () => {
	const pt = (x: number, y: number) => [x, y, 0.5] as [number, number, number];
	const el = (kind?: Stroke["kind"]): Stroke => ({
		...base,
		...(kind ? { kind } : {}),
		points: [pt(0, 0), pt(10, 10)],
	});

	test("a lone stroke or text has handles but no outline box, it glows", () => {
		expect(showsBox([el()])).toBe(false);
		expect(showsBox([el("text")])).toBe(false);
	});

	test("a text area keeps its box, a text at a point does not (R-044)", () => {
		expect(showsBox([{ ...el("text"), width: 200 }])).toBe(true);
		expect(showsBox([el("text")])).toBe(false);
	});

	test("a line keeps its box: the dots at its ends come in addition to it (R-041)", () => {
		expect(showsBox([el("line")])).toBe(true);
	});

	test("images and shapes keep the outline box", () => {
		expect(showsBox([el("image")])).toBe(true);
		expect(showsBox([el("rect")])).toBe(true);
		expect(showsBox([el("circle")])).toBe(true);
		expect(showsBox([el("ellipse")])).toBe(true);
		for (const k of ["trapezoid", "rhombus", "parallelogram"] as const)
			expect(showsBox([el(k)])).toBe(true);
	});

	test("several elements get the outline box, and nothing selected shows none", () => {
		expect(showsBox([el(), el("line")])).toBe(true);
		expect(showsBox([])).toBe(false);
	});
});

describe("pointInFrame", () => {
	const f = { cx: 100, cy: 100, w: 80, h: 40, rot: 0 };

	test("is true inside the frame and false outside", () => {
		expect(pointInFrame(f, [100, 100])).toBe(true);
		expect(pointInFrame(f, [60, 80])).toBe(true); // a corner
		expect(pointInFrame(f, [59, 100])).toBe(false);
		expect(pointInFrame(f, [100, 121])).toBe(false);
	});

	test("follows the rotation of the frame", () => {
		const turned = { ...f, rot: Math.PI / 2 }; // now 40 wide and 80 tall on the board
		expect(pointInFrame(turned, [100, 135])).toBe(true);
		expect(pointInFrame(turned, [135, 100])).toBe(false);
	});
});

describe("frameOf with a group rotation", () => {
	const a = rect([100, 100], [300, 200]);
	const b = rect([400, 100], [450, 150]);

	test("a turned group keeps the size of its frame and the frame turns with it", () => {
		const before = frameOf([a, b]);
		if (!before) throw new Error("no frame");
		const pivot: [number, number] = [before.cx, before.cy];
		const delta = 0.6;
		const turned = [a, b].map((e) => rotateEl(e, pivot, delta));
		const after = frameOf(turned, delta);
		if (!after) throw new Error("no frame");
		expect(after.w).toBeCloseTo(before.w);
		expect(after.h).toBeCloseTo(before.h);
		expect(after.cx).toBeCloseTo(before.cx);
		expect(after.cy).toBeCloseTo(before.cy);
		expect(after.rot).toBeCloseTo(delta);
	});

	test("without a rotation it is the upright box, as before", () => {
		expect(frameOf([a, b], 0)).toEqual(frameOf([a, b]));
	});
});

describe("edge handles (R-041)", () => {
	const f = { cx: 100, cy: 100, w: 80, h: 40, rot: 0 };

	test("sit in the middle of each side", () => {
		expect(edgePos(f, "n")).toEqual([100, 80]);
		expect(edgePos(f, "e")).toEqual([140, 100]);
		expect(edgePos(f, "s")).toEqual([100, 120]);
		expect(edgePos(f, "w")).toEqual([60, 100]);
	});

	test("turn with a turned frame", () => {
		const turned = { ...f, rot: Math.PI / 2 }; // the east side is now the bottom one
		const e = edgePos(turned, "e");
		expect(e[0]).toBeCloseTo(100);
		expect(e[1]).toBeCloseTo(140);
	});

	test("are grabbed within the radius, and name the side", () => {
		expect(hitFrameHandle(f, [140, 103], 6, 30)).toBe("e");
		expect(hitFrameHandle(f, [100, 117], 6, 30)).toBe("s");
		expect(hitFrameHandle(f, [100, 100], 6, 30)).toBeNull(); // the inside is not a handle
	});

	test("lose to a corner when both are in reach", () => {
		const f2 = { cx: 0, cy: 0, w: 20, h: 20, rot: 0 };
		// 4 from the south east corner, 6 from the middle of the east side
		expect(hitFrameHandle(f2, [10, 6], 12, 30)).toBe("se");
	});

	test("the opposite of a side is the side across", () => {
		expect([
			oppositeEdge("n"),
			oppositeEdge("e"),
			oppositeEdge("s"),
			oppositeEdge("w"),
		]).toEqual(["s", "w", "n", "e"]);
	});
});
