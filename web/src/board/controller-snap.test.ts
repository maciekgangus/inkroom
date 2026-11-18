import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Board, type Stroke } from "./board";
import {
	Controller,
	type PointerInput,
	type Renderer,
	type Settings,
} from "./controller";
import { Viewport } from "./viewport";

const ev = (x: number, y: number, type = "mouse"): PointerInput => ({
	pointerId: 1,
	pointerType: type,
	clientX: x,
	clientY: y,
	pressure: 0.5,
	button: 0,
});

describe("holding the pen still snaps the stroke to a shape (R-095)", () => {
	let board: Board;
	let settings: Settings;
	let c: Controller;
	let live: ReturnType<typeof vi.fn<(s: Stroke | null) => void>>;
	/** The stroke last shown on the live layer. */
	const shown = (): Stroke => {
		const last = live.mock.calls.at(-1)?.[0];
		if (!last) throw new Error("nothing is shown");
		return last;
	};

	beforeEach(() => {
		vi.useFakeTimers();
		board = new Board();
		live = vi.fn<(s: Stroke | null) => void>();
		const renderer: Renderer = { drawLive: live, redraw: vi.fn() };
		settings = { tool: "pen", color: "#111", size: 2, snapShapes: true };
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
	afterEach(() => vi.useRealTimers());

	/** Draws a roughly circular loop around (300, 300), ending where it began, without lifting. */
	const loop = () => {
		c.pointerDown(ev(400, 300));
		for (let i = 1; i <= 40; i++) {
			const t = (i / 40) * Math.PI * 2;
			const wobble = 1 + 0.03 * Math.sin(i * 1.7);
			c.pointerMove(
				ev(300 + 100 * wobble * Math.cos(t), 300 + 100 * wobble * Math.sin(t)),
			);
		}
	};

	test("after half a second of holding, a round loop becomes an ellipse", () => {
		loop();
		expect(live).toHaveBeenLastCalledWith(
			expect.not.objectContaining({ kind: expect.anything() }),
		);
		vi.advanceTimersByTime(520);
		expect(shown().kind).toBe("ellipse");
		c.pointerUp(ev(400, 300));
		expect(board.strokes).toHaveLength(1);
		expect(board.strokes[0].kind).toBe("ellipse");
	});

	test("nothing happens before the half second is up", () => {
		loop();
		vi.advanceTimersByTime(300);
		c.pointerUp(ev(400, 300));
		expect(board.strokes[0].kind).toBeUndefined();
	});

	test("moving the pen restarts the wait", () => {
		loop();
		vi.advanceTimersByTime(400);
		c.pointerMove(ev(450, 350));
		vi.advanceTimersByTime(400);
		c.pointerUp(ev(450, 350));
		expect(board.strokes[0].kind).toBeUndefined();
	});

	test("a tremor of a few pixels does not restart the wait", () => {
		loop();
		vi.advanceTimersByTime(300);
		c.pointerMove(ev(401, 301));
		vi.advanceTimersByTime(300);
		c.pointerUp(ev(401, 301));
		expect(board.strokes[0].kind).toBe("ellipse");
	});

	test("a pen and a mouse snap the same way (a finger only pans and zooms, R-069)", () => {
		for (const type of ["pen", "mouse"]) {
			board.setStrokes([]);
			c.pointerDown(ev(400, 300, type));
			for (let i = 1; i <= 40; i++) {
				const t = (i / 40) * Math.PI * 2;
				c.pointerMove(
					ev(300 + 100 * Math.cos(t), 300 + 100 * Math.sin(t), type),
				);
			}
			vi.advanceTimersByTime(520);
			c.pointerUp(ev(400, 300, type));
			expect(board.strokes[0]?.kind).toBe("ellipse");
		}
	});

	test("a squiggle held still stays as drawn", () => {
		c.pointerDown(ev(100, 300));
		for (let i = 1; i <= 60; i++)
			c.pointerMove(ev(100 + i * 6, 300 + Math.sin(i / 2.5) * 50));
		vi.advanceTimersByTime(600);
		c.pointerUp(ev(460, 300));
		expect(board.strokes[0].kind).toBeUndefined();
	});

	test("the shape keeps the colour and width of the stroke", () => {
		settings.color = "#c33";
		settings.size = 4;
		loop();
		vi.advanceTimersByTime(520);
		c.pointerUp(ev(400, 300));
		expect(board.strokes[0]).toMatchObject({ color: "#c33", size: 4 });
		expect(board.strokes[0].dash).not.toBe("natural");
	});

	test("one undo brings back the stroke as it was drawn, a second removes it", () => {
		loop();
		const before = shown().points.length;
		vi.advanceTimersByTime(520);
		c.pointerUp(ev(400, 300));
		expect(board.undo("me")).toBe(true);
		expect(board.strokes).toHaveLength(1);
		expect(board.strokes[0].kind).toBeUndefined();
		expect(board.strokes[0].points.length).toBeGreaterThanOrEqual(before);
		expect(board.undo("me")).toBe(true);
		expect(board.strokes).toHaveLength(0);
	});

	test("with the switch off nothing is snapped", () => {
		settings.snapShapes = false;
		loop();
		vi.advanceTimersByTime(900);
		c.pointerUp(ev(400, 300));
		expect(board.strokes[0].kind).toBeUndefined();
	});

	test("a line snaps to 15 degrees and its end follows the pen while it is held", () => {
		c.pointerDown(ev(100, 300));
		for (let i = 1; i <= 30; i++)
			c.pointerMove(ev(100 + i * 10, 300 + i * 1.2));
		vi.advanceTimersByTime(520);
		expect(shown().kind).toBe("line");
		// still held: drag the end to a steeper place; it lands on a multiple of 15 degrees
		c.pointerMove(ev(400, 480));
		const [a, b] = shown().points;
		const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
		expect(angle / (Math.PI / 12)).toBeCloseTo(
			Math.round(angle / (Math.PI / 12)),
			5,
		);
		c.pointerUp(ev(400, 480));
		expect(board.strokes[0].kind).toBe("line");
	});

	test("a drawn circle stays a circle when the held pen is moved a little", () => {
		loop();
		vi.advanceTimersByTime(520);
		c.pointerMove(ev(410, 300));
		const [a, b] = shown().points;
		expect(Math.abs(b[0] - a[0])).toBeCloseTo(Math.abs(b[1] - a[1]), 5);
	});

	test("other tools are not snapped", () => {
		settings.tool = "line";
		c.pointerDown(ev(100, 100));
		c.pointerMove(ev(300, 150));
		vi.advanceTimersByTime(900);
		c.pointerUp(ev(300, 150));
		expect(board.strokes[0].kind).toBe("line");
	});
});
