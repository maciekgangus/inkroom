import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board, type BoardOp, type Stroke } from "./board";
import {
	Controller,
	type PointerInput,
	type Renderer,
	type Settings,
} from "./controller";
import { partsOf } from "./shape-parts";
import { rotatePoint } from "./transform";
import { Viewport } from "./viewport";

type Vec = [number, number];
const pt = (x: number, y: number) => [x, y, 0.5] as [number, number, number];
const shape = (kind: Stroke["kind"], extra: Partial<Stroke> = {}): Stroke => ({
	id: "s",
	authorId: "a",
	color: "#111",
	size: 4,
	z: 1,
	kind,
	points: [pt(100, 100), pt(340, 280)], // 240 wide, 180 tall
	...extra,
});
const ev = (p: Vec): PointerInput => ({
	pointerId: 1,
	pointerType: "mouse",
	clientX: p[0],
	clientY: p[1],
	pressure: 0.5,
	button: 0,
});

describe("dragging the handle of an adjustable shape (R-041, phase 2)", () => {
	let board: Board;
	let c: Controller;
	let handles: (Vec | null)[];
	let ops: BoardOp[];
	const get = () => board.strokes[0];
	const drag = (from: Vec, to: Vec) => {
		c.pointerDown(ev(from));
		c.pointerMove(ev(to));
		c.pointerUp(ev(to));
	};
	const lastHandle = () => handles[handles.length - 1];
	const add = (s: Stroke) => {
		board.addStroke(s);
		ops = [];
		board.onOp = (op) => ops.push(op);
		c.select(s.id);
	};

	beforeEach(() => {
		board = new Board();
		handles = [];
		ops = [];
		const renderer: Renderer = {
			drawLive: vi.fn(),
			redraw: vi.fn(),
			setSelection: vi.fn(),
			setHighlight: vi.fn(),
			setDrag: vi.fn(),
			setAdjust: (p) => void handles.push(p),
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
	});

	test("a lone adjustable shape shows its handle, other things do not", () => {
		add(shape("trapezoid"));
		expect(lastHandle()).toEqual([160, 100]);
		c.select(null);
		expect(lastHandle()).toBeNull();
		board.eraseStroke("me", "s");
		add(shape("rect"));
		expect(lastHandle()).toBeNull();
	});

	test("several shapes selected show none", () => {
		add(shape("trapezoid"));
		board.addStroke({ ...shape("triangle"), id: "t" });
		c.select(["s", "t"]);
		expect(lastHandle()).toBeNull();
	});

	test("dragging it changes the parameter, as one undo step", () => {
		add(shape("trapezoid"));
		drag([160, 100], [190, 100]);
		expect(get().adj).toBeCloseTo(0.375);
		expect(ops.map((o) => o.t)).toEqual(["update"]);
		const tops = (partsOf(get())?.fill ?? [])
			.filter((p) => p[1] === 100)
			.map((p) => p[0]);
		expect(Math.min(...tops)).toBeCloseTo(190);
		board.undo("me");
		expect(get().adj).toBeUndefined();
	});

	test("the handle follows the new shape", () => {
		add(shape("trapezoid"));
		drag([160, 100], [190, 100]);
		expect(lastHandle()?.[0]).toBeCloseTo(190);
	});

	test("the triangle's apex moves along the top and stays inside", () => {
		add(shape("triangle"));
		drag([220, 100], [100, 100]);
		expect(get().adj).toBe(0);
		drag([100, 100], [900, 100]);
		expect(get().adj).toBe(1);
	});

	test("the handle wins over the corner handle where they meet", () => {
		add(shape("trapezoid", { adj: 0 })); // its top vertex is on the corner
		drag([100, 100], [160, 100]);
		expect(get().adj).toBeCloseTo(0.25);
		expect(get().points.map((p) => p.slice(0, 2))).toEqual([
			[100, 100],
			[340, 280],
		]); // the shape was not scaled
	});

	test("a turned shape is adjusted along its own axes", () => {
		add(shape("trapezoid", { rot: Math.PI / 2 }));
		const centre: Vec = [220, 190];
		const handle = lastHandle() as Vec;
		expect(handle[0]).toBeCloseTo(
			rotatePoint([160, 100], centre, Math.PI / 2)[0],
		);
		const target = rotatePoint([190, 100], centre, Math.PI / 2);
		drag(handle, target);
		expect(get().adj).toBeCloseTo(0.375);
	});

	test("pressing it without moving changes nothing", () => {
		add(shape("trapezoid"));
		drag([160, 100], [160, 100]);
		expect(ops).toEqual([]);
		expect(get().adj).toBeUndefined();
	});

	test("a shape drawn upside down has its handle at the bottom", () => {
		add(shape("trapezoid", { points: [pt(340, 280), pt(100, 100)] }));
		expect(lastHandle()?.[1]).toBe(280);
		drag(lastHandle() as Vec, [250, 280]);
		expect(get().adj).toBeCloseTo(0.375); // mirrored: measured from the right
	});
});

describe("a shape being drawn is a new object at every step", () => {
	test("what is cached for an element cannot go stale while it is dragged out", () => {
		const board = new Board();
		const seen: Stroke[] = [];
		const renderer: Renderer = {
			drawLive: (s) => void (s && seen.push(s)),
			redraw: vi.fn(),
		};
		const c = new Controller(
			board,
			renderer,
			{ tool: "shape", shape: "trapezoid", color: "#111", size: 4 },
			new Viewport(),
			"me",
			() => "n",
		);
		const at = (x: number, y: number): PointerInput => ({
			pointerId: 1,
			pointerType: "mouse",
			clientX: x,
			clientY: y,
			pressure: 0.5,
			button: 0,
		});
		c.pointerDown(at(100, 100));
		c.pointerMove(at(200, 150));
		c.pointerMove(at(300, 250));
		c.pointerUp(at(300, 250));
		expect(new Set(seen).size).toBe(seen.length); // no object is drawn twice
		const done = board.strokes[0];
		expect(seen.includes(done)).toBe(false);
		expect(partsOf(done)?.fill.some((p) => p[0] === 300 || p[0] === 100)).toBe(
			true,
		);
	});
});

describe("handles stand off the object and follow it (R-041)", () => {
	const mk = () => {
		const board = new Board();
		const frames: ({ w: number; h: number } | null)[] = [];
		const ends: unknown[] = [];
		const renderer: Renderer = {
			drawLive: vi.fn(),
			redraw: vi.fn(),
			setSelection: (f) => void frames.push(f),
			setEndpoints: (e) => void ends.push(e),
		};
		const c = new Controller(
			board,
			renderer,
			{ tool: "select", color: "#111", size: 4 },
			new Viewport(),
			"me",
			() => "n",
		);
		return { board, c, frames, ends };
	};
	const press = (x: number, y: number): PointerInput => ({
		pointerId: 1,
		pointerType: "mouse",
		clientX: x,
		clientY: y,
		pressure: 0.5,
		button: 0,
	});

	test("every frame is wider than the object, by the same margin as a line's", () => {
		const { board, c, frames } = mk();
		board.addStroke(shape("rect"));
		c.select("s");
		expect(frames[frames.length - 1]).toMatchObject({
			w: 240 + 32,
			h: 180 + 32,
		});
	});

	test("dragging a handle that stands off the object scales it by what the pointer moved", () => {
		const { board, c } = mk();
		board.addStroke(shape("rect"));
		c.select("s");
		// the south east handle is at (340 + 16, 280 + 16); move it 60 right and 30 down
		c.pointerDown(press(356, 296));
		c.pointerMove(press(416, 326));
		c.pointerUp(press(416, 326));
		expect(board.strokes[0].points.map((p) => p.slice(0, 2))).toEqual([
			[100, 100],
			[400, 310],
		]);
	});

	test("erasing the selected element takes its handles away", () => {
		const { board, c, frames, ends } = mk();
		board.addStroke(shape("line"));
		c.select("s");
		expect(ends[ends.length - 1]).not.toBeNull();
		board.eraseStroke("me", "s");
		c.refreshSelection();
		expect(ends[ends.length - 1]).toBeNull();
		expect(frames[frames.length - 1]).toBeNull();
	});
});
