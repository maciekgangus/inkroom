import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board, type BoardOp, type Stroke } from "./board";
import {
	Controller,
	type PointerInput,
	type Renderer,
	type Settings,
} from "./controller";
import { Viewport } from "./viewport";

const pt = (x: number, y: number) => [x, y, 0.5] as [number, number, number];
const box = (id: string, a: [number, number], b: [number, number]): Stroke => ({
	authorId: "a",
	color: "#111",
	size: 4,
	z: 1,
	id,
	kind: "rect",
	fill: "#fcc",
	points: [pt(...a), pt(...b)],
});
const ev = (x: number, y: number): PointerInput => ({
	pointerId: 1,
	pointerType: "mouse",
	clientX: x,
	clientY: y,
	pressure: 0.5,
	button: 0,
});

type Drag = {
	ids: string[];
	elements: Stroke[];
	offset?: [number, number];
} | null;

describe("dragging on a layer of its own (performance)", () => {
	let board: Board;
	let c: Controller;
	let drags: Drag[];
	let redraws: number;
	let ops: BoardOp[];
	const get = (id: string) => board.strokes.find((s) => s.id === id) as Stroke;
	const lastDrag = () => drags[drags.length - 1];

	beforeEach(() => {
		board = new Board();
		drags = [];
		redraws = 0;
		const renderer: Renderer = {
			drawLive: vi.fn(),
			redraw: () => void redraws++,
			setSelection: vi.fn(),
			setHighlight: vi.fn(),
			setMarquee: vi.fn(),
			setDrag: (d) => void drags.push(d),
		};
		const settings: Settings = { tool: "select", color: "#111", size: 4 };
		c = new Controller(
			board,
			renderer,
			settings,
			new Viewport(),
			"me",
			() => "n",
		);
		board.addStroke(box("r1", [100, 100], [300, 200]));
		board.addStroke(box("r2", [400, 100], [450, 150]));
		board.addStroke(box("r3", [600, 100], [650, 150]));
		ops = [];
		board.onOp = (op) => ops.push(op);
	});

	test("moving hands the renderer the originals and the offset, and leaves the board alone", () => {
		c.select(["r1", "r2"]);
		c.pointerDown(ev(150, 150));
		const before = redraws;
		c.pointerMove(ev(190, 170));
		expect(lastDrag()?.ids.sort()).toEqual(["r1", "r2"]);
		expect(lastDrag()?.offset).toEqual([40, 20]);
		expect(
			lastDrag()
				?.elements.map((s) => s.id)
				.sort(),
		).toEqual(["r1", "r2"]);
		expect(lastDrag()?.elements[0].points[0].slice(0, 2)).not.toEqual([
			140, 120,
		]); // the originals
		expect(get("r1").points[0].slice(0, 2)).toEqual([100, 100]); // the board did not change
		expect(redraws).toBe(before); // and nothing repaints the whole board
		expect(ops).toEqual([]);
		c.pointerUp(ev(190, 170));
	});

	test("on release the board gets one update per element and the layer is dropped", () => {
		c.select(["r1", "r2"]);
		c.pointerDown(ev(150, 150));
		c.pointerMove(ev(190, 170));
		c.pointerMove(ev(250, 150));
		c.pointerUp(ev(250, 150));
		expect(get("r1").points[0].slice(0, 2)).toEqual([200, 100]);
		expect(get("r2").points[0].slice(0, 2)).toEqual([500, 100]);
		expect(ops.map((o) => o.t)).toEqual(["update", "update"]);
		expect(lastDrag()).toBeNull();
		board.undo("me");
		expect(get("r1").points[0].slice(0, 2)).toEqual([100, 100]);
	});

	test("scaling hands over the changed elements, without an offset", () => {
		c.select("r1");
		c.pointerDown(ev(316, 216)); // the south east handle, a margin off the corner
		c.pointerMove(ev(516, 316));
		const d = lastDrag();
		expect(d?.offset).toBeUndefined();
		expect(d?.elements[0].points[1].slice(0, 2)).toEqual([500, 300]);
		expect(get("r1").points[1].slice(0, 2)).toEqual([300, 200]); // still not on the board
		c.pointerUp(ev(516, 316));
		expect(get("r1").points[1].slice(0, 2)).toEqual([500, 300]);
		expect(lastDrag()).toBeNull();
	});

	test("a press without moving drops the layer again and changes nothing", () => {
		c.select("r1");
		c.pointerDown(ev(150, 150));
		c.pointerMove(ev(150, 150));
		c.pointerUp(ev(150, 150));
		expect(lastDrag()).toBeNull();
		expect(ops).toEqual([]);
	});

	test("rotating works the same way", () => {
		c.select(["r1", "r2"]);
		c.pointerDown(ev(150, 150));
		c.pointerMove(ev(160, 160));
		c.pointerUp(ev(160, 160));
		expect(lastDrag()).toBeNull();
	});

	test("a renderer without a drag layer still gets the old behaviour: the board follows the pointer", () => {
		const plain: Renderer = {
			drawLive: vi.fn(),
			redraw: vi.fn(),
			setSelection: vi.fn(),
		};
		const board2 = new Board();
		board2.addStroke(box("x", [100, 100], [300, 200]));
		const c2 = new Controller(
			board2,
			plain,
			{ tool: "select", color: "#111", size: 4 },
			new Viewport(),
			"me",
			() => "n",
		);
		c2.select("x");
		c2.pointerDown(ev(150, 150));
		c2.pointerMove(ev(190, 170));
		expect(board2.strokes[0].points[0].slice(0, 2)).toEqual([140, 120]);
		c2.pointerUp(ev(190, 170));
	});
});
