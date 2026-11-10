import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board, type Stroke } from "./board";
import {
	Controller,
	type PointerInput,
	type Renderer,
	type Settings,
} from "./controller";
import { Viewport } from "./viewport";

const ev = (type: string, x: number, y: number, button = 0): PointerInput => ({
	pointerId: 1,
	pointerType: type,
	clientX: x,
	clientY: y,
	pressure: 0.5,
	button,
});

describe("Controller mouse buttons (R-029)", () => {
	let board: Board;
	let viewport: Viewport;
	let settings: Settings;
	let c: Controller;
	let clicks: [number, number][];

	beforeEach(() => {
		board = new Board();
		const renderer: Renderer = { drawLive: vi.fn(), redraw: vi.fn() };
		viewport = new Viewport();
		settings = { tool: "pen", color: "#111", size: 4 };
		let n = 0;
		c = new Controller(
			board,
			renderer,
			settings,
			viewport,
			"me",
			() => `e${++n}`,
		);
		clicks = [];
		c.onRightClick = (e) => clicks.push([e.clientX, e.clientY]);
	});

	const drag = (button: number, to: [number, number]) => {
		c.pointerDown(ev("mouse", 100, 100, button));
		c.pointerMove(ev("mouse", ...to, button));
		c.pointerUp(ev("mouse", ...to, button));
	};

	test("the right button never draws, whatever the tool", () => {
		for (const tool of ["pen", "line", "rect", "circle"] as const) {
			settings.tool = tool;
			drag(2, [300, 200]);
		}
		expect(board.strokes).toEqual([]);
	});

	test("the right button never selects or moves objects", () => {
		const rect: Stroke = {
			id: "r",
			authorId: "a",
			color: "#111",
			size: 4,
			z: 1,
			kind: "rect",
			fill: "#fcc",
			points: [
				[50, 50, 0.5],
				[200, 200, 0.5],
			],
		};
		board.addStroke(rect);
		settings.tool = "select";
		drag(2, [160, 160]);
		expect(c.selection).toEqual([]);
		expect(board.strokes[0].points).toEqual(rect.points);
	});

	test("dragging with the right button pans the view and keeps the tool", () => {
		settings.tool = "pen";
		drag(2, [160, 130]);
		expect(viewport.x).toBeCloseTo(-60);
		expect(viewport.y).toBeCloseTo(-30);
		expect(settings.tool).toBe("pen");
		expect(clicks).toEqual([]);
	});

	test("a right press released without moving is a click, a small wobble still counts", () => {
		drag(2, [100, 100]);
		drag(2, [102, 103]);
		expect(clicks).toEqual([
			[100, 100],
			[102, 103],
		]);
	});

	test("buttons other than left, middle and right do nothing", () => {
		for (const b of [3, 4, 5]) drag(b, [300, 200]);
		expect(board.strokes).toEqual([]);
		expect(viewport.x).toBe(0);
		expect(clicks).toEqual([]);
	});

	test("the left button still draws, and a missing button counts as left", () => {
		drag(0, [300, 200]);
		c.pointerDown({ ...ev("mouse", 10, 10), button: undefined });
		c.pointerUp({ ...ev("mouse", 10, 10), button: undefined });
		expect(board.strokes).toHaveLength(2);
		expect(clicks).toEqual([]);
	});

	test("panning reports true only while a pan is in progress", () => {
		expect(c.panning).toBe(false);
		c.pointerDown(ev("mouse", 10, 10, 2));
		expect(c.panning).toBe(true);
		c.pointerUp(ev("mouse", 10, 10, 2));
		expect(c.panning).toBe(false);
		settings.tool = "pen";
		c.pointerDown(ev("mouse", 10, 10, 0));
		expect(c.panning).toBe(false);
	});
});
