import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import { findHit, objectHit, strokeHit } from "./hit";
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
		const img: Stroke = {
			id: "i",
			authorId: "a",
			color: "#000",
			size: 1,
			z: 0,
			kind: "image",
			src: "x",
			points: [
				[0, 0, 0.5],
				[200, 100, 0.5],
			],
		};
		expect(strokeHit(img, 100, 50, 10)).toBe(false);
		expect(strokeHit(img, 0, 0, 10)).toBe(false);
	});
});

describe("hit testing with rotation", () => {
	const base = { id: "r", authorId: "a", color: "#000", size: 4, z: 0 };
	// 100 x 50 at (0,0), turned a quarter turn around its centre (50, 25): it now covers x 25..75, y -25..75.
	const rotated: Stroke = {
		...base,
		kind: "rect",
		rot: Math.PI / 2,
		points: [
			[0, 0, 0.5],
			[100, 50, 0.5],
		],
	};

	test("the outline is where the rotated edges are", () => {
		expect(strokeHit(rotated, 75, 25, 4)).toBe(true); // the old top edge, now on the right
		expect(strokeHit(rotated, 50, -25, 4)).toBe(true); // the old right edge, now on top
	});

	test("the old, unrotated edge positions no longer hit", () => {
		expect(strokeHit(rotated, 50, 0, 4)).toBe(false);
	});

	test("a rotated line is hit along its new direction", () => {
		const line: Stroke = {
			...base,
			kind: "line",
			rot: Math.PI / 2,
			points: [
				[0, 0, 0.5],
				[100, 0, 0.5],
			],
		}; // turns about (50, 0)
		expect(strokeHit(line, 50, 40, 4)).toBe(true);
		expect(strokeHit(line, 90, 0, 4)).toBe(false);
	});
});

describe("objectHit (selecting by clicking)", () => {
	const base = { id: "o", authorId: "a", color: "#000", size: 4, z: 0 };

	test("a stroke is hit near its line, like the eraser", () => {
		const s: Stroke = {
			...base,
			points: [
				[0, 0, 0.5],
				[100, 0, 0.5],
			],
		};
		expect(objectHit(s, 50, 3, 4)).toBe(true);
		expect(objectHit(s, 50, 30, 4)).toBe(false);
	});

	test("an unfilled rectangle is hit on its edges only, a filled one anywhere inside", () => {
		const open: Stroke = {
			...base,
			kind: "rect",
			points: [
				[0, 0, 0.5],
				[100, 60, 0.5],
			],
		};
		const filled: Stroke = { ...open, fill: "#f00" };
		expect(objectHit(open, 50, 30, 4)).toBe(false);
		expect(objectHit(open, 50, 0, 4)).toBe(true);
		expect(objectHit(filled, 50, 30, 4)).toBe(true);
		expect(objectHit(filled, 200, 30, 4)).toBe(false);
	});

	test("a filled circle is hit anywhere inside, an open one on the outline", () => {
		const open: Stroke = {
			...base,
			kind: "circle",
			points: [
				[0, 0, 0.5],
				[50, 0, 0.5],
			],
		};
		const filled: Stroke = { ...open, fill: "#0f0" };
		expect(objectHit(open, 0, 0, 4)).toBe(false);
		expect(objectHit(filled, 0, 0, 4)).toBe(true);
		expect(objectHit(filled, 80, 0, 4)).toBe(false);
	});

	test("an image is hit anywhere inside (unlike with the eraser)", () => {
		const img: Stroke = {
			...base,
			kind: "image",
			src: "x",
			points: [
				[0, 0, 0.5],
				[200, 100, 0.5],
			],
		};
		expect(objectHit(img, 100, 50, 4)).toBe(true);
		expect(strokeHit(img, 100, 50, 4)).toBe(false);
		expect(objectHit(img, 300, 50, 4)).toBe(false);
	});

	test("a rotated image is hit where it now is", () => {
		const img: Stroke = {
			...base,
			kind: "image",
			src: "x",
			rot: Math.PI / 2,
			points: [
				[0, 0, 0.5],
				[200, 100, 0.5],
			],
		};
		// centre (100, 50): after the turn it covers x 50..150, y -50..150
		expect(objectHit(img, 100, 140, 4)).toBe(true);
		expect(objectHit(img, 20, 50, 4)).toBe(false); // inside the old box, outside the new one
	});

	test("text is hit inside its box", () => {
		const t: Stroke = {
			...base,
			kind: "text",
			text: "hello",
			size: 5,
			points: [[10, 10, 0.5]],
		};
		expect(objectHit(t, 20, 20, 4)).toBe(true);
		expect(objectHit(t, 500, 500, 4)).toBe(false);
	});
});

