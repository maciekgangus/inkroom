import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import { findHit, strokeHit } from "./hit";
import { textBox } from "./text";

function line(id: string, pts: [number, number][], size = 4): Stroke {
	return {
		id,
		authorId: "a",
		color: "#111",
		size,
		z: 0,
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

describe("strokeHit for shapes and text", () => {
	const base = { id: "s", authorId: "a", color: "#111", size: 4, z: 0 };
	const rect: Stroke = {
		...base,
		kind: "rect",
		points: [
			[0, 0, 0.5],
			[100, 60, 0.5],
		],
	};
	const circle: Stroke = {
		...base,
		kind: "circle",
		points: [
			[0, 0, 0.5],
			[50, 0, 0.5],
		],
	}; // r = 50
	const textEl: Stroke = {
		...base,
		kind: "text",
		text: "hello",
		size: 5,
		points: [[10, 10, 0.5]],
	};

	test("a line is hit like a segment", () => {
		const line: Stroke = {
			...base,
			kind: "line",
			points: [
				[0, 0, 0.5],
				[100, 0, 0.5],
			],
		};
		expect(strokeHit(line, 50, 3, 4)).toBe(true);
		expect(strokeHit(line, 50, 30, 4)).toBe(false);
	});

	test("a rectangle is hit on its edges, not inside", () => {
		expect(strokeHit(rect, 50, 0, 4)).toBe(true); // top edge
		expect(strokeHit(rect, 100, 30, 4)).toBe(true); // right edge
		expect(strokeHit(rect, 0, 60, 4)).toBe(true); // corner
		expect(strokeHit(rect, 50, 30, 4)).toBe(false); // the middle
		expect(strokeHit(rect, 200, 30, 4)).toBe(false); // outside
	});

	test("a rectangle dragged from bottom-right to top-left is the same rectangle", () => {
		const flipped: Stroke = {
			...rect,
			points: [
				[100, 60, 0.5],
				[0, 0, 0.5],
			],
		};
		expect(strokeHit(flipped, 50, 0, 4)).toBe(true);
		expect(strokeHit(flipped, 50, 30, 4)).toBe(false);
	});

	test("a circle is hit on its outline, not at the centre", () => {
		expect(strokeHit(circle, 50, 0, 4)).toBe(true);
		expect(strokeHit(circle, 0, 51, 4)).toBe(true);
		expect(strokeHit(circle, 0, 0, 4)).toBe(false);
		expect(strokeHit(circle, 80, 0, 4)).toBe(false);
	});

	test("text is hit anywhere inside its box", () => {
		const box = textBox(textEl);
		expect(
			strokeHit(
				textEl,
				(box.minX + box.maxX) / 2,
				(box.minY + box.maxY) / 2,
				4,
			),
		).toBe(true);
		expect(strokeHit(textEl, box.maxX + 100, box.maxY + 100, 4)).toBe(false);
	});
});

describe("images and the eraser", () => {
	test("the eraser never hits an image, so writing over a photo cannot delete it", () => {
		const img: Stroke = { id: "i", authorId: "a", color: "#000", size: 1, z: 0, kind: "image", src: "x", points: [[0, 0, 0.5], [200, 100, 0.5]] };
		expect(strokeHit(img, 100, 50, 10)).toBe(false);
		expect(strokeHit(img, 0, 0, 10)).toBe(false);
	});
});
