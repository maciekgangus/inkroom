import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board, type Stroke } from "./board";
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

	test("a new text can take the style chosen in the panel while it was typed", () => {
		c.addText("ala", 100, 120, 200, {
			color: "#d32f2f",
			size: 10,
			fontSize: 33,
			opacity: 0.5,
		});
		expect(board.strokes[0]).toMatchObject({
			color: "#d32f2f",
			size: 10,
			fontSize: 33,
			opacity: 0.5,
			width: 200,
		});
	});

	test("without a style it takes the current settings, as before", () => {
		c.addText("ala", 100, 120);
		expect(board.strokes[0]).toMatchObject({ color: "#111", size: 5 });
		expect(board.strokes[0].fontSize).toBeUndefined();
	});
});

describe("what the panel needs to know about the selection (R-042)", () => {
	let board: Board;
	let c: Controller;
	let changes: number;
	const text = (id: string, x: number, y: number): Stroke => ({
		id,
		authorId: "a",
		color: "#000",
		size: 5,
		z: 1,
		kind: "rect",
		points: [
			[x, y, 0.5],
			[x + 100, y + 50, 0.5],
		],
	});

	beforeEach(() => {
		board = new Board();
		const renderer: Renderer = {
			drawLive: vi.fn(),
			redraw: vi.fn(),
			setSelection: vi.fn(),
		};
		c = new Controller(
			board,
			renderer,
			{ tool: "select", color: "#111", size: 5 },
			new Viewport(),
			"me",
			() => "n",
		);
		board.addStroke(text("a", 100, 100));
		board.addStroke(text("b", 400, 300));
		changes = 0;
		c.onSelectionChange = () => void changes++;
	});

	test("the bounds of the selection, in board units", () => {
		expect(c.selectionBounds()).toBeNull();
		c.select("a");
		expect(c.selectionBounds()).toEqual({
			minX: 100,
			minY: 100,
			maxX: 200,
			maxY: 150,
		});
		c.select(["a", "b"]);
		expect(c.selectionBounds()).toEqual({
			minX: 100,
			minY: 100,
			maxX: 500,
			maxY: 350,
		});
	});

	test("the UI is told when an edit begins and when it ends, so the panel can hide and come back", () => {
		c.select("a");
		changes = 0;
		c.pointerDown(ev(150, 125));
		expect(changes).toBe(1);
		c.pointerMove(ev(170, 125));
		c.pointerUp(ev(170, 125));
		expect(changes).toBe(2);
	});

	test("the controller says whether a pointer is down", () => {
		c.select("a");
		expect(c.busy).toBe(false);
		c.pointerDown(ev(150, 125));
		expect(c.busy).toBe(true);
		c.pointerUp(ev(150, 125));
		expect(c.busy).toBe(false);
	});
});