describe("ellipse hit testing", () => {
	const base = { id: "el", authorId: "a", color: "#000", size: 4, z: 0 };
	// box 200 x 100 at (0,0): centre (100, 50), radii 100 and 50
	const ellipse: Stroke = {
		...base,
		kind: "ellipse",
		points: [
			[0, 0, 0.5],
			[200, 100, 0.5],
		],
	};

	test("the outline is hit at its extremes", () => {
		expect(strokeHit(ellipse, 200, 50, 4)).toBe(true);
		expect(strokeHit(ellipse, 100, 0, 4)).toBe(true);
		expect(strokeHit(ellipse, 0, 50, 4)).toBe(true);
		expect(strokeHit(ellipse, 100, 100, 4)).toBe(true);
	});

	test("the middle and the corners of the box are not on the outline", () => {
		expect(strokeHit(ellipse, 100, 50, 4)).toBe(false);
		expect(strokeHit(ellipse, 2, 2, 4)).toBe(false);
	});

	test("a point well away is not hit", () => {
		expect(strokeHit(ellipse, 400, 400, 4)).toBe(false);
	});

	test("a drag from bottom-right to top-left is the same ellipse", () => {
		const flipped: Stroke = {
			...ellipse,
			points: [
				[200, 100, 0.5],
				[0, 0, 0.5],
			],
		};
		expect(strokeHit(flipped, 200, 50, 4)).toBe(true);
		expect(strokeHit(flipped, 100, 50, 4)).toBe(false);
	});

	test("a filled ellipse is selected anywhere inside, an open one only on its outline", () => {
		expect(objectHit(ellipse, 100, 50, 4)).toBe(false);
		expect(objectHit({ ...ellipse, fill: "#f00" }, 100, 50, 4)).toBe(true);
		expect(objectHit({ ...ellipse, fill: "#f00" }, 2, 2, 4)).toBe(false); // the box corner is outside the ellipse
	});

	test("a rotated ellipse is hit where it now is", () => {
		const turned: Stroke = { ...ellipse, rot: Math.PI / 2 }; // now 100 wide and 200 tall around (100, 50)
		expect(strokeHit(turned, 100, 150, 4)).toBe(true); // the old right extreme is now at the bottom
		expect(strokeHit(turned, 200, 50, 4)).toBe(false);
	});
});

describe("polygon shapes (R-033)", () => {
	const base = { id: "p", authorId: "a", color: "#000", size: 4, z: 0 };
	const rhombus = (fill?: string): Stroke => ({
		...base,
		kind: "rhombus",
		...(fill ? { fill } : {}),
		points: [
			[0, 0, 0.5],
			[100, 50, 0.5],
		],
	});

	test("the outline is hit along its sides, not along the box", () => {
		expect(strokeHit(rhombus(), 25, 12.5, 3)).toBe(true); // on the upper left side
		expect(strokeHit(rhombus(), 0, 0, 3)).toBe(false); // the box corner is empty
		expect(strokeHit(rhombus(), 50, 25, 3)).toBe(false); // an empty inside
	});

	test("a filled one is hit anywhere inside, but not in the corners of its box", () => {
		expect(objectHit(rhombus("#fcc"), 50, 25, 3)).toBe(true);
		expect(objectHit(rhombus("#fcc"), 3, 2, 3)).toBe(false);
		expect(objectHit(rhombus(), 50, 25, 3)).toBe(false); // empty: only its outline
	});

	test("a turned polygon is hit where it now is", () => {
		const turned = { ...rhombus("#fcc"), rot: Math.PI / 2 };
		expect(objectHit(turned, 50, 25, 3)).toBe(true); // the centre stays
		expect(objectHit(turned, 50, -5, 3)).toBe(true); // now reaches higher than before
	});
});
