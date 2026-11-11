import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board } from "./board";
import { Controller, type Renderer, type Settings } from "./controller";
import { Viewport } from "./viewport";

describe("Controller.addImageBatch (the pages of a PDF, R-056)", () => {
	let board: Board;
	let renderer: Renderer;
	let c: Controller;

	beforeEach(() => {
		board = new Board();
		renderer = { drawLive: vi.fn(), redraw: vi.fn() };
		const settings: Settings = { tool: "pen", color: "#111", size: 4 };
		let n = 0;
		c = new Controller(
			board,
			renderer,
			settings,
			new Viewport(),
			"me",
			() => `e${++n}`,
		);
	});

	const rect = (y: number) => ({ minX: 0, minY: y, maxX: 900, maxY: y + 1200 });

	test("puts each page on the board as an image and repaints, selecting nothing", () => {
		const batch = c.addImageBatch();
		batch.add("img1", rect(0));
		batch.add("img2", rect(1224));
		batch.done();
		expect(board.strokes.map((s) => [s.kind, s.src])).toEqual([
			["image", "img1"],
			["image", "img2"],
		]);
		expect(renderer.redraw).toHaveBeenCalled();
		expect(c.selection).toEqual([]);
	});

	test("the pages keep their order, one over the other as they were added", () => {
		const batch = c.addImageBatch();
		batch.add("img1", rect(0));
		batch.add("img2", rect(1224));
		batch.done();
		const [a, b] = board.strokes;
		expect(a.src).toBe("img1");
		expect(a.z).toBeLessThan(b.z);
	});

	test("one undo takes the whole PDF back", () => {
		const batch = c.addImageBatch();
		batch.add("img1", rect(0));
		batch.add("img2", rect(1224));
		batch.add("img3", rect(2448));
		batch.done();
		c.undo();
		expect(board.strokes).toEqual([]);
	});

	test("does nothing for someone who may not draw", () => {
		c.readOnly = true;
		const batch = c.addImageBatch();
		batch.add("img1", rect(0));
		batch.done();
		expect(board.strokes).toEqual([]);
	});
});
