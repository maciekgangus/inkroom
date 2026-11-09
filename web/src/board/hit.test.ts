import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import { findHit, strokeHit } from "./hit";

function line(id: string, pts: [number, number][], size = 4): Stroke {
	return {
		id,
		authorId: "a",
		color: "#111",
		size,
		points: pts.map(([x, y]) => [x, y, 0.5]),
	};
}

describe("strokeHit", () => {
	const s = line("1", [
		[0, 0],
		[100, 0],
	]);

	test("hits on the line", () => {
		expect(strokeHit(s, 50, 0, 1)).toBe(true);
	});

	test("hits within radius plus half the stroke size", () => {
		expect(strokeHit(s, 50, 10, 8)).toBe(true); // 10 <= 8 + 2
	});

	test("misses beyond the radius", () => {
		expect(strokeHit(s, 50, 20, 8)).toBe(false);
	});

	test("measures distance to the segment end, not the infinite line", () => {
		expect(strokeHit(s, 150, 0, 8)).toBe(false);
		expect(strokeHit(s, 105, 0, 8)).toBe(true);
	});

	test("handles a single-point stroke", () => {
		const dot = line("d", [[10, 10]]);
		expect(strokeHit(dot, 12, 10, 4)).toBe(true);
		expect(strokeHit(dot, 30, 10, 4)).toBe(false);
	});
});

describe("findHit", () => {
	test("returns the topmost (last drawn) stroke under the eraser", () => {
		const a = line("a", [
			[0, 0],
			[100, 0],
		]);
		const b = line("b", [
			[0, 0],
			[100, 0],
		]);
		expect(findHit([a, b], 50, 0, 4)?.id).toBe("b");
	});

	test("returns undefined when nothing is hit", () => {
		const a = line("a", [
			[0, 0],
			[100, 0],
		]);
		expect(findHit([a], 50, 50, 4)).toBeUndefined();
	});
});
