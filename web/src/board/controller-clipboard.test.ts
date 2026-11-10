import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board, type BoardOp, type Stroke } from "./board";
import { Controller, type Renderer, type Settings } from "./controller";
import { Viewport } from "./viewport";

const base = { authorId: "a", color: "#111", size: 4, z: 0 };
const pt = (x: number, y: number) => [x, y, 0.5] as [number, number, number];
const box = (
	id: string,
	a: [number, number],
	b: [number, number],
	z: number,
): Stroke => ({
	...base,
	id,
	z,
	kind: "rect",
	fill: "#fcc",
	points: [pt(...a), pt(...b)],
});

describe("Board.addMany", () => {
	test("adds several elements as one undo step with one add operation each", () => {
		const board = new Board();
		const ops: BoardOp[] = [];
		board.onOp = (op) => ops.push(op);
		board.addMany("me", [
			box("a", [0, 0], [10, 10], 1),
			box("b", [0, 0], [5, 5], 2),
		]);
		expect(board.strokes.map((s) => s.id)).toEqual(["a", "b"]);
		expect(ops.map((o) => o.t)).toEqual(["add", "add"]);
		expect(board.undo("me")).toBe(true);
		expect(board.strokes).toEqual([]);
		expect(board.redo("me")).toBe(true);
		expect(board.strokes).toHaveLength(2);
	});
});

