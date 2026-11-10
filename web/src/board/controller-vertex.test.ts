import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board, type BoardOp, type Stroke } from "./board";
import { Controller, type PointerInput, type Renderer } from "./controller";
import { partsOf } from "./shape-parts";
import { centerOf, rotatePoint } from "./transform";
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
	points: [pt(100, 100), pt(340, 280)],
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
/** The corners of an element where they are on the board, its turn applied. */
const corners = (el: Stroke): Vec[] =>
	(partsOf(el)?.fill ?? []).map((p) =>
		rotatePoint(p, centerOf(el), el.rot ?? 0),
	);

describe("dragging a vertex of a figure (R-047)", () => {
	let board: Board;
	let c: Controller;
	let dots: (Vec[] | null)[];
	let ops: BoardOp[];
	const get = () => board.strokes[0];
	const lastDots = () => dots[dots.length - 1];
	const drag = (from: Vec, to: Vec) => {
		c.pointerDown(ev(from));
		c.pointerMove(ev(to));
		c.pointerUp(ev(to));
	};
	const add = (s: Stroke) => {
		board.addStroke(s);
		ops = [];
		board.onOp = (op) => ops.push(op);
		c.select(s.id);
	};

	beforeEach(() => {
		board = new Board();
		dots = [];
		ops = [];
		const renderer: Renderer = {
			drawLive: vi.fn(),
			redraw: vi.fn(),
			setSelection: vi.fn(),
			setHighlight: vi.fn(),
			setDrag: vi.fn(),
			setVertices: (v) => void dots.push(v),
		};
		c = new Controller(
			board,
			renderer,
			{ tool: "select", color: "#111", size: 4 },
			new Viewport(),
			"me",
			() => "n",
		);
	});

	test("every corner of a lone figure has a dot, nothing else does", () => {
		add(shape("trapezoid"));
		expect(lastDots()).toHaveLength(4);
		c.select(null);
		expect(lastDots()).toBeNull();
		board.eraseStroke("me", "s");
		add(shape("ellipse"));
		expect(lastDots()).toBeNull();
		board.eraseStroke("me", "s");
		add(shape("rect"));
		expect(lastDots()).toHaveLength(4);
	});

	test("a hexagon has six, a triangle three", () => {
		add(shape("hexagon"));
		expect(lastDots()).toHaveLength(6);
		board.eraseStroke("me", "s");
		add(shape("triangle"));
		expect(lastDots()).toHaveLength(3);
	});

	test("dragging one moves that corner only, as one undo step", () => {
		add(shape("trapezoid"));
		const before = corners(get());
		const target: Vec = [60, 60];
		drag(before[0], target);
		const after = corners(get());
		expect(after[0][0]).toBeCloseTo(60);
		expect(after[0][1]).toBeCloseTo(60);
		for (const i of [1, 2, 3]) {
			expect(after[i][0]).toBeCloseTo(before[i][0]);
			expect(after[i][1]).toBeCloseTo(before[i][1]);
		}
		expect(ops.map((o) => o.t)).toEqual(["update"]);
		board.undo("me");
		expect(get().verts).toBeUndefined();
		expect(corners(get())[0]).toEqual(before[0]);
	});

	test("the box follows the corners, so the frame never lies about the figure", () => {
		add(shape("triangle"));
		drag(corners(get())[0], [20, 30]); // the apex goes far out of the old box
		const [a, b] = get().points;
		expect(Math.min(a[0], b[0])).toBeLessThanOrEqual(20);
		expect(Math.min(a[1], b[1])).toBeLessThanOrEqual(30);
	});

	test("a turned figure keeps its other corners in place", () => {
		add(shape("trapezoid", { rot: 0.6 }));
		const before = corners(get());
		drag(before[2], [before[2][0] + 70, before[2][1] - 40]);
		const after = corners(get());
		expect(after[2][0]).toBeCloseTo(before[2][0] + 70);
		expect(after[2][1]).toBeCloseTo(before[2][1] - 40);
		for (const i of [0, 1, 3]) {
			expect(after[i][0]).toBeCloseTo(before[i][0]);
			expect(after[i][1]).toBeCloseTo(before[i][1]);
		}
	});

	test("a rectangle becomes a free polygon, keeping its fill and style", () => {
		add(shape("rect", { fill: "#0f0", dash: "dashed" }));
		drag((lastDots() as Vec[])[1], [400, 90]);
		expect(get().kind).not.toBe("rect");
		expect(get()).toMatchObject({ fill: "#0f0", dash: "dashed" });
		expect(corners(get())).toHaveLength(4);
	});

	test("pressing a corner without moving changes nothing", () => {
		add(shape("trapezoid"));
		drag(corners(get())[1], corners(get())[1]);
		expect(ops).toEqual([]);
		expect(get().verts).toBeUndefined();
	});

	test("the dots follow the figure after the edit", () => {
		add(shape("trapezoid"));
		drag(corners(get())[0], [60, 60]);
		expect(lastDots()?.[0][0]).toBeCloseTo(60);
	});
});

