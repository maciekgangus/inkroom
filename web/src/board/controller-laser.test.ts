import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board, type Stroke } from "./board";
import {
	Controller,
	type PointerInput,
	type Renderer,
	type Settings,
} from "./controller";
import { Viewport } from "./viewport";

const ev = (
	x: number,
	y: number,
	extra: Partial<PointerInput> = {},
): PointerInput => ({
	pointerId: 1,
	pointerType: "mouse",
	clientX: x,
	clientY: y,
	pressure: 0.5,
	button: 0,
	...extra,
});

describe("the laser pointer tool", () => {
	let board: Board;
	let c: Controller;
	let seen: { p: [number, number]; start: boolean }[];
	let redraw: ReturnType<typeof vi.fn<(strokes: Stroke[]) => void>>;

	beforeEach(() => {
		board = new Board();
		redraw = vi.fn<(strokes: Stroke[]) => void>();
		const renderer: Renderer = { drawLive: vi.fn(), redraw };
		const settings: Settings = { tool: "laser", color: "#111", size: 4 };
		let n = 0;
		c = new Controller(
			board,
			renderer,
			settings,
			new Viewport(),
			"me",
			() => `e${++n}`,
		);
		seen = [];
		c.onLaser = (p, start) => void seen.push({ p, start });
	});

	test("pressing starts a trail and moving carries on, in board coordinates", () => {
		c.pointerDown(ev(10, 20));
		c.pointerMove(ev(15, 25));
		c.pointerMove(ev(30, 40));
		expect(seen).toEqual([
			{ p: [10, 20], start: true },
			{ p: [15, 25], start: false },
			{ p: [30, 40], start: false },
		]);
	});

	test("it leaves nothing on the board, and no history to undo", () => {
		c.pointerDown(ev(10, 20));
		c.pointerMove(ev(100, 100));
		c.pointerUp(ev(100, 100));
		expect(board.strokes).toEqual([]);
		expect(board.undo("me")).toBe(false);
	});

	test("without a press the pointer only hovers: no trail", () => {
		c.pointerMove(ev(15, 25));
		expect(seen).toEqual([]);
	});

	test("after the release the trail stops, and a new press starts another", () => {
		c.pointerDown(ev(1, 1));
		c.pointerUp(ev(1, 1));
		c.pointerMove(ev(5, 5));
		expect(seen).toHaveLength(1);
		c.pointerDown(ev(8, 8));
		expect(seen[1]).toEqual({ p: [8, 8], start: true });
	});

	test("it works also when drawing was taken away: pointing is not drawing", () => {
		c.readOnly = true;
		c.pointerDown(ev(1, 1));
		c.pointerMove(ev(2, 2));
		expect(seen).toHaveLength(2);
	});

	test("it does not drop the selection", () => {
		const select = vi.spyOn(c, "select");
		c.pointerDown(ev(1, 1));
		expect(select).not.toHaveBeenCalled();
	});
});
