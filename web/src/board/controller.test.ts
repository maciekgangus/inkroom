import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board } from "./board";
import {
	Controller,
	type PointerInput,
	type Renderer,
	type Settings,
} from "./controller";

function ev(
	type: string,
	x: number,
	y: number,
	extra: Partial<PointerInput> = {},
): PointerInput {
	return {
		pointerId: 1,
		pointerType: type,
		clientX: x,
		clientY: y,
		pressure: 0.5,
		...extra,
	};
}

describe("Controller", () => {
	let board: Board;
	let renderer: Renderer;
	let settings: Settings;
	let c: Controller;

	beforeEach(() => {
		board = new Board();
		renderer = { drawLive: vi.fn(), redraw: vi.fn() };
		settings = { tool: "pen", color: "#c00", size: 4 };
		let n = 0;
		c = new Controller(board, renderer, settings, "me", () => `s${++n}`);
	});

	test("pen draws a stroke with the current color and size on release", () => {
		c.pointerDown(ev("pen", 1, 1, { pressure: 0.8 }));
		c.pointerMove(ev("pen", 5, 5));
		c.pointerUp(ev("pen", 5, 5));
		expect(board.strokes).toHaveLength(1);
		const s = board.strokes[0];
		expect([s.authorId, s.color, s.size]).toEqual(["me", "#c00", 4]);
		expect(s.points[0]).toEqual([1, 1, 0.8]);
		expect(s.points.at(-1)?.slice(0, 2)).toEqual([5, 5]);
	});

	test("mouse draws too", () => {
		c.pointerDown(ev("mouse", 1, 1));
		c.pointerUp(ev("mouse", 1, 1));
		expect(board.strokes).toHaveLength(1);
	});

	test("touch never draws (palm rejection)", () => {
		c.pointerDown(ev("touch", 1, 1));
		c.pointerMove(ev("touch", 9, 9));
		c.pointerUp(ev("touch", 9, 9));
		expect(board.strokes).toHaveLength(0);
	});

	test("uses coalesced events for extra points", () => {
		c.pointerDown(ev("pen", 0, 0));
		const move = ev("pen", 3, 3, {
			getCoalescedEvents: () => [
				ev("pen", 1, 1),
				ev("pen", 2, 2),
				ev("pen", 3, 3),
			],
		});
		c.pointerMove(move);
		c.pointerUp(ev("pen", 3, 3));
		expect(board.strokes[0].points.map((p) => p[0])).toEqual([0, 1, 2, 3]);
	});

	test("shows the live stroke while drawing and clears it on release", () => {
		c.pointerDown(ev("pen", 0, 0));
		c.pointerMove(ev("pen", 2, 2));
		expect(renderer.drawLive).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "s1" }),
		);
		c.pointerUp(ev("pen", 2, 2));
		expect(renderer.drawLive).toHaveBeenLastCalledWith(null);
		expect(renderer.redraw).toHaveBeenCalled();
	});

	test("ignores a second pointer while one is drawing", () => {
		c.pointerDown(ev("pen", 0, 0));
		c.pointerDown(ev("pen", 50, 50, { pointerId: 2 }));
		c.pointerMove(ev("pen", 60, 60, { pointerId: 2 }));
		c.pointerUp(ev("pen", 0, 0));
		expect(board.strokes).toHaveLength(1);
		expect(board.strokes[0].points.every((p) => p[0] < 10)).toBe(true);
	});

	test("pointercancel still commits the stroke", () => {
		c.pointerDown(ev("pen", 0, 0));
		c.pointerMove(ev("pen", 4, 4));
		c.pointerCancel(ev("pen", 4, 4));
		expect(board.strokes).toHaveLength(1);
	});

	test("eraser removes the stroke under the pointer and redraws", () => {
		settings.tool = "pen";
		c.pointerDown(ev("pen", 0, 0));
		c.pointerMove(ev("pen", 100, 0));
		c.pointerUp(ev("pen", 100, 0));
		settings.tool = "eraser";
		c.pointerDown(ev("pen", 50, 0));
		c.pointerUp(ev("pen", 50, 0));
		expect(board.strokes).toHaveLength(0);
		expect(renderer.redraw).toHaveBeenLastCalledWith([]);
	});

	test("eraser drag erases strokes it passes over", () => {
		for (const y of [0, 40]) {
			c.pointerDown(ev("pen", 0, y));
			c.pointerMove(ev("pen", 100, y));
			c.pointerUp(ev("pen", 100, y));
		}
		settings.tool = "eraser";
		c.pointerDown(ev("pen", 50, 0));
		c.pointerMove(ev("pen", 50, 40));
		c.pointerUp(ev("pen", 50, 40));
		expect(board.strokes).toHaveLength(0);
	});

	test("undo and redo redraw the board for the current author", () => {
		c.pointerDown(ev("pen", 0, 0));
		c.pointerUp(ev("pen", 0, 0));
		c.undo();
		expect(board.strokes).toHaveLength(0);
		expect(renderer.redraw).toHaveBeenLastCalledWith([]);
		c.redo();
		expect(board.strokes).toHaveLength(1);
	});
});
