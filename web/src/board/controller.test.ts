import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board } from "./board";
import {
	Controller,
	type PointerInput,
	type Renderer,
	type Settings,
} from "./controller";
import { Viewport } from "./viewport";

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
	let viewport: Viewport;
	let c: Controller;

	beforeEach(() => {
		board = new Board();
		renderer = { drawLive: vi.fn(), redraw: vi.fn() };
		settings = { tool: "pen", color: "#c00", size: 4 };
		viewport = new Viewport();
		let n = 0;
		c = new Controller(
			board,
			renderer,
			settings,
			viewport,
			"me",
			() => `s${++n}`,
		);
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

	test("strokes get a strictly increasing z", () => {
		for (let i = 0; i < 3; i++) {
			c.pointerDown(ev("pen", i, 0));
			c.pointerUp(ev("pen", i, 0));
		}
		const z = board.strokes.map((s) => s.z);
		expect(z[1]).toBeGreaterThan(z[0]);
		expect(z[2]).toBeGreaterThan(z[1]);
	});

	describe("with a moved and zoomed view", () => {
		beforeEach(() => {
			viewport.x = 100;
			viewport.y = 50;
			viewport.scale = 2;
		});

		test("stroke points are stored in board coordinates", () => {
			c.pointerDown(ev("pen", 20, 10));
			c.pointerMove(ev("pen", 40, 30));
			c.pointerUp(ev("pen", 40, 30));
			expect(board.strokes[0].points.map((p) => [p[0], p[1]])).toEqual([
				[110, 55],
				[120, 65],
			]);
		});

		test("the eraser radius stays constant on screen", () => {
			c.pointerDown(ev("pen", 0, 0)); // board (100, 50)
			c.pointerMove(ev("pen", 100, 0)); // board (150, 50)
			c.pointerUp(ev("pen", 100, 0));
			settings.tool = "eraser";
			// 8 screen px away from the line = 4 board units: inside a 10 px eraser (5 units + half the stroke).
			c.pointerDown(ev("pen", 50, 8));
			c.pointerUp(ev("pen", 50, 8));
			expect(board.strokes).toHaveLength(0);
		});

		test("the eraser misses a stroke that is far away on screen", () => {
			c.pointerDown(ev("pen", 0, 0));
			c.pointerMove(ev("pen", 100, 0));
			c.pointerUp(ev("pen", 100, 0));
			settings.tool = "eraser";
			c.pointerDown(ev("pen", 50, 40)); // 20 board units away
			c.pointerUp(ev("pen", 50, 40));
			expect(board.strokes).toHaveLength(1);
		});
	});

	describe("panning", () => {
		test("the pan tool drags the view and draws nothing", () => {
			settings.tool = "pan";
			c.pointerDown(ev("mouse", 100, 100));
			c.pointerMove(ev("mouse", 130, 90));
			c.pointerUp(ev("mouse", 130, 90));
			expect(board.strokes).toHaveLength(0);
			expect(viewport.toScreen(0, 0)).toEqual([30, -10]);
			expect(renderer.redraw).toHaveBeenCalled();
		});

		test("the middle mouse button pans whatever the tool", () => {
			c.pointerDown(ev("mouse", 100, 100, { button: 1 }));
			c.pointerMove(ev("mouse", 120, 100));
			c.pointerUp(ev("mouse", 120, 100));
			expect(board.strokes).toHaveLength(0);
			expect(viewport.toScreen(0, 0)).toEqual([20, 0]);
		});

		test("panning follows the pointer at any zoom", () => {
			viewport.scale = 4;
			settings.tool = "pan";
			c.pointerDown(ev("pen", 10, 10));
			c.pointerMove(ev("pen", 50, 10));
			c.pointerUp(ev("pen", 50, 10));
			expect(viewport.toScreen(0, 0)[0]).toBeCloseTo(40);
		});

		test("reports whether a pointer is busy (so touches can be ignored)", () => {
			expect(c.busy).toBe(false);
			c.pointerDown(ev("pen", 0, 0));
			expect(c.busy).toBe(true);
			c.pointerUp(ev("pen", 0, 0));
			expect(c.busy).toBe(false);
		});
	});

	describe("shapes", () => {
		test("the line tool draws a two-point line from press to release", () => {
			settings.tool = "line";
			c.pointerDown(ev("pen", 10, 20));
			c.pointerMove(ev("pen", 50, 30));
			c.pointerMove(ev("pen", 100, 80));
			c.pointerUp(ev("pen", 100, 80));
			const s = board.strokes[0];
			expect(s.kind).toBe("line");
			expect(s.points.map((p) => [p[0], p[1]])).toEqual([
				[10, 20],
				[100, 80],
			]);
			expect([s.color, s.size, s.authorId]).toEqual(["#c00", 4, "me"]);
		});

		test("the rect tool stores two corners", () => {
			settings.tool = "rect";
			c.pointerDown(ev("mouse", 5, 5));
			c.pointerMove(ev("mouse", 65, 45));
			c.pointerUp(ev("mouse", 65, 45));
			expect(board.strokes[0].kind).toBe("rect");
			expect(board.strokes[0].points.map((p) => [p[0], p[1]])).toEqual([
				[5, 5],
				[65, 45],
			]);
		});

		test("the oval tool stores an ellipse as two opposite corners of its box", () => {
			settings.tool = "circle";
			c.pointerDown(ev("pen", 100, 100));
			c.pointerMove(ev("pen", 300, 160));
			c.pointerUp(ev("pen", 300, 160));
			expect(board.strokes[0].kind).toBe("ellipse");
			expect(board.strokes[0].points.map((p) => [p[0], p[1]])).toEqual([
				[100, 100],
				[300, 160],
			]);
		});

		test("a preview is shown while dragging and cleared on release", () => {
			settings.tool = "rect";
			c.pointerDown(ev("pen", 0, 0));
			c.pointerMove(ev("pen", 40, 40));
			expect(renderer.drawLive).toHaveBeenLastCalledWith(
				expect.objectContaining({ kind: "rect" }),
			);
			c.pointerUp(ev("pen", 40, 40));
			expect(renderer.drawLive).toHaveBeenLastCalledWith(null);
		});

		test("a click without dragging does not create a shape", () => {
			settings.tool = "circle";
			c.pointerDown(ev("pen", 10, 10));
			c.pointerUp(ev("pen", 10, 10));
			expect(board.strokes).toHaveLength(0);
		});

		test("shapes use board coordinates in a moved and zoomed view", () => {
			viewport.x = 100;
			viewport.y = 0;
			viewport.scale = 2;
			settings.tool = "line";
			c.pointerDown(ev("pen", 0, 0));
			c.pointerMove(ev("pen", 100, 50));
			c.pointerUp(ev("pen", 100, 50));
			expect(board.strokes[0].points.map((p) => [p[0], p[1]])).toEqual([
				[100, 0],
				[150, 25],
			]);
		});

		test("a shape can be undone and erased like a stroke", () => {
			settings.tool = "rect";
			c.pointerDown(ev("pen", 0, 0));
			c.pointerMove(ev("pen", 100, 60));
			c.pointerUp(ev("pen", 100, 60));
			settings.tool = "eraser";
			c.pointerDown(ev("pen", 50, 0)); // on the top edge
			c.pointerUp(ev("pen", 50, 0));
			expect(board.strokes).toHaveLength(0);
			c.undo();
			expect(board.strokes).toHaveLength(1);
		});
	});

	describe("text", () => {
		test("a tap with the text tool asks for a text at that board position", () => {
			const onTextRequest = vi.fn();
			c.onTextRequest = onTextRequest;
			viewport.x = 100;
			viewport.scale = 2;
			settings.tool = "text";
			c.pointerDown(ev("pen", 40, 20));
			c.pointerUp(ev("pen", 40, 20));
			expect(onTextRequest).toHaveBeenCalledWith([120, 10]);
			expect(board.strokes).toHaveLength(0);
		});

		test("addText creates a text element with the current colour and size", () => {
			settings.size = 10;
			c.addText("Hello", 30, 40);
			const t = board.strokes[0];
			expect(t).toMatchObject({
				kind: "text",
				text: "Hello",
				color: "#c00",
				size: 10,
				authorId: "me",
			});
			expect([t.points[0][0], t.points[0][1]]).toEqual([30, 40]);
		});

		test("addText ignores empty and whitespace-only text", () => {
			c.addText("", 0, 0);
			c.addText("  \n ", 0, 0);
			expect(board.strokes).toHaveLength(0);
		});

		test("text can be undone", () => {
			c.addText("Hi", 0, 0);
			c.undo();
			expect(board.strokes).toHaveLength(0);
		});
	});

	describe("draw aids with Shift", () => {
		const shifted = { shiftKey: true };
		const last = () => board.strokes[board.strokes.length - 1];
		const ends = () => last().points.map((p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]);

		test("a rectangle dragged with Shift is a square", () => {
			settings.tool = "rect";
			c.pointerDown(ev("pen", 100, 100));
			c.pointerMove(ev("pen", 300, 160, shifted));
			c.pointerUp(ev("pen", 300, 160, shifted));
			expect(ends()).toEqual([[100, 100], [300, 300]]);
		});

		test("an ellipse dragged with Shift is a circle", () => {
			settings.tool = "circle";
			c.pointerDown(ev("pen", 100, 100));
			c.pointerMove(ev("pen", 300, 160, shifted));
			c.pointerUp(ev("pen", 300, 160, shifted));
			expect(last().kind).toBe("ellipse");
			expect(ends()).toEqual([[100, 100], [300, 300]]);
		});

		test("a line dragged with Shift snaps to 15 degrees and keeps its length", () => {
			settings.tool = "line";
			const len = 200;
			const a = (20 * Math.PI) / 180; // 20 degrees
			c.pointerDown(ev("pen", 100, 100));
			c.pointerMove(ev("pen", 100 + len * Math.cos(a), 100 + len * Math.sin(a), shifted));
			c.pointerUp(ev("pen", 100 + len * Math.cos(a), 100 + len * Math.sin(a), shifted));
			const f = (15 * Math.PI) / 180;
			expect(ends()).toEqual([[100, 100], [Math.round((100 + len * Math.cos(f)) * 1000) / 1000, Math.round((100 + len * Math.sin(f)) * 1000) / 1000]]);
		});

		test("the preview follows Shift as it is pressed and released during the drag", () => {
			settings.tool = "rect";
			c.pointerDown(ev("pen", 0, 0));
			c.pointerMove(ev("pen", 100, 40, shifted));
			expect(renderer.drawLive).toHaveBeenLastCalledWith(expect.objectContaining({ points: [[0, 0, 0.5], [100, 100, 0.5]] }));
			c.pointerMove(ev("pen", 100, 40));
			expect(renderer.drawLive).toHaveBeenLastCalledWith(expect.objectContaining({ points: [[0, 0, 0.5], [100, 40, 0.5]] }));
		});

		test("the state of Shift at release decides the final shape", () => {
			settings.tool = "rect";
			c.pointerDown(ev("pen", 0, 0));
			c.pointerMove(ev("pen", 100, 40));
			c.pointerUp(ev("pen", 100, 40, shifted));
			expect(ends()).toEqual([[0, 0], [100, 100]]);
		});

		test("without Shift shapes stay free", () => {
			settings.tool = "rect";
			c.pointerDown(ev("pen", 0, 0));
			c.pointerMove(ev("pen", 100, 40));
			c.pointerUp(ev("pen", 100, 40));
			expect(ends()).toEqual([[0, 0], [100, 40]]);
		});

		test("Shift does not affect freehand drawing", () => {
			settings.tool = "pen";
			c.pointerDown(ev("pen", 0, 0));
			c.pointerMove(ev("pen", 100, 40, shifted));
			c.pointerUp(ev("pen", 100, 40, shifted));
			expect(last().points.at(-1)?.slice(0, 2)).toEqual([100, 40]);
		});
	});
});
