import { describe, expect, test } from "vitest";
import type { Stroke } from "./board/board";
import { panelPosition, panelTitle } from "./floating-panel";

const view = { w: 1500, h: 800 };
const size = { w: 280, h: 200 };
const rect = (minX: number, minY: number, maxX: number, maxY: number) => ({
	minX,
	minY,
	maxX,
	maxY,
});

describe("panelPosition (R-042)", () => {
	test("sits below the object, centred on it", () => {
		const p = panelPosition(rect(400, 200, 600, 300), size, view);
		expect(p).toMatchObject({ left: 360, top: 312, placement: "below" });
	});

	test("goes above when there is no room below", () => {
		const p = panelPosition(rect(400, 560, 600, 700), size, view);
		expect(p).toMatchObject({ top: 560 - 48 - 200, placement: "above" });
	});

	test("never leaves the screen sideways", () => {
		expect(panelPosition(rect(0, 200, 40, 300), size, view).left).toBe(8);
		expect(panelPosition(rect(1470, 200, 1500, 300), size, view).left).toBe(
			1500 - 280 - 8,
		);
	});

	test("does not cover the top bar when it goes above", () => {
		// below does not fit and above would start at 20, over the bar: it falls back instead
		const p = panelPosition(rect(400, 232, 600, 700), size, view);
		expect(p.placement).toBe("fallback");
	});

	test("an object as big as the screen gets the panel at the bottom middle", () => {
		const p = panelPosition(rect(-500, -500, 2000, 2000), size, view);
		expect(p).toEqual({
			left: (1500 - 280) / 2,
			top: 800 - 200 - 8,
			placement: "fallback",
		});
	});

	test("an object that is only partly on screen is judged by the part that is", () => {
		// the object ends far below the screen: its visible part reaches the bottom
		const p = panelPosition(rect(400, 100, 600, 5000), size, view);
		expect(p.placement).not.toBe("below");
	});

	test("an object off to one side still gets a panel on screen", () => {
		const p = panelPosition(rect(-900, 200, -600, 300), size, view);
		expect(p.left).toBe(8);
		expect(p.top).toBe(312);
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
