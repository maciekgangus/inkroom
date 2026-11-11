import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board } from "./board";
import {
	Controller,
	type PointerInput,
	type Renderer,
	type Settings,
} from "./controller";
import { Viewport } from "./viewport";

const ev = (x: number, y: number): PointerInput => ({
	pointerId: 1,
	pointerType: "mouse",
	clientX: x,
	clientY: y,
	pressure: 0.5,
	button: 0,
});

describe("Controller when the owner took away drawing (R-016)", () => {
	let board: Board;
	let viewport: Viewport;
	let settings: Settings;
	let c: Controller;

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
	});

	test("a drag moves the view instead of drawing, whatever the tool", () => {
		c.readOnly = true;
		for (const tool of ["pen", "line", "shape", "eraser", "select"] as const) {
			settings.tool = tool;
			c.pointerDown(ev(100, 100));
			c.pointerMove(ev(40, 60));
			c.pointerUp(ev(40, 60));
		}
		expect(board.strokes).toEqual([]);
		expect(viewport.x).toBeGreaterThan(0);
	});

	test("what was drawn before stays, and undo, delete and paste do nothing", () => {
		c.pointerDown(ev(10, 10));
		c.pointerMove(ev(80, 80));
		c.pointerUp(ev(80, 80));
		expect(board.strokes).toHaveLength(1);
		c.readOnly = true;
		c.undo();
		expect(c.deleteSelected()).toBe(false);
		expect(c.paste()).toEqual([]);
		expect(board.strokes).toHaveLength(1);
	});

	test("drawing works again once the right is given back", () => {
		c.readOnly = true;
		c.readOnly = false;
		c.pointerDown(ev(10, 10));
		c.pointerMove(ev(80, 80));
		c.pointerUp(ev(80, 80));
		expect(board.strokes).toHaveLength(1);
	});
});
