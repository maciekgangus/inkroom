import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board, type Point, type Stroke } from "./board";
import { intersects, strokeBounds } from "./bounds";
import {
	Controller,
	type PointerInput,
	type Renderer,
	type Settings,
} from "./controller";
import { findHit, findObjectHit } from "./hit";
import { worldBounds } from "./transform";
import { Viewport } from "./viewport";

const ev = (
	type: string,
	x: number,
	y: number,
	extra: Partial<PointerInput> = {},
): PointerInput => ({
	pointerId: 1,
	pointerType: type,
	clientX: x,
	clientY: y,
	pressure: 0.5,
	...extra,
});

const pt = (x: number, y: number): Point => [x, y, 0.5];

/**
 * The hit paths on a board past the fallback size (200), so they run through the spatial
 * index (R-118): the eraser, a click in Zaznacz, PPM, a double-click on a text, a marquee
 * and a lasso must behave exactly like the old linear scan — and must consult the index.
 */
describe("Controller hit paths through the spatial index (R-118)", () => {
	let board: Board;
	let renderer: Renderer;
	let settings: Settings;
	let viewport: Viewport;
	let c: Controller;

	const base = (id: string, z: number): Stroke => ({
		id,
		authorId: "me",
		color: "#111",
		size: 4,
		z,
		points: [pt(0, 0)],
	});

	beforeEach(() => {
		board = new Board();
		renderer = { drawLive: vi.fn(), redraw: vi.fn() };
		settings = { tool: "select", color: "#111", size: 4 };
		viewport = new Viewport(); // scale 1 at (0, 0): screen == board
		let n = 0;
		c = new Controller(
			board,
			renderer,
			settings,
			viewport,
			"me",
			() => `e${++n}`,
		);
		// 300 filler squiggles in a 200-unit grid, past the index fallback size.
		for (let i = 0; i < 300; i++) {
			const x = (i % 20) * 200 + 50;
			const y = Math.floor(i / 20) * 200 + 50;
			const points: Point[] = [];
			for (let k = 0; k < 10; k++)
				points.push(pt(x + k * 3, y + ((k * 7) % 10)));
			board.addStroke({ ...base(`f${i}`, i + 1), points });
		}
		// A filled rect under a line at the same place: the line is on top (higher z).
		board.addStroke({
			...base("under", 1000),
			kind: "rect",
			fill: "#fcc",
			points: [pt(50, 50), pt(150, 150)],
		});
		board.addStroke({
			...base("top", 1001),
			kind: "line",
			points: [pt(60, 100), pt(140, 100)],
		});
		const text = base("t1", 1002);
		text.kind = "text";
		text.text = "hello";
		text.points = [pt(500, 500)];
		board.addStroke(text);
	});

	test("the eraser takes the topmost element under the pointer via a point query", () => {
		const qp = vi.spyOn(board, "queryPoint");
		settings.tool = "eraser";
		c.pointerDown(ev("pen", 100, 100));
		c.pointerUp(ev("pen", 100, 100));
		expect(qp).toHaveBeenCalled();
		expect(board.strokes.some((s) => s.id === "top")).toBe(false); // the line, not the rect below
		expect(board.strokes.some((s) => s.id === "under")).toBe(true);
		c.undo();
		expect(board.strokes.some((s) => s.id === "top")).toBe(true);
	});

	test("a click in Zaznacz grabs the topmost element via a point query", () => {
		const qp = vi.spyOn(board, "queryPoint");
		settings.tool = "select";
		c.pointerDown(ev("pen", 100, 100));
		c.pointerUp(ev("pen", 100, 100));
		expect(qp).toHaveBeenCalled();
		expect(c.selection.map((s) => s.id)).toEqual(["top"]);
	});

	test("PPM targets the element under the pointer via a point query", () => {
		const qp = vi.spyOn(board, "queryPoint");
		expect(c.contextTarget(100, 100)).toBe(true);
		expect(qp).toHaveBeenCalled();
		expect(c.selection.map((s) => s.id)).toEqual(["top"]);
		expect(c.contextTarget(4000, 4000)).toBe(false);
		expect(c.selection).toEqual([]);
	});

	test("a double-click on a text finds it via a point query", () => {
		const qp = vi.spyOn(board, "queryPoint");
		const edited: Stroke[] = [];
		c.onTextEdit = (el) => {
			edited.push(el);
		};
		c.editTextAt(500, 500);
		expect(qp).toHaveBeenCalled();
		expect(edited.map((s) => s.id)).toEqual(["t1"]);
	});

	test("a marquee selects what a linear scan of the rect would, via queryRect", () => {
		const qr = vi.spyOn(board, "queryRect");
		const r = { minX: 0, minY: 0, maxX: 250, maxY: 250 };
		settings.tool = "select";
		c.pointerDown(ev("pen", 0, 0));
		c.pointerMove(ev("pen", 250, 250));
		c.pointerUp(ev("pen", 250, 250));
		expect(qr).toHaveBeenCalled();
		const expected = board.strokes
			.filter((s) => intersects(worldBounds(s), r))
			.map((s) => s.id);
		expect(c.selection.map((s) => s.id).sort()).toEqual([...expected].sort());
		expect(expected.length).toBeGreaterThan(0);
	});

	test("a lasso selects what the loop touches, after a bounding-box queryRect", () => {
		const qr = vi.spyOn(board, "queryRect");
		settings.tool = "select";
		// A loop around the filler squiggle f0 at (50, 50).
		c.pointerDown(ev("pen", 10, 50, { ctrlKey: true }));
		for (let a = 0; a <= 8; a++)
			c.pointerMove(
				ev(
					"pen",
					50 + 40 * Math.cos((a / 8) * 2 * Math.PI),
					50 + 40 * Math.sin((a / 8) * 2 * Math.PI),
				),
			);
		c.pointerUp(ev("pen", 50 + 40, 50));
		expect(qr).toHaveBeenCalled();
		const ids = c.selection.map((s) => s.id);
		expect(ids).toContain("f0");
		// Same as testing every element with the loop: the squiggle is inside, the far ones are not.
		expect(ids).not.toContain("f299");
	});

	test("the eraser query box is at least ERASER_RADIUS / scale around the pointer", () => {
		// Zoomed in 4x, the reach in board units is ERASER_RADIUS / 4 = 2.5: a stroke 2 units
		// off the pointer is still erased, and the query saw it.
		viewport.setScaleAt(100, 100, 4);
		settings.tool = "eraser";
		const far = base("far", 2000);
		far.kind = "line";
		far.points = [pt(98, 100), pt(102, 100)]; // 2 board units from (100, 100)
		board.addStroke(far);
		c.pointerDown(ev("pen", 100, 100));
		c.pointerUp(ev("pen", 100, 100));
		expect(board.strokes.some((s) => s.id === "far")).toBe(false);
	});

	test("queries on the big board return a drawing-order superset and the exact topmost hit", () => {
		for (const [x, y] of [
			[100, 100],
			[50, 50],
			[1230, 870],
			[500, 500],
		] as const) {
			const reach = 10;
			const r = {
				minX: x - reach,
				minY: y - reach,
				maxX: x + reach,
				maxY: y + reach,
			};
			const cands = board.queryPoint(x, y, reach);
			const ids = cands.map((s) => s.id);
			const order = new Map(board.strokes.map((s, i) => [s.id, i]));
			// Preserves exact drawing order (z, id).
			for (let i = 1; i < ids.length; i++) {
				expect(order.get(ids[i - 1]) as number).toBeLessThan(
					order.get(ids[i]) as number,
				);
			}
			// Superset of the unpadded box scan.
			const idSet = new Set(ids);
			for (const s of board.strokes.filter((s) =>
				intersects(strokeBounds(s), r),
			)) {
				expect(idSet.has(s.id)).toBe(true);
			}
			expect(findHit(cands, x, y, reach)?.id ?? null).toBe(
				findHit(board.strokes, x, y, reach)?.id ?? null,
			);
			expect(findObjectHit(cands, x, y, reach)?.id ?? null).toBe(
				findObjectHit(board.strokes, x, y, reach)?.id ?? null,
			);
		}
	});
});
