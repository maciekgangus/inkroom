import { describe, expect, test } from "vitest";
import { fitCamera } from "./camera";

describe("fitCamera (R-114)", () => {
	test("a window of the same shape shows exactly what the teacher saw", () => {
		const v = fitCamera({ cx: 400, cy: 300, rw: 800, rh: 600 }, 1600, 1200);
		expect(v.scale).toBe(2);
		expect(v.x).toBe(0);
		expect(v.y).toBe(0);
	});

	test("a wider window shows more at the sides, never less than was seen", () => {
		const v = fitCamera({ cx: 400, cy: 300, rw: 800, rh: 600 }, 1600, 600);
		expect(v.scale).toBe(1); // the height decides
		expect(v.x).toBe(-400); // 400 units more on each side
		expect(v.y).toBe(0);
	});

	test("keeps the centre where the teacher's was", () => {
		const v = fitCamera({ cx: 1000, cy: -500, rw: 400, rh: 300 }, 800, 600);
		expect(v.x + 800 / (2 * v.scale)).toBeCloseTo(1000, 6);
		expect(v.y + 600 / (2 * v.scale)).toBeCloseTo(-500, 6);
	});

	test("the zoom stays within what the board allows", () => {
		expect(fitCamera({ cx: 0, cy: 0, rw: 10, rh: 10 }, 1000, 1000).scale).toBe(
			5,
		);
		expect(
			fitCamera({ cx: 0, cy: 0, rw: 1e6, rh: 1e6 }, 1000, 1000).scale,
		).toBe(0.1);
	});
});
