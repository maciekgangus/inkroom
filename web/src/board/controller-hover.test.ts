import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
	buttons: 0,
	...extra,
});

describe("Controller hover in the select tool (R-112)", () => {
	let board: Board;
	let renderer: {
		[K in keyof Renderer]-?: ReturnType<typeof vi.fn>;
	};
	let c: Controller;
	let settings: Settings;
	let now: number;

	beforeEach(() => {
		now = 1_000_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		board = new Board();
		renderer = {
			drawLive: vi.fn(),
			redraw: vi.fn(),
			moveView: vi.fn(),
			setSelection: vi.fn(),
			setMarquee: vi.fn(),
			setHighlight: vi.fn(),
			setEndpoints: vi.fn(),
			setDrag: vi.fn(),
			setAdjust: vi.fn(),
			setVertices: vi.fn(),
			setLasso: vi.fn(),
			setHover: vi.fn(),
		};
		settings = { tool: "select", color: "#111", size: 4 };
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

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("the object under the cursor is highlighted before any click, and cleared on empty space", () => {
		c.pointerHover(ev(200, 100));
		expect(renderer.setHover).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "l" }),
		);
		now += 100;
		c.pointerHover(ev(200, 500));
		expect(renderer.setHover).toHaveBeenLastCalledWith(null);
	});

	test("a hovering pen (no button pressed) highlights too", () => {
		c.pointerHover(ev(200, 310, { pointerType: "pen" }));
		expect(renderer.setHover).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "p" }),
		);
	});
});
