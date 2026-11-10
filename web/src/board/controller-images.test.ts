import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board, type BoardOp, type Stroke } from "./board";
import { Controller, type PointerInput, type Renderer, type Settings } from "./controller";
import { imageRect } from "./image-geometry";
import { Viewport } from "./viewport";

const ev = (type: string, x: number, y: number): PointerInput => ({
	pointerId: 1,
	pointerType: type,
	clientX: x,
	clientY: y,
	pressure: 0.5,
});

describe("Controller with images", () => {
	let board: Board;
	let renderer: Renderer;
	let settings: Settings;
	let viewport: Viewport;
	let c: Controller;
	let ops: BoardOp[];
	let id: string;

	const rectOf = () => imageRect(board.strokes.find((s) => s.id === id) as Stroke);

	beforeEach(() => {
		board = new Board();
		renderer = { drawLive: vi.fn(), redraw: vi.fn(), setSelection: vi.fn() };
		settings = { tool: "select", color: "#111", size: 4 };
		viewport = new Viewport();
		let n = 0;
		c = new Controller(board, renderer, settings, viewport, "me", () => `e${++n}`);
		id = c.addImage("img1", { minX: 100, minY: 100, maxX: 300, maxY: 200 }); // 200 x 100
		c.select(null);
		ops = [];
		board.onOp = (op) => ops.push(op);
	});

	test("addImage creates an image element with its source and two corners, and selects it", () => {
		const fresh = new Controller(board, renderer, settings, viewport, "me", () => "x1");
		const newId = fresh.addImage("pic", { minX: 10, minY: 20, maxX: 110, maxY: 70 });
		const el = board.strokes.find((s) => s.id === newId) as Stroke;
		expect(el).toMatchObject({ kind: "image", src: "pic", authorId: "me" });
		expect(el.points.map((p) => [p[0], p[1]])).toEqual([[10, 20], [110, 70]]);
		expect(fresh.selected?.id).toBe(newId);
	});

	test("an added image can be undone", () => {
		c.undo();
		expect(board.strokes.find((s) => s.id === id)).toBeUndefined();
	});

	test("pressing an image with the select tool selects it", () => {
		const onChange = vi.fn();
		c.onSelectionChange = onChange;
		c.pointerDown(ev("pen", 150, 150));
		c.pointerUp(ev("pen", 150, 150));
		expect(c.selected?.id).toBe(id);
		expect(onChange).toHaveBeenCalled();
		expect(renderer.setSelection).toHaveBeenLastCalledWith({ minX: 100, minY: 100, maxX: 300, maxY: 200 });
	});

	test("pressing empty space or a non-image element clears the selection", () => {
		c.select(id);
		c.pointerDown(ev("pen", 600, 600));
		c.pointerUp(ev("pen", 600, 600));
		expect(c.selected).toBeNull();
		expect(renderer.setSelection).toHaveBeenLastCalledWith(null);
	});

	test("touch never selects or edits", () => {
		c.pointerDown(ev("touch", 150, 150));
		expect(c.selected).toBeNull();
	});

	test("other tools leave images alone", () => {
		settings.tool = "pen";
		c.pointerDown(ev("pen", 150, 150));
		c.pointerUp(ev("pen", 150, 150));
		expect(c.selected).toBeNull();
		settings.tool = "eraser";
		c.pointerDown(ev("pen", 150, 150));
		c.pointerUp(ev("pen", 150, 150));
		expect(board.strokes.some((s) => s.id === id)).toBe(true);
	});

	test("dragging a selected image moves it, as one update and one undo step", () => {
		c.pointerDown(ev("pen", 150, 150));
		c.pointerMove(ev("pen", 170, 160));
		expect(ops).toEqual([]); // the preview is local only
		c.pointerMove(ev("pen", 180, 170));
		c.pointerUp(ev("pen", 180, 170));
		expect(rectOf()).toEqual({ minX: 130, minY: 120, maxX: 330, maxY: 220 });
		expect(ops).toHaveLength(1);
		expect(ops[0]).toMatchObject({ t: "update" });
		c.undo();
		expect(rectOf()).toEqual({ minX: 100, minY: 100, maxX: 300, maxY: 200 });
		expect(c.selected?.id).toBe(id);
	});

	test("a click without dragging changes nothing", () => {
		c.pointerDown(ev("pen", 150, 150));
		c.pointerUp(ev("pen", 150, 150));
		expect(ops).toEqual([]);
	});

	test("dragging the south-east handle resizes it with the opposite corner fixed and proportions kept", () => {
		c.select(id);
		c.pointerDown(ev("pen", 300, 200));
		c.pointerMove(ev("pen", 500, 300));
		c.pointerUp(ev("pen", 500, 300));
		const r = rectOf();
		expect([r.minX, r.minY]).toEqual([100, 100]);
		expect((r.maxX - r.minX) / (r.maxY - r.minY)).toBeCloseTo(2);
		expect(r.maxX - r.minX).toBeCloseTo(400);
		expect(ops).toHaveLength(1);
		c.undo();
		expect(rectOf()).toEqual({ minX: 100, minY: 100, maxX: 300, maxY: 200 });
	});

	test("the handle is as big on screen whatever the zoom", () => {
		c.select(id);
		viewport.scale = 2; // a 12 px grab radius is 6 board units
		c.pointerDown(ev("pen", (300 + 5) * 2, 200 * 2)); // 5 units = 10 px away: grabbed
		c.pointerMove(ev("pen", 700, 460));
		c.pointerUp(ev("pen", 700, 460));
		expect(ops).toHaveLength(1);
		expect(rectOf().minX).toBe(100); // resized, not moved
	});

	test("deleteSelected removes the image and can be undone", () => {
		c.select(id);
		expect(c.deleteSelected()).toBe(true);
		expect(board.strokes.some((s) => s.id === id)).toBe(false);
		expect(c.selected).toBeNull();
		c.undo();
		expect(board.strokes.some((s) => s.id === id)).toBe(true);
	});

	test("deleteSelected with nothing selected does nothing", () => {
		expect(c.deleteSelected()).toBe(false);
	});
});
