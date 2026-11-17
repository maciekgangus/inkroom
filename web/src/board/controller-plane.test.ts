import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board, type Stroke } from "./board";
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

describe("the coordinate plane tool (R-084)", () => {
	let board: Board;
	let settings: Settings;
	let renderer: Renderer;
	let viewport: Viewport;
	let c: Controller;
	const corners = () =>
		board.strokes[0].points.map((p) => [p[0], p[1]] as [number, number]);
	const drag = (from: [number, number], to: [number, number]) => {
		c.pointerDown(ev(...from));
		c.pointerMove(ev(...to));
		c.pointerUp(ev(...to));
	};

	beforeEach(() => {
		board = new Board();
		renderer = { drawLive: vi.fn(), redraw: vi.fn() };
		settings = { tool: "plane", color: "#d32f2f", size: 3 };
		viewport = new Viewport();
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

	test("a click gives a square of 480 centred on the click", () => {
		c.pointerDown(ev(300, 300));
		c.pointerUp(ev(300, 300));
		expect(board.strokes).toHaveLength(1);
		expect(board.strokes[0].kind).toBe("plane");
		expect(corners()).toEqual([
			[60, 60],
			[540, 540],
		]);
	});

	test("it starts with a grid, axes and numbers, in the colour and width chosen", () => {
		c.pointerDown(ev(300, 300));
		c.pointerUp(ev(300, 300));
		expect(board.strokes[0]).toMatchObject({
			kind: "plane",
			cell: 40,
			grid: true,
			showAxes: true,
			numbered: true,
			color: "#d32f2f",
			size: 3,
		});
	});

	test("a drag gives a square with the longer side of the drag, from the corner pressed", () => {
		drag([100, 100], [500, 300]);
		expect(corners()).toEqual([
			[100, 100],
			[500, 500],
		]);
	});

	test("a drag up and to the left grows that way", () => {
		drag([500, 500], [100, 300]);
		expect(corners()).toEqual([
			[500, 500],
			[100, 100],
		]);
	});

	test("it is never smaller than 240, so a graph makes sense", () => {
		drag([100, 100], [150, 130]);
		expect(corners()).toEqual([
			[100, 100],
			[340, 340],
		]);
	});

	test("the size is in board units, whatever the zoom", () => {
		viewport.scale = 2;
		c.pointerDown(ev(400, 400)); // board (200, 200)
		c.pointerUp(ev(400, 400));
		expect(corners()).toEqual([
			[-40, -40],
			[440, 440],
		]);
	});

	test("it shows the square while it is dragged", () => {
		c.pointerDown(ev(100, 100));
		c.pointerMove(ev(400, 250));
		const live = vi.mocked(renderer.drawLive).mock.lastCall?.[0];
		expect(live?.kind).toBe("plane");
		expect(live?.points.map((p) => [p[0], p[1]])).toEqual([
			[100, 100],
			[400, 400],
		]);
	});

	test("afterwards it is selected and the tool is Zaznacz, to move it or set it", () => {
		c.pointerDown(ev(300, 300));
		c.pointerUp(ev(300, 300));
		expect(c.selection.map((s) => s.id)).toEqual([board.strokes[0].id]);
		expect(settings.tool).toBe("select");
	});

	test("it is one undo step", () => {
		c.pointerDown(ev(300, 300));
		c.pointerUp(ev(300, 300));
		c.undo();
		expect(board.strokes).toHaveLength(0);
	});

	test("the eraser passes over it and takes only what is drawn on it", () => {
		c.pointerDown(ev(300, 300));
		c.pointerUp(ev(300, 300));
		settings.tool = "pen";
		drag([200, 300], [400, 300]);
		expect(board.strokes).toHaveLength(2);
		settings.tool = "eraser";
		c.pointerDown(ev(300, 300));
		c.pointerUp(ev(300, 300));
		expect(board.strokes.map((s) => s.kind)).toEqual(["plane"]);
	});

	test("it cannot be shrunk below four cells a side, so it stays a graph", () => {
		const plane: Stroke = {
			id: "pl",
			authorId: "a",
			color: "#111",
			size: 3,
			z: 1,
			kind: "plane",
			numbered: true,
			points: [
				[0, 0, 0.5],
				[480, 480, 0.5],
			],
		};
		board.addStroke(plane);
		settings.tool = "select";
		c.select("pl");
		c.pointerDown(ev(496, 496)); // the south-east handle
		c.pointerMove(ev(20, 20));
		c.pointerUp(ev(20, 20));
		const [a, b] = board.strokes[0].points;
		expect(Math.abs(b[0] - a[0])).toBeGreaterThanOrEqual(160);
		expect(Math.abs(b[1] - a[1])).toBeGreaterThanOrEqual(160);
	});
});
