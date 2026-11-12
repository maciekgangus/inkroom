import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board, type Stroke } from "./board";
import {
	Controller,
	type PointerInput,
	type Renderer,
	type Settings,
} from "./controller";
import type { Frame } from "./selection-frame";
import { cornerPos, rotationHandlePos } from "./selection-frame";
import { geomBox } from "./transform";
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
const ev = (x: number, y: number, shiftKey = false): PointerInput => ({
	pointerId: 1,
	pointerType: "mouse",
	clientX: x,
	clientY: y,
	pressure: 0.5,
	button: 0,
	shiftKey,
});

describe("Controller resizing and group rotation", () => {
	let board: Board;
	let c: Controller;
	let frames: (Frame | null)[];
	const get = (id: string) => board.strokes.find((s) => s.id === id) as Stroke;
	const size = (id: string) => {
		const b = geomBox(get(id));
		return [b.maxX - b.minX, b.maxY - b.minY];
	};
	const drag = (
		from: [number, number],
		to: [number, number],
		shift = false,
	) => {
		c.pointerDown(ev(...from, shift));
		c.pointerMove(ev(...to, shift));
		c.pointerUp(ev(...to, shift));
	};
	const lastFrame = () => frames[frames.length - 1] as Frame;

	beforeEach(() => {
		board = new Board();
		frames = [];
		const renderer: Renderer = {
			drawLive: vi.fn(),
			redraw: vi.fn(),
			setSelection: (f) => frames.push(f),
			setMarquee: vi.fn(),
			setHighlight: vi.fn(),
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
		board.addStroke(box("r1", [100, 100], [300, 200])); // 200 x 100
		board.addStroke(box("r2", [400, 100], [450, 150]));
	});

	test("a corner handle stretches width and height independently", () => {
		c.select("r1");
		drag([316, 216], [516, 266]); // se corner; nw (100,100) stays
		expect(size("r1")).toEqual([400, 150]);
		expect(geomBox(get("r1")).minX).toBe(100);
	});

	test("it can be made narrower without changing the height", () => {
		c.select("r1");
		drag([316, 216], [216, 216]);
		expect(size("r1")[0]).toBeCloseTo(100);
		expect(size("r1")[1]).toBeCloseTo(100);
	});

	test("with Shift the proportions are kept", () => {
		c.select("r1");
		drag([316, 216], [516, 266], true);
		const [w, h] = size("r1");
		expect(w / h).toBeCloseTo(2);
	});

	test("it cannot be flipped or collapsed by dragging past the opposite corner", () => {
		c.select("r1");
		drag([316, 216], [36, 36]);
		const [w, h] = size("r1");
		expect(w).toBeGreaterThan(0);
		expect(h).toBeGreaterThan(0);
		expect(geomBox(get("r1")).minX).toBeCloseTo(100);
	});

	test("a turned rectangle is stretched along its own axes", () => {
		board.addStroke({ ...box("t", [600, 100], [800, 200]), rot: Math.PI / 2 });
		c.select("t");
		const se = cornerPos(lastFrame(), "se");
		// the frame's x axis points down on the board; pull the corner 100 px along it
		drag(se, [se[0], se[1] + 100]);
		const [w, h] = size("t");
		expect(w).toBeCloseTo(300); // the 200 wide side grew by half
		expect(h).toBeCloseTo(100); // the other side did not
	});

	test("a turned group keeps the size of its frame", () => {
		c.select(["r1", "r2"]);
		const before = lastFrame();
		const handle = rotationHandlePos(before, 28);
		drag(handle, [before.cx + 150, before.cy + 120]); // some turn
		const after = lastFrame();
		expect(after.rot).not.toBe(0);
		expect(after.w).toBeCloseTo(before.w);
		expect(after.h).toBeCloseTo(before.h);
		expect(after.cx).toBeCloseTo(before.cx);
		expect(after.cy).toBeCloseTo(before.cy);
	});

	test("the turned frame stays the same size when the selection is shown again", () => {
		c.select(["r1", "r2"]);
		const before = lastFrame();
		drag(rotationHandlePos(before, 28), [before.cx + 150, before.cy + 120]);
		const turned = lastFrame();
		c.select(["r1", "r2"]); // the same selection, picked again: a fresh, upright frame
		expect(lastFrame().rot).toBe(0);
		expect(turned.w).toBeCloseTo(before.w);
	});

	test("a group can be stretched along its turned axes", () => {
		c.select(["r1", "r2"]);
		const before = lastFrame();
		drag(rotationHandlePos(before, 28), [before.cx + before.w, before.cy]); // a quarter turn right
		const turned = lastFrame();
		const se = cornerPos(turned, "se");
		const nw = cornerPos(turned, "nw");
		const inner = (f: { w: number; h: number }) => (f.w - 32) / (f.h - 32); // minus the margins
		drag(
			se,
			[se[0] + (se[0] - nw[0]) * 0.5, se[1] + (se[1] - nw[1]) * 0.5],
			true,
		);
		const after = lastFrame();
		expect(inner(after)).toBeCloseTo(inner(turned));
		expect(after.w).toBeGreaterThan(turned.w);
	});

	test("the frame is hidden while turning and comes back on release", () => {
		c.select(["r1", "r2"]);
		const f = lastFrame();
		const h = rotationHandlePos(f, 28);
		c.pointerDown(ev(h[0], h[1]));
		c.pointerMove(ev(f.cx + 150, f.cy + 120));
		expect(frames[frames.length - 1]).toBeNull(); // nothing to look at while turning
		c.pointerUp(ev(f.cx + 150, f.cy + 120));
		expect(frames[frames.length - 1]).not.toBeNull();
		expect(lastFrame().rot).not.toBe(0);
	});

	test("it is hidden while stretching and back on release (R-057)", () => {
		c.select("r1");
		c.pointerDown(ev(300, 200));
		c.pointerMove(ev(400, 240));
		expect(frames[frames.length - 1]).toBeNull();
		c.pointerUp(ev(400, 240));
		expect(frames[frames.length - 1]).not.toBeNull();
	});

	test("the frame comes back even if the turn ended where it started", () => {
		c.select("r1");
		const f = lastFrame();
		const h = rotationHandlePos(f, 28);
		c.pointerDown(ev(h[0], h[1]));
		c.pointerMove(ev(f.cx + 150, f.cy));
		expect(frames[frames.length - 1]).toBeNull();
		c.pointerMove(ev(h[0], h[1]));
		c.pointerUp(ev(h[0], h[1]));
		expect(frames[frames.length - 1]).not.toBeNull();
	});
});
