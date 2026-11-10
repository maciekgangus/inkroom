import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board, type Stroke } from "./board";
import {
	Controller,
	type PointerInput,
	type Renderer,
	type Settings,
} from "./controller";
import { Viewport } from "./viewport";

const pt = (x: number, y: number) => [x, y, 0.5] as [number, number, number];
const base = { authorId: "a", color: "#111", size: 4, z: 1 };
const line = (id: string): Stroke => ({
	...base,
	id,
	kind: "line",
	points: [pt(100, 100), pt(300, 100)],
});
const pen = (id: string): Stroke => ({
	...base,
	id,
	points: [pt(100, 300), pt(200, 320), pt(300, 300)],
});
const rect = (id: string): Stroke => ({
	...base,
	id,
	kind: "rect",
	points: [pt(500, 100), pt(600, 200)],
});
const ev = (x: number, y: number): PointerInput => ({
	pointerId: 1,
	pointerType: "mouse",
	clientX: x,
	clientY: y,
	pressure: 0.5,
	button: 0,
});

describe("Controller selection look (R-034)", () => {
	let board: Board;
	let renderer: {
		[K in keyof Renderer]-?: ReturnType<typeof vi.fn>;
	};
	let c: Controller;
	const click = (x: number, y: number) => {
		c.pointerDown(ev(x, y));
		c.pointerUp(ev(x, y));
	};

	beforeEach(() => {
		board = new Board();
		renderer = {
			drawLive: vi.fn(),
			redraw: vi.fn(),
			setSelection: vi.fn(),
			setMarquee: vi.fn(),
			setHighlight: vi.fn(),
			setEndpoints: vi.fn(),
			setDrag: vi.fn(),
			setAdjust: vi.fn(),
			setVertices: vi.fn(),
		};
		const settings: Settings = { tool: "select", color: "#111", size: 4 };
		c = new Controller(
			board,
			renderer as unknown as Renderer,
			settings,
			new Viewport(),
			"me",
			() => "n",
		);
		for (const s of [line("l"), pen("p"), rect("r")]) board.addStroke(s);
	});

	test("a lone line glows, keeps its frame and has dots at its ends too", () => {
		c.select("l");
		expect(renderer.setSelection.mock.lastCall?.[0]).not.toBeNull();
		expect(renderer.setEndpoints.mock.lastCall?.[0]).not.toBeNull();
		expect(
			renderer.setHighlight.mock.lastCall?.[0].map((s: Stroke) => s.id),
		).toEqual(["l"]);
		c.select("p");
		expect(renderer.setSelection.mock.lastCall?.[0]).not.toBeNull();
		expect(renderer.setEndpoints.mock.lastCall?.[0]).toBeNull();
		expect(
			renderer.setHighlight.mock.lastCall?.[0].map((s: Stroke) => s.id),
		).toEqual(["p"]);
	});

	test("a shape glows and keeps its frame", () => {
		c.select("r");
		expect(renderer.setSelection.mock.lastCall?.[0]).not.toBeNull();
		expect(
			renderer.setHighlight.mock.lastCall?.[0].map((s: Stroke) => s.id),
		).toEqual(["r"]);
	});

	test("several elements glow and share one frame", () => {
		c.select(["l", "r"]);
		expect(renderer.setSelection.mock.lastCall?.[0]).not.toBeNull();
		expect(renderer.setHighlight.mock.lastCall?.[0]).toHaveLength(2);
	});

	test("a lone stroke can be scaled with its corner handle like any other element", () => {
		c.select("p");
		const f = renderer.setSelection.mock.lastCall?.[0];
		const se = [f.cx + f.w / 2, f.cy + f.h / 2] as const;
		const before = board.strokes.find((s) => s.id === "p")?.points[2];
		c.pointerDown(ev(se[0], se[1]));
		c.pointerMove(ev(se[0] + 100, se[1] + 40));
		c.pointerUp(ev(se[0] + 100, se[1] + 40));
		const after = board.strokes.find((s) => s.id === "p")?.points[2];
		expect(after).not.toEqual(before);
	});

	test("clearing the selection clears both", () => {
		c.select("l");
		c.select(null);
		expect(renderer.setSelection).toHaveBeenLastCalledWith(null);
		expect(renderer.setHighlight).toHaveBeenLastCalledWith([]);
	});

	test("dragging a lone line moves it and the glow follows", () => {
		click(200, 100);
		c.pointerDown(ev(200, 100));
		c.pointerMove(ev(200, 160));
		c.pointerUp(ev(200, 160));
		expect(board.strokes.find((s) => s.id === "l")?.points[0][1]).toBeCloseTo(
			160,
		);
		expect(
			renderer.setHighlight.mock.lastCall?.[0][0].points[0][1],
		).toBeCloseTo(160);
	});

	test("grabbing is generous: a thin line is caught 12 px away, not 20", () => {
		click(200, 110);
		expect(c.selection.map((s) => s.id)).toEqual(["l"]);
		c.select(null);
		click(200, 120);
		expect(c.selection).toEqual([]);
	});
});
