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

	test("the new shape is selected and the tool becomes Select, so it can be moved at once", () => {
		settings.shape = "rhombus";
		draw([300, 200]);
		expect(c.selection.map((s) => s.id)).toEqual([board.strokes[0].id]);
		expect(settings.tool).toBe("select");
		expect(settings.shape).toBe("rhombus"); // the choice is kept for the next one
	});

	test("a line is selected after drawing too", () => {
		settings.tool = "line";
		draw([300, 200]);
		expect(c.selection).toHaveLength(1);
		expect(settings.tool).toBe("select");
	});

	test("the shape just drawn can be dragged right away", () => {
		draw([300, 200]);
		c.pointerDown(ev(100, 120)); // on the left side, away from its middle handle
		c.pointerMove(ev(100, 220));
		c.pointerUp(ev(100, 220));
		expect(board.strokes[0].points[0][1]).toBeCloseTo(200);
	});

	test("freehand strokes and text are not selected: writing goes on", () => {
		settings.tool = "pen";
		draw([300, 200]);
		expect(c.selection).toEqual([]);
		expect(settings.tool).toBe("pen");
	});

	test("the next shape of the same kind is one pick of the tool away", () => {
		settings.shape = "rhombus";
		draw([300, 200]);
		settings.tool = "shape"; // what K does
		draw([500, 300]);
		expect(board.strokes.map((s) => s.kind)).toEqual(["rhombus", "rhombus"]);
	});

	test("a shape dragged upward keeps that direction, so it can be oriented", () => {
		settings.shape = "trapezoid";
		c.pointerDown(ev(100, 300));
		c.pointerMove(ev(300, 100));
		c.pointerUp(ev(300, 100));
		const [a, b] = board.strokes[0].points;
		expect(a[1]).toBeGreaterThan(b[1]); // the first corner is below the second
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

	test("starting a new drawing drops the selection at once", () => {
		draw([300, 200]); // selects the rectangle, the tool becomes Select
		expect(c.selection).toHaveLength(1);
		settings.tool = "shape";
		c.pointerDown(ev(500, 100));
		expect(c.selection).toEqual([]);
		c.pointerUp(ev(500, 100));
	});

	test.each(["pen", "line", "text"] as const)(
		"also with the %s tool",
		(tool) => {
			draw([300, 200]);
			settings.tool = tool;
			c.pointerDown(ev(500, 100));
			expect(c.selection).toEqual([]);
			c.pointerUp(ev(500, 100));
		},
	);

	test("the eraser and the hand leave the selection alone", () => {
		draw([300, 200]);
		for (const tool of ["eraser", "pan"] as const) {
			settings.tool = tool;
			c.pointerDown(ev(900, 900));
			expect(c.selection).toHaveLength(1);
			c.pointerUp(ev(900, 900));
		}
	});

	test("the pen draws the natural style when it is chosen, and the ordinary one otherwise (R-037)", () => {
		settings.tool = "pen";
		draw([300, 200]);
		expect(board.strokes[0].dash).toBeUndefined();
		settings.lineStyle = "natural";
		draw([400, 300]);
		expect(board.strokes[1].dash).toBe("natural");
	});

	test("lines and shapes take dashed or dotted, and ignore the natural pen (R-038)", () => {
		settings.lineStyle = "natural";
		draw([300, 200]); // a rectangle
		settings.tool = "line";
		draw([500, 300]);
		for (const s of board.strokes) expect(s.dash).toBeUndefined();
		for (const style of ["dashed", "dotted"] as const) {
			settings.lineStyle = style;
			settings.tool = "shape";
			draw([300, 200]);
			settings.tool = "line";
			draw([500, 300]);
		}
		expect(board.strokes.slice(2).map((s) => s.dash)).toEqual([
			"dashed",
			"dashed",
			"dotted",
			"dotted",
		]);
	});

	test("the pen ignores dashed and dotted, text takes no line style", () => {
		settings.tool = "pen";
		settings.lineStyle = "dashed";
		draw([300, 200]);
		expect(board.strokes[0].dash).toBeUndefined();
		c.addText("hi", 10, 10);
		expect(board.strokes[1].dash).toBeUndefined();
	});

	test("new elements get the opacity of the settings, and none at full opacity (R-038)", () => {
		settings.tool = "pen";
		draw([300, 200]);
		settings.opacity = 0.4;
		draw([400, 300]);
		c.addText("hi", 10, 10);
		expect(board.strokes[0].opacity).toBeUndefined();
		expect(board.strokes[1].opacity).toBe(0.4);
		expect(board.strokes[2].opacity).toBe(0.4);
	});
});
