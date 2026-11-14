import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import { strokeBounds } from "./bounds";
import { geomBox, worldBounds } from "./transform";

/** A stroke whose points array counts how many times it is walked through. */
function counted(points: [number, number, number][]) {
	const reads = { n: 0 };
	const arr = new Proxy(points, {
		get(t, k, r) {
			if (k === Symbol.iterator) reads.n++;
			return Reflect.get(t, k, r);
		},
	});
	const s: Stroke = {
		id: "s",
		authorId: "a",
		color: "#111",
		size: 2,
		z: 1,
		points: arr,
	};
	return { s, reads };
}

describe("bounds of an element are counted once", () => {
	test("however often they are asked for (the pointer asks at every move)", () => {
		const { s, reads } = counted([
			[0, 0, 0.5],
			[10, 20, 0.5],
			[5, 5, 0.5],
		]);
		const a = worldBounds(s);
		for (let i = 0; i < 50; i++) {
			worldBounds(s);
			geomBox(s);
			strokeBounds(s);
		}
		expect(a).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 20 });
		expect(reads.n).toBeLessThanOrEqual(2); // one walk for the box, one for the padded box
	});

	test("a stroke that is still being drawn grows its box", () => {
		const { s } = counted([
			[0, 0, 0.5],
			[1, 1, 0.5],
		]);
		expect(geomBox(s).maxX).toBe(1);
		s.points.push([50, 3, 0.5]); // the pen goes on
		expect(geomBox(s).maxX).toBe(50);
		expect(strokeBounds(s).maxX).toBe(52);
	});
});
