import { describe, expect, test } from "vitest";
import type { Stroke } from "./board/board";
import {
	isVisible,
	panelTitle,
	pickSide,
	popoverSpot,
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

	test("it never stands under the column of tools down the left edge (R-082)", () => {
		const near = rect(100, 200, 300, 300);
		expect(sidePosition(near, size, view, "left").left).toBeLessThan(72);
		expect(sidePosition(near, size, view, "left", 72).left).toBe(72);
		// without room that is just the inset, with room the object's side wins
		expect(sidePosition(o, size, view, "right", 72).left).toBeGreaterThan(600);
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

	test("a coordinate plane is a graph (Wykres), not a shape", () => {
		expect(panelTitle([el("plane")])).toBe("Wykres");
		expect(panelTitle([el("plane"), el("plane")])).toBe("Wykres (2)");
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

describe("popoverSpot", () => {
	const view = { w: 1000, h: 800 };
	const size = { w: 240, h: 100 };
	const tile = { minX: 900, minY: 200, maxX: 940, maxY: 240 };

	test("stands on the left of a menu that is by the right edge, level with the tile", () => {
		const menu = { minX: 760, minY: 100, maxX: 1000 - 12, maxY: 500 };
		const spot = popoverSpot(tile, menu, size, view);
		expect(spot).not.toBeNull();
		expect(spot?.left).toBe(menu.minX - 8 - size.w);
		expect(spot?.top).toBe(tile.minY - 8);
	});

	test("stands on the right of a menu that is by the left edge", () => {
		const menu = { minX: 12, minY: 100, maxX: 266, maxY: 500 };
		const spot = popoverSpot(
			{ ...tile, minX: 200, maxX: 240 },
			menu,
			size,
			view,
		);
		expect(spot?.left).toBe(menu.maxX + 8);
	});

	test("flips to the other side when the preferred one has no room", () => {
		// The menu is in the right half but only 100px from the left edge: the left side is too narrow.
		const menu = { minX: 100, minY: 100, maxX: 600, maxY: 500 };
		const spot = popoverSpot(tile, menu, size, view);
		expect(spot?.left).toBe(menu.maxX + 8);
	});

	test("is null when there is no room on either side: it then stays inside the menu", () => {
		const menu = { minX: 100, minY: 100, maxX: 900, maxY: 500 };
		expect(popoverSpot(tile, menu, size, view)).toBeNull();
	});

	test("is kept on the screen vertically", () => {
		const menu = { minX: 760, minY: 100, maxX: 988, maxY: 790 };
		const low = { minX: 900, minY: 780, maxX: 940, maxY: 800 };
		expect(popoverSpot(low, menu, size, view)?.top).toBe(view.h - size.h - 8);
		const high = { minX: 900, minY: 0, maxX: 940, maxY: 20 };
		expect(popoverSpot(high, menu, size, view)?.top).toBe(8);
	});
});
