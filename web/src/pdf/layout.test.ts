import { describe, expect, test } from "vitest";
import { GAP, PAGE_WIDTH, pageRect, startPoint } from "./layout";

describe("pages one under another (ADR 0015)", () => {
	test("a page is 900 units wide and as tall as its shape says", () => {
		expect(PAGE_WIDTH).toBe(900);
		const r = pageRect([10, 20], 2000, 2828); // an A4 page as rendered
		expect(r.minX).toBe(10);
		expect(r.minY).toBe(20);
		expect(r.maxX - r.minX).toBe(900);
		expect(r.maxY - r.minY).toBeCloseTo((900 * 2828) / 2000);
	});

	test("the next page starts under the last one, with a gap of 24 units", () => {
		expect(GAP).toBe(24);
		const first = pageRect([0, 0], 1000, 1000);
		const second = pageRect([0, first.maxY + GAP], 1000, 500);
		expect(second.minY).toBe(first.maxY + 24);
	});

	test("the first page goes to the top left of the view, with a margin", () => {
		const [x, y] = startPoint({ minX: -300, minY: 120, maxX: 700, maxY: 900 });
		expect(x).toBe(-300 + 40);
		expect(y).toBe(120 + 40);
	});
});
