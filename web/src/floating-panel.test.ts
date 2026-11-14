import { describe, expect, test } from "vitest";
import type { Stroke } from "./board/board";
import {
	isVisible,
	panelTitle,
	pickSide,
	sidePosition,
} from "./floating-panel";

const view = { w: 1500, h: 800 };
const size = { w: 280, h: 200 };
const rect = (minX: number, minY: number, maxX: number, maxY: number) => ({
	minX,
	minY,
	maxX,
	maxY,
});

describe("where the menu and its tile stand (R-060)", () => {
	const o = rect(400, 200, 600, 300);

	test("on the right of the object, level with its top, clear of the handles", () => {
		const p = sidePosition(o, size, view, "right");
		expect(p.left).toBeGreaterThan(600 + 16);
		expect(p.left).toBeLessThan(600 + 60);
		expect(p.top).toBe(200);
	});

	test("on the left, the right edge of the menu is as far from the object", () => {
		const r = sidePosition(o, size, view, "right");
		const l = sidePosition(o, size, view, "left");
		expect(400 - (l.left + size.w)).toBeCloseTo(r.left - 600);
	});

	test("the side is the right one unless there is no room for the menu there", () => {
		expect(pickSide(o, size.w, view)).toBe("right");
		expect(pickSide(rect(1200, 200, 1400, 300), size.w, view)).toBe("left");
	});

	test("it follows the object sideways, but is kept on the screen so that it can be reached", () => {
		const p = sidePosition(rect(430, 200, 630, 300), size, view, "right");
		expect(p.left).toBe(670);
		const q = sidePosition(rect(1400, 200, 1600, 300), size, view, "right");
		expect(q.left + size.w).toBeLessThanOrEqual(view.w);
		const r = sidePosition(rect(-300, 200, 100, 300), size, view, "left");
		expect(r.left).toBeGreaterThanOrEqual(0);
	});

	test("up and down it is kept on the screen and under the top bar", () => {
		const high = sidePosition(rect(400, -500, 600, -100), size, view, "right");
		expect(high.top).toBeGreaterThanOrEqual(64);
		const low = sidePosition(rect(400, 700, 600, 2000), size, view, "right");
		expect(low.top + size.h).toBeLessThanOrEqual(view.h);
	});

	test("it is gone with an object that is no longer on the screen", () => {
		expect(isVisible(o, view)).toBe(true);
		expect(isVisible(rect(400, 700, 600, 2000), view)).toBe(true);
		expect(isVisible(rect(1600, 200, 1800, 300), view)).toBe(false);
		expect(isVisible(rect(400, -500, 600, -10), view)).toBe(false);
	});
});

describe("panelTitle", () => {
	const el = (kind?: Stroke["kind"]): Stroke => ({
		id: "e",
		authorId: "a",
		color: "#000",
		size: 4,
		z: 1,
		...(kind ? { kind } : {}),
		points: [
			[0, 0, 0.5],
			[10, 10, 0.5],
		],
	});

	test("names the class of a single object", () => {
		expect(panelTitle([el("text")])).toBe("Tekst");
		expect(panelTitle([el("line")])).toBe("Linia");
		expect(panelTitle([el("image")])).toBe("Obraz");
		expect(panelTitle([el()])).toBe("Rysunek");
		for (const k of [
			"rect",
			"ellipse",
			"triangle",
			"cube",
			"sine",
			"cosine",
			"axes",
		] as const)
			expect(panelTitle([el(k)])).toBe("Kształt");
	});

	test("several objects of one class are counted, a mix is just a selection", () => {
		expect(panelTitle([el("text"), el("text")])).toBe("Tekst (2)");
		expect(panelTitle([el("text"), el("line"), el("rect")])).toBe(
			"Zaznaczenie (3)",
		);
	});

	test("nothing, nothing to name", () => {
		expect(panelTitle([])).toBe("");
	});
});
