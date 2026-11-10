import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board } from "./board";
import {
	Controller,
	type PointerInput,
	type Renderer,
	type Settings,
} from "./controller";
import { Viewport } from "./viewport";

const ev = (x: number, y: number, shiftKey = false): PointerInput => ({
	pointerId: 1,
	pointerType: "mouse",
	clientX: x,
	clientY: y,
	pressure: 0.5,
	button: 0,
	shiftKey,
});

describe("the shape tool (R-033)", () => {
	let board: Board;
	let settings: Settings;
	let c: Controller;
	const draw = (to: [number, number], shift = false) => {
		c.pointerDown(ev(100, 100));
		c.pointerMove(ev(...to, shift));
		c.pointerUp(ev(...to, shift));
	};

	beforeEach(() => {
		board = new Board();
		const renderer: Renderer = { drawLive: vi.fn(), redraw: vi.fn() };
		settings = { tool: "shape", color: "#111", size: 4 };
		let n = 0;
		c = new Controller(
			board,
			renderer,
			settings,
			new Viewport(),
			"me",
			() => `e${++n}`,
		);
	});

	test("draws a rectangle unless another shape was chosen", () => {
		draw([300, 200]);
		expect(board.strokes[0].kind).toBe("rect");
	});

	test.each([
		["ellipse"],
		["trapezoid"],
		["rhombus"],
		["parallelogram"],
	] as const)("draws the chosen %s from two corners", (shape) => {
		settings.shape = shape;
		draw([300, 200]);
		expect(board.strokes[0].kind).toBe(shape);
		expect(board.strokes[0].points.map((p) => [p[0], p[1]])).toEqual([
			[100, 100],
			[300, 200],
		]);
	});

	test("can draw many shapes in a row without choosing again", () => {
		settings.shape = "rhombus";
		draw([300, 200]);
		draw([400, 250]);
		expect(board.strokes.map((s) => s.kind)).toEqual(["rhombus", "rhombus"]);
		expect(settings.tool).toBe("shape");
	});

	test("with Shift every shape gets a square box", () => {
		for (const shape of [
			"rect",
			"ellipse",
			"trapezoid",
			"rhombus",
			"parallelogram",
		] as const) {
			settings.shape = shape;
			draw([300, 160], true);
		}
		for (const s of board.strokes) {
			const [a, b] = s.points;
			expect(Math.abs(b[0] - a[0])).toBe(Math.abs(b[1] - a[1]));
		}
	});

	test("a click without dragging draws nothing", () => {
		settings.shape = "rhombus";
		draw([100, 100]);
		expect(board.strokes).toEqual([]);
	});

	test("the line tool still draws lines", () => {
		settings.tool = "line";
		draw([300, 200]);
		expect(board.strokes[0].kind).toBe("line");
	});
});
