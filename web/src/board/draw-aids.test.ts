import { describe, expect, test } from "vitest";
import { constrainEnd } from "./draw-aids";

const deg = (d: number) => (d * Math.PI) / 180;
const close = (a: number[], b: number[]) => {
	for (const [i, v] of a.entries()) expect(v).toBeCloseTo(b[i], 6);
};
/** The end of a segment of the given length and angle (degrees, clockwise from the right, y down). */
const polar = (start: [number, number], len: number, angleDeg: number): [number, number] => [
	start[0] + len * Math.cos(deg(angleDeg)),
	start[1] + len * Math.sin(deg(angleDeg)),
];

describe("constrainEnd without Shift", () => {
	test("leaves every kind of shape as dragged", () => {
		for (const kind of ["line", "rect", "ellipse"] as const) {
			expect(constrainEnd(kind, [10, 10], [57, 23], false)).toEqual([57, 23]);
		}
	});
});

describe("line with Shift snaps to 15 degree steps", () => {
	const start: [number, number] = [100, 100];

	test("keeps the length and moves the angle to the nearest multiple of 15", () => {
		const end = constrainEnd("line", start, polar(start, 200, 20), true); // 20 -> 15
		close(end, polar(start, 200, 15));
		close(constrainEnd("line", start, polar(start, 200, 27), true), polar(start, 200, 30));
		close(constrainEnd("line", start, polar(start, 200, 40), true), polar(start, 200, 45));
		close(constrainEnd("line", start, polar(start, 200, 58), true), polar(start, 200, 60));
		close(constrainEnd("line", start, polar(start, 200, 80), true), polar(start, 200, 75));
	});

	test("snaps near-horizontal and near-vertical lines onto the axes", () => {
		close(constrainEnd("line", start, [300, 105], true), [100 + Math.hypot(200, 5), 100]);
		const v = constrainEnd("line", start, [104, 400], true);
		close(v, [100, 100 + Math.hypot(4, 300)]);
	});

	test("works in every direction", () => {
		close(constrainEnd("line", start, polar(start, 150, 100), true), polar(start, 150, 105)); // down-left side
		close(constrainEnd("line", start, polar(start, 150, -100), true), polar(start, 150, -105));
		close(constrainEnd("line", start, polar(start, 150, 178), true), polar(start, 150, 180));
	});

	test("a zero-length line stays put", () => {
		expect(constrainEnd("line", start, [100, 100], true)).toEqual([100, 100]);
	});

	test("an angle already on a step is unchanged", () => {
		for (const a of [0, 15, 30, 45, 60, 75, 90, -45, 135, 180]) {
			close(constrainEnd("line", start, polar(start, 120, a), true), polar(start, 120, a));
		}
	});
});

describe("rectangle and ellipse with Shift become a square and a circle", () => {
	test("the side is the larger of the two distances, in the dragged direction", () => {
		for (const kind of ["rect", "ellipse"] as const) {
			expect(constrainEnd(kind, [10, 10], [110, 50], true)).toEqual([110, 110]);
			expect(constrainEnd(kind, [10, 10], [40, 90], true)).toEqual([90, 90]);
			expect(constrainEnd(kind, [200, 200], [100, 190], true)).toEqual([100, 100]); // up-left
			expect(constrainEnd(kind, [200, 200], [260, 100], true)).toEqual([300, 100]); // up-right
			expect(constrainEnd(kind, [200, 200], [150, 290], true)).toEqual([110, 290]); // down-left
		}
	});

	test("a drag along one axis only still gives a square", () => {
		expect(constrainEnd("rect", [0, 0], [50, 0], true)).toEqual([50, 50]);
	});
});
