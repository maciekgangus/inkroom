import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board, type BoardOp, type Stroke } from "./board";
import {
	Controller,
	type PointerInput,
	type Renderer,
	type Settings,
} from "./controller";
import { cornerPos, frameOf, rotationHandlePos } from "./selection-frame";
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
const SHIFT = { shiftKey: true };

const base = { authorId: "a", color: "#111", size: 4, z: 0 };
const pt = (x: number, y: number) => [x, y, 0.5] as [number, number, number];
/** A filled rectangle, so it can be grabbed anywhere inside. */
const box = (
	id: string,
	a: [number, number],
	b: [number, number],
	extra: Partial<Stroke> = {},
): Stroke => ({
	...base,
	id,
	kind: "rect",
	fill: "#fcc",
	points: [pt(...a), pt(...b)],
	...extra,
});

describe("Controller selection", () => {
	let board: Board;
	let renderer: Renderer;
	let settings: Settings;
	let viewport: Viewport;
	let c: Controller;
	let ops: BoardOp[];

	const get = (id: string) => board.strokes.find((s) => s.id === id) as Stroke;
	const corners = (id: string) =>
		get(id).points.map((p) => [
			Math.round(p[0] * 1000) / 1000,
			Math.round(p[1] * 1000) / 1000,
		]);
	const selIds = () => c.selection.map((s) => s.id);
	const drag = (
		from: [number, number],
		to: [number, number],
		extra: Partial<PointerInput> = {},
	) => {
		c.pointerDown(ev("pen", ...from, extra));
		c.pointerMove(ev("pen", ...to, extra));
		c.pointerUp(ev("pen", ...to, extra));
	};
	const click = (x: number, y: number, extra: Partial<PointerInput> = {}) =>
		drag([x, y], [x, y], extra);

	beforeEach(() => {
		board = new Board();
		renderer = {
			drawLive: vi.fn(),
			redraw: vi.fn(),
			setSelection: vi.fn(),
			setMarquee: vi.fn(),
		};
		settings = { tool: "select", color: "#111", size: 4 };
		viewport = new Viewport();
		let n = 0;
		c = new Controller(
			board,
			renderer,
			settings,
			viewport,
			"me",
			() => `e${++n}`,
		);
		board.addStroke(box("r1", [100, 100], [300, 200])); // 200 x 100
		board.addStroke(box("r2", [400, 100], [450, 150]));
		ops = [];
		board.onOp = (op) => ops.push(op);
	});

	describe("choosing what is selected", () => {
		test("addImage creates an image element with its source and corners, and selects it", () => {
			const id = c.addImage("pic", { minX: 10, minY: 20, maxX: 110, maxY: 70 });
			expect(get(id)).toMatchObject({
				kind: "image",
				src: "pic",
				authorId: "me",
			});
			expect(corners(id)).toEqual([
				[10, 20],
				[110, 70],
			]);
			expect(selIds()).toEqual([id]);
		});

		test("an added image can be undone", () => {
			const id = c.addImage("pic", { minX: 10, minY: 20, maxX: 110, maxY: 70 });
			c.undo();
			expect(board.strokes.some((s) => s.id === id)).toBe(false);
		});

		test("clicking an object of any kind selects it", () => {
			board.addStroke({
				...base,
				id: "pen1",
				points: [pt(0, 400), pt(200, 400)],
			});
			click(100, 402);
			expect(selIds()).toEqual(["pen1"]);
			click(200, 150);
			expect(selIds()).toEqual(["r1"]);
		});

		test("the topmost object under the pointer wins", () => {
			board.addStroke(box("top", [150, 120], [250, 180], { z: 5 }));
			click(200, 150);
			expect(selIds()).toEqual(["top"]);
		});

		test("clicking empty space clears the selection", () => {
			c.select("r1");
			click(700, 700);
			expect(c.selection).toEqual([]);
			expect(renderer.setSelection).toHaveBeenLastCalledWith(null);
		});

		test("Shift+click adds an object and takes it out again", () => {
			c.select("r1");
			click(425, 125, SHIFT);
			expect(selIds()).toEqual(["r1", "r2"]);
			click(425, 125, SHIFT);
			expect(selIds()).toEqual(["r1"]);
		});

		test("the selection frame follows what is selected", () => {
			c.select("r1");
			// the frame stands a margin (16 px each side) off the objects
			expect(renderer.setSelection).toHaveBeenLastCalledWith({
				cx: 200,
				cy: 150,
				w: 232,
				h: 132,
				rot: 0,
			});
			c.select(["r1", "r2"]);
			expect(renderer.setSelection).toHaveBeenLastCalledWith({
				cx: 275,
				cy: 150,
				w: 382,
				h: 132,
				rot: 0,
			});
		});

		test("touch never selects or edits, and other tools leave objects alone", () => {
			c.pointerDown(ev("touch", 200, 150));
			expect(c.selection).toEqual([]);
			settings.tool = "pen";
			click(200, 150);
			expect(c.selection).toEqual([]);
		});
	});

	describe("rubber-band selection", () => {
		beforeEach(() => {
			board.addStroke(box("far", [800, 800], [850, 850]));
			ops.length = 0;
		});

		test("dragging over empty space selects whatever the frame touches", () => {
			drag([50, 50], [320, 220]);
			expect(selIds()).toEqual(["r1"]);
			drag([50, 50], [470, 220]);
			expect(selIds()).toEqual(["r1", "r2"]);
		});

		test("shows the rubber band while dragging and hides it on release", () => {
			c.pointerDown(ev("pen", 50, 50));
			c.pointerMove(ev("pen", 320, 220));
			expect(renderer.setMarquee).toHaveBeenLastCalledWith({
				minX: 50,
				minY: 50,
				maxX: 320,
				maxY: 220,
			});
			c.pointerUp(ev("pen", 320, 220));
			expect(renderer.setMarquee).toHaveBeenLastCalledWith(null);
			expect(ops).toEqual([]); // selecting changes nothing on the board
		});

		test("works whichever way it is dragged", () => {
			drag([470, 220], [50, 50]);
			expect(selIds()).toEqual(["r1", "r2"]);
		});

		test("with Shift it adds to the selection", () => {
			c.select("far");
			drag([50, 50], [320, 220], SHIFT);
			expect(selIds().sort()).toEqual(["far", "r1"]);
		});
	});

	describe("moving", () => {
		test("dragging an object moves it, as one update and one undo step", () => {
			c.pointerDown(ev("pen", 200, 150));
			c.pointerMove(ev("pen", 220, 160));
			expect(ops).toEqual([]); // the preview is local only
			expect(corners("r1")[0]).toEqual([120, 110]);
			c.pointerMove(ev("pen", 230, 170));
			c.pointerUp(ev("pen", 230, 170));
			expect(corners("r1")).toEqual([
				[130, 120],
				[330, 220],
			]);
			expect(ops).toHaveLength(1);
			expect(ops[0]).toMatchObject({ t: "update" });
			c.undo();
			expect(corners("r1")).toEqual([
				[100, 100],
				[300, 200],
			]);
			expect(selIds()).toEqual(["r1"]);
		});

		test("a click without dragging changes nothing", () => {
			click(200, 150);
			expect(ops).toEqual([]);
		});

		test("several selected objects move together as one undo step", () => {
			c.select(["r1", "r2"]);
			drag([200, 150], [210, 170]);
			expect(corners("r1")[0]).toEqual([110, 120]);
			expect(corners("r2")[0]).toEqual([410, 120]);
			expect(ops.map((o) => o.t)).toEqual(["update", "update"]);
			c.undo();
			expect(corners("r1")[0]).toEqual([100, 100]);
			expect(corners("r2")[0]).toEqual([400, 100]);
		});

		test("grabbing an unselected object selects it and moves just that one", () => {
			c.select("r2");
			drag([200, 150], [210, 150]);
			expect(selIds()).toEqual(["r1"]);
			expect(corners("r2")[0]).toEqual([400, 100]);
		});
	});

	describe("scaling", () => {
		test("dragging a corner scales from the opposite corner with proportions kept", () => {
			c.select("r1");
			drag([316, 216], [516, 316]); // the se handle, a margin off the corner
			expect(corners("r1")).toEqual([
				[100, 100],
				[500, 300],
			]);
			expect(ops).toHaveLength(1);
			c.undo();
			expect(corners("r1")).toEqual([
				[100, 100],
				[300, 200],
			]);
		});

		test("the handle is as big on screen whatever the zoom", () => {
			c.select("r1");
			viewport.scale = 2; // a 12 px grab radius is 6 board units
			drag([(300 + 8) * 2, (200 + 8) * 2], [700, 460]);
			expect(corners("r1")[0]).toEqual([100, 100]); // scaled from the nw corner, not moved
			expect(ops).toHaveLength(1);
		});

		test("cannot be shrunk to nothing", () => {
			c.select("r1");
			drag([316, 216], [117, 117]);
			const [a, b] = corners("r1");
			expect(b[0] - a[0]).toBeGreaterThan(5);
		});

		test("a text's font size grows with it", () => {
			board.addStroke({
				...base,
				id: "t1",
				kind: "text",
				text: "hello",
				size: 5,
				fontSize: 20,
				points: [pt(600, 600)],
			});
			c.select("t1");
			const f = frameOf([get("t1")]);
			if (!f) throw new Error("no frame");
			const se = cornerPos(f, "se");
			const nw = cornerPos(f, "nw");
			// pull the se corner to twice its distance from the nw corner (the handle is a margin off)
			drag(
				[se[0] + 16, se[1] + 16],
				[nw[0] + 2 * (se[0] - nw[0]) + 16, nw[1] + 2 * (se[1] - nw[1]) + 16],
			);
			expect(get("t1").fontSize).toBeCloseTo(40);
		});

		test("scales several objects around the selection's opposite corner", () => {
			c.select(["r1", "r2"]); // frame (100,100)-(450,200)
			drag([466, 216], [816, 316]); // se corner to twice the distance from nw (350 -> 700 wide)
			expect(corners("r1")).toEqual([
				[100, 100],
				[500, 300],
			]);
			expect(ops).toHaveLength(2);
		});
	});

	describe("rotating", () => {
		const center = { x: 200, y: 150 };
		const handle = (): [number, number] => {
			const f = frameOf(c.selection);
			if (!f) throw new Error("no frame");
			return rotationHandlePos({ ...f, w: f.w + 32, h: f.h + 32 }, 28);
		};
		const around = (angleFromUp: number): [number, number] => [
			center.x + 100 * Math.sin(angleFromUp),
			center.y - 100 * Math.cos(angleFromUp),
		];

		test("dragging the rotation handle turns the object, as one update", () => {
			c.select("r1");
			drag(handle(), [300, 150]); // from straight up to straight right: a quarter turn
			expect(get("r1").rot).toBeCloseTo(Math.PI / 2);
			expect(ops).toHaveLength(1);
			c.undo();
			expect(get("r1").rot ?? 0).toBe(0);
		});

		test("close to a right angle it snaps onto it", () => {
			c.select("r1");
			drag(handle(), around(Math.PI / 2 + 0.03));
			expect(get("r1").rot).toBeCloseTo(Math.PI / 2, 10);
		});

		test("with Shift it snaps to 15 degree steps", () => {
			c.select("r1");
			drag(handle(), around(0.35), SHIFT); // about 20 degrees
			expect(get("r1").rot).toBeCloseTo(Math.PI / 12);
		});

		test("without snapping an in-between angle is kept", () => {
			c.select("r1");
			drag(handle(), around(0.5));
			expect(get("r1").rot).toBeCloseTo(0.5, 2);
		});

		test("several objects turn around the middle of the selection as one body", () => {
			c.select(["r1", "r2"]); // frame centre (275, 125)
			const f = frameOf(c.selection);
			if (!f) throw new Error("no frame");
			const h = rotationHandlePos({ ...f, w: f.w + 32, h: f.h + 32 }, 28);
			drag(h, [f.cx + 100, f.cy]); // a quarter turn
			expect(get("r1").rot).toBeCloseTo(Math.PI / 2);
			expect(get("r2").rot).toBeCloseTo(Math.PI / 2);
			expect(ops).toHaveLength(2);
		});

		test("a rotated object is grabbed where it now is", () => {
			c.select("r1");
			drag(handle(), [300, 150]); // r1 now covers x 150..250, y 50..250
			click(700, 700);
			click(200, 240); // inside the new shape, outside the old one
			expect(selIds()).toEqual(["r1"]);
		});
	});

	describe("properties and deleting", () => {
		test("setProps restyles every selected object as one undo step", () => {
			c.select(["r1", "r2"]);
			expect(c.setProps({ color: "#f00" })).toBe(true);
			expect(get("r1").color).toBe("#f00");
			expect(get("r2").color).toBe("#f00");
			expect(ops).toHaveLength(2);
			c.undo();
			expect(get("r1").color).toBe("#111");
			expect(get("r2").color).toBe("#111");
		});

		test("setProps with nothing selected, or nothing that applies, does nothing", () => {
			expect(c.setProps({ color: "#f00" })).toBe(false);
			const id = c.addImage("pic", { minX: 0, minY: 500, maxX: 10, maxY: 510 });
			ops.length = 0;
			expect(c.setProps({ color: "#f00" })).toBe(false); // images have no colour
			expect(get(id).color).not.toBe("#f00");
			expect(ops).toEqual([]);
		});

		test("deleteSelected removes everything selected as one undo step", () => {
			c.select(["r1", "r2"]);
			expect(c.deleteSelected()).toBe(true);
			expect(board.strokes).toEqual([]);
			expect(c.selection).toEqual([]);
			c.undo();
			expect(board.strokes.map((s) => s.id)).toEqual(["r1", "r2"]);
		});

		test("deleteSelected with nothing selected does nothing", () => {
			expect(c.deleteSelected()).toBe(false);
		});
	});

	describe("text", () => {
		beforeEach(() => {
			board.addStroke({
				...base,
				id: "t1",
				kind: "text",
				text: "hello",
				size: 5,
				points: [pt(600, 600)],
			});
		});

		test("editTextAt reports the text under the pointer", () => {
			const onTextEdit = vi.fn();
			c.onTextEdit = onTextEdit;
			c.editTextAt(610, 610);
			expect(onTextEdit).toHaveBeenCalledWith(
				expect.objectContaining({ id: "t1" }),
			);
			onTextEdit.mockClear();
			c.editTextAt(100, 100); // a rectangle, not a text
			expect(onTextEdit).not.toHaveBeenCalled();
		});

		test("commitText changes the content and can be undone", () => {
			c.commitText("t1", "bye");
			expect(get("t1").text).toBe("bye");
			c.undo();
			expect(get("t1").text).toBe("hello");
		});

		test("committing a blank text deletes it", () => {
			c.commitText("t1", "   ");
			expect(board.strokes.some((s) => s.id === "t1")).toBe(false);
		});
	});
});
