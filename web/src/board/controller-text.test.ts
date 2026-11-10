import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board } from "./board";
import {
	Controller,
	type PointerInput,
	type Renderer,
	type Settings,
} from "./controller";
import { Viewport } from "./viewport";

const ev = (x: number, y: number): PointerInput => ({
	pointerId: 1,
	pointerType: "mouse",
	clientX: x,
	clientY: y,
	pressure: 0.5,
	button: 0,
});

describe("the text tool makes an area (R-044)", () => {
	let board: Board;
	let c: Controller;
	let marquees: unknown[];
	let requests: { at: [number, number]; area?: { w: number; h: number } }[];

	beforeEach(() => {
		board = new Board();
		marquees = [];
		requests = [];
		const renderer: Renderer = {
			drawLive: vi.fn(),
			redraw: vi.fn(),
			setMarquee: (r) => void marquees.push(r),
		};
		const settings: Settings = { tool: "text", color: "#111", size: 5 };
		let n = 0;
		c = new Controller(
			board,
			renderer,
			settings,
			new Viewport(),
			"me",
			() => `n${++n}`,
		);
		c.onTextRequest = (at, area) => void requests.push({ at, area });
	});

	const drag = (from: [number, number], to: [number, number]) => {
		c.pointerDown(ev(...from));
		c.pointerMove(ev(...to));
		c.pointerUp(ev(...to));
	};

	test("dragging asks for a text field in the area, anchored at its top left", () => {
		drag([300, 200], [100, 120]); // dragged up and to the left
		expect(requests).toEqual([{ at: [100, 120], area: { w: 200, h: 80 } }]);
	});

	test("a click asks for a text at a point, as before", () => {
		drag([300, 200], [300, 200]);
		expect(requests).toEqual([{ at: [300, 200], area: undefined }]);
	});

	test("a small wobble still counts as a click", () => {
		drag([300, 200], [304, 203]);
		expect(requests[0].area).toBeUndefined();
	});

	test("the area is shown as a rubber band while it is dragged, and removed after", () => {
		c.pointerDown(ev(100, 100));
		c.pointerMove(ev(250, 180));
		expect(marquees[marquees.length - 1]).toEqual({
			minX: 100,
			minY: 100,
			maxX: 250,
			maxY: 180,
		});
		c.pointerUp(ev(250, 180));
		expect(marquees[marquees.length - 1]).toBeNull();
	});

	test("nothing is added to the board until the text is committed", () => {
		drag([300, 200], [100, 120]);
		expect(board.strokes).toEqual([]);
	});

	test("addText with a width makes an area, without one a text at a point", () => {
		c.addText("ala ma kota", 100, 120, 200);
		c.addText("bez szerokości", 10, 10);
		expect(board.strokes[0]).toMatchObject({
			kind: "text",
			width: 200,
			text: "ala ma kota",
		});
		expect(board.strokes[1].width).toBeUndefined();
	});

	test("editing a text area keeps its width", () => {
		c.addText("ala", 100, 120, 200);
		const id = board.strokes[0].id;
		c.commitText(id, "ala ma kota");
		expect(board.strokes[0]).toMatchObject({ text: "ala ma kota", width: 200 });
	});

	test("an area that is left empty is not created", () => {
		c.addText("   ", 100, 120, 200);
		expect(board.strokes).toEqual([]);
	});
});