describe("Controller clipboard, duplicate and layer order", () => {
	let board: Board;
	let c: Controller;
	let ops: BoardOp[];
	const get = (id: string) => board.strokes.find((s) => s.id === id) as Stroke;

	beforeEach(() => {
		board = new Board();
		const renderer: Renderer = {
			drawLive: vi.fn(),
			redraw: vi.fn(),
			setSelection: vi.fn(),
			setMarquee: vi.fn(),
		};
		const settings: Settings = { tool: "select", color: "#111", size: 4 };
		let n = 0;
		c = new Controller(
			board,
			renderer,
			settings,
			new Viewport(),
			"me",
			() => `n${++n}`,
		);
		board.addStroke(box("r1", [100, 100], [300, 200], 10));
		board.addStroke(box("r2", [400, 100], [450, 150], 20));
		board.addStroke(box("r3", [600, 100], [650, 150], 30));
		ops = [];
		board.onOp = (op) => ops.push(op);
	});

	test("copySelected needs a selection and fills the clipboard", () => {
		expect(c.copySelected()).toBe(false);
		expect(c.hasClipboard).toBe(false);
		c.select("r1");
		expect(c.copySelected()).toBe(true);
		expect(c.hasClipboard).toBe(true);
	});

	test("paste puts the copies' top-left corner at the given point, selects them, one undo step", () => {
		c.select(["r1", "r2"]);
		c.copySelected();
		const ids = c.paste([1000, 500]);
		expect(ids).toHaveLength(2);
		const [a, b] = ids.map(get);
		expect(a.id).not.toBe("r1");
		expect(a.authorId).toBe("me");
		expect(a.points[0].slice(0, 2)).toEqual([1000, 500]); // r1 was the top-left one
		expect(b.points[0].slice(0, 2)).toEqual([1300, 500]); // keeps the distance (300 apart)
		expect(c.selection.map((s) => s.id)).toEqual(ids);
		expect(Math.min(a.z, b.z)).toBeGreaterThan(30); // on top
		board.undo("me");
		expect(board.strokes.map((s) => s.id)).toEqual(["r1", "r2", "r3"]);
	});

	test("paste without a point offsets the copies a little; an empty clipboard pastes nothing", () => {
		expect(c.paste()).toEqual([]);
		c.select("r1");
		c.copySelected();
		const [id] = c.paste();
		expect(get(id).points[0].slice(0, 2)).toEqual([120, 120]);
	});

	test("the clipboard survives pasting, so it can be pasted again", () => {
		c.select("r1");
		c.copySelected();
		const [a] = c.paste([0, 0]);
		const [b] = c.paste([50, 50]);
		expect(a).not.toBe(b);
		expect(board.strokes).toHaveLength(5);
	});

	test("duplicateSelected copies in place with an offset and selects the copies", () => {
		c.select("r2");
		expect(c.duplicateSelected()).toBe(true);
		expect(board.strokes).toHaveLength(4);
		const copy = c.selection[0];
		expect(copy.id).not.toBe("r2");
		expect(copy.points[0].slice(0, 2)).toEqual([420, 120]);
		expect(c.hasClipboard).toBe(false); // does not touch the clipboard
		c.select(null);
		expect(c.duplicateSelected()).toBe(false);
	});

	test("bringToFront moves the selection above everything, keeping its inner order", () => {
		c.select(["r1", "r2"]);
		expect(c.bringToFront()).toBe(true);
		expect(get("r1").z).toBeGreaterThan(30);
		expect(get("r2").z).toBeGreaterThan(get("r1").z);
		expect(board.strokes.map((s) => s.id)).toEqual(["r3", "r1", "r2"]);
		expect(ops.every((o) => o.t === "update")).toBe(true);
		board.undo("me");
		expect(get("r1").z).toBe(10);
	});

	test("sendToBack moves the selection below everything, keeping its inner order", () => {
		c.select(["r2", "r3"]);
		expect(c.sendToBack()).toBe(true);
		expect(get("r2").z).toBeLessThan(10);
		expect(get("r3").z).toBeGreaterThan(get("r2").z);
		expect(get("r3").z).toBeLessThan(10);
		expect(board.strokes[0].id).toBe("r2");
	});

	test("layer order needs a selection", () => {
		expect(c.bringToFront()).toBe(false);
		expect(c.sendToBack()).toBe(false);
	});

	test("contextTarget treats the empty inside of a group's frame as the group", () => {
		c.select(["r1", "r3"]); // frame (100,100)-(650,200); x = 350 is empty between them
		expect(c.contextTarget(350, 150)).toBe(true);
		expect(c.selection.map((s) => s.id)).toEqual(["r1", "r3"]);
		expect(c.contextTarget(350, 260)).toBe(false); // below the frame
		expect(c.selection).toEqual([]);
	});

	test("contextTarget selects the object under the point, or clears the selection on empty space", () => {
		expect(c.contextTarget(200, 150)).toBe(true);
		expect(c.selection.map((s) => s.id)).toEqual(["r1"]);
		c.select(["r1", "r2"]);
		expect(c.contextTarget(200, 150)).toBe(true); // already in the selection: keep it all
		expect(c.selection).toHaveLength(2);
		expect(c.contextTarget(900, 900)).toBe(false);
		expect(c.selection).toEqual([]);
	});

	describe("live style preview (R-031)", () => {
		test("previewStyle changes the look at once but writes no history and sends nothing", () => {
			c.select("r1");
			c.previewStyle({ opacity: 0.5 });
			c.previewStyle({ opacity: 0.3 });
			expect(get("r1").opacity).toBe(0.3);
			expect(ops).toEqual([]);
			expect(board.undo("me")).toBe(false);
		});

		test("setProps afterwards makes it one undo step, one update, from the original", () => {
			c.select(["r1", "r2"]);
			c.previewStyle({ size: 8 });
			c.previewStyle({ size: 20 });
			expect(c.setProps({ size: 20 })).toBe(true);
			expect(ops.map((o) => o.t)).toEqual(["update", "update"]);
			expect(get("r1").size).toBe(20);
			board.undo("me");
			expect(get("r1").size).toBe(4);
			expect(get("r2").size).toBe(4);
			expect(board.undo("me")).toBe(false);
		});

		test("a preview that ended where it began changes nothing", () => {
			c.select("r1");
			c.previewStyle({ opacity: 0.5 });
			c.previewStyle({ opacity: 1 });
			expect(c.setProps({ opacity: 1 })).toBe(false);
			expect(ops).toEqual([]);
			expect(board.undo("me")).toBe(false);
		});

		test("changing the selection drops a preview that was never committed", () => {
			c.select("r1");
			c.previewStyle({ opacity: 0.5 });
			c.select("r2");
			expect(get("r1").opacity).toBeUndefined();
		});
	});

	describe("pasting elements from outside the board (R-035)", () => {
		const outside = [
			{
				color: "#d32f2f",
				size: 6,
				kind: "rect" as const,
				points: [pt(10, 20), pt(110, 70)],
			},
			{ color: "#1976d2", size: 4, points: [pt(300, 20), pt(320, 60)] },
		];

		test("adds them as new elements of this author, on top, selected, one undo step", () => {
			const ids = c.pasteSource(outside, [1000, 500]);
			expect(ids).toHaveLength(2);
			const [a, b] = ids.map(get);
			expect(a.authorId).toBe("me");
			expect(a.id).not.toBe(b.id);
			expect(a.z).toBeGreaterThan(30);
			expect(b.z).toBeGreaterThan(a.z); // the order is kept
			expect(a.points[0].slice(0, 2)).toEqual([1000, 500]);
			expect(b.points[0].slice(0, 2)).toEqual([1290, 500]);
			expect(c.selection.map((s) => s.id)).toEqual(ids);
			expect(ops.map((o) => o.t)).toEqual(["add", "add"]);
			board.undo("me");
			expect(board.strokes.map((s) => s.id)).toEqual(["r1", "r2", "r3"]);
		});

		test("without a point they land a little below and right of where they were", () => {
			const [id] = c.pasteSource(outside);
			expect(get(id).points[0].slice(0, 2)).toEqual([30, 40]);
		});

		test("an empty list adds nothing", () => {
			expect(c.pasteSource([])).toEqual([]);
			expect(ops).toEqual([]);
		});

		test("it does not touch the internal clipboard", () => {
			c.pasteSource(outside);
			expect(c.hasClipboard).toBe(false);
		});
	});
});