describe("the dots while a figure turns (R-047)", () => {
	test("all the dots are put away during the turn and come back after it", () => {
		const board = new Board();
		const dots: (Vec[] | null)[] = [];
		const renderer: Renderer = {
			drawLive: vi.fn(),
			redraw: vi.fn(),
			setSelection: vi.fn(),
			setHighlight: vi.fn(),
			setDrag: vi.fn(),
			setVertices: (v) => void dots.push(v),
		};
		const c = new Controller(
			board,
			renderer,
			{ tool: "select", color: "#111", size: 4 },
			new Viewport(),
			"me",
			() => "n",
		);
		board.addStroke(shape("trapezoid"));
		c.select("s");
		// the rotation handle: above the frame (its top is 100 - 16, and 28 px more)
		c.pointerDown(ev([220, 100 - 16 - 28]));
		c.pointerMove(ev([320, 120]));
		expect(dots[dots.length - 1]).toBeNull();
		c.pointerUp(ev([320, 120]));
		expect(dots[dots.length - 1]).toHaveLength(4);
	});
});

describe("the pen takes the line style (R-037)", () => {
	test("a new stroke is dashed or dotted when the style says so, with the pen", () => {
		const board = new Board();
		const renderer: Renderer = { drawLive: vi.fn(), redraw: vi.fn() };
		const settings = {
			tool: "pen" as const,
			color: "#111",
			size: 4,
			lineStyle: "dotted" as const,
		};
		const c = new Controller(
			board,
			renderer,
			settings,
			new Viewport(),
			"me",
			() => "n",
		);
		c.pointerDown(ev([10, 10]));
		c.pointerMove(ev([50, 50]));
		c.pointerUp(ev([50, 50]));
		expect(board.strokes[0].dash).toBe("dotted");
	});
});

describe("the corners of a solid (R-050)", () => {
	test("a cube has seven dots, and dragging one moves that corner of the solid", () => {
		const board = new Board();
		const dots: (Vec[] | null)[] = [];
		const renderer: Renderer = {
			drawLive: vi.fn(),
			redraw: vi.fn(),
			setSelection: vi.fn(),
			setHighlight: vi.fn(),
			setDrag: vi.fn(),
			setVertices: (v) => void dots.push(v),
		};
		const c = new Controller(
			board,
			renderer,
			{ tool: "select", color: "#111", size: 4 },
			new Viewport(),
			"me",
			() => "n",
		);
		board.addStroke(shape("cube"));
		c.select("s");
		const first = dots[dots.length - 1] as Vec[];
		expect(first).toHaveLength(7);
		const from = first[0];
		c.pointerDown(ev(from));
		c.pointerMove(ev([from[0] - 50, from[1] - 40]));
		c.pointerUp(ev([from[0] - 50, from[1] - 40]));
		const now = dots[dots.length - 1] as Vec[];
		expect(now).toHaveLength(7);
		expect(now[0][0]).toBeCloseTo(from[0] - 50);
		expect(now[0][1]).toBeCloseTo(from[1] - 40);
		for (let i = 1; i < 7; i++) {
			expect(now[i][0]).toBeCloseTo(first[i][0]);
			expect(now[i][1]).toBeCloseTo(first[i][1]);
		}
		expect(board.strokes[0].kind).toBe("cube"); // still a cube, with a corner pulled
		board.undo("me");
		expect(board.strokes[0].verts).toBeUndefined();
	});
});
