import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Board, type Stroke } from "./board";
import {
	Controller,
	type PointerInput,
	type Renderer,
	type Settings,
} from "./controller";
import { Viewport } from "./viewport";

const pt = (x: number, y: number) => [x, y, 0.5] as [number, number, number];
const base = { authorId: "a", color: "#111", size: 4, z: 1 };
const line = (id: string): Stroke => ({
	...base,
	id,
	kind: "line",
	points: [pt(100, 100), pt(300, 100)],
});
const pen = (id: string): Stroke => ({
	...base,
	id,
	points: [pt(100, 300), pt(200, 320), pt(300, 300)],
});
const rect = (id: string): Stroke => ({
	...base,
	id,
	kind: "rect",
	points: [pt(500, 100), pt(600, 200)],
});
const ev = (
	x: number,
	y: number,
	extra: Partial<PointerInput> = {},
): PointerInput => ({
	pointerId: 1,
	pointerType: "mouse",
	clientX: x,
	clientY: y,
	pressure: 0.5,
	button: 0,
	buttons: 0,
	...extra,
});

describe("Controller hover in the select tool (R-112)", () => {
	let board: Board;
	let renderer: {
		[K in keyof Renderer]-?: ReturnType<typeof vi.fn>;
	};
	let c: Controller;
	let settings: Settings;
	let now: number;

	beforeEach(() => {
		now = 1_000_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		board = new Board();
		renderer = {
			drawLive: vi.fn(),
			redraw: vi.fn(),
			moveView: vi.fn(),
			setSelection: vi.fn(),
			setMarquee: vi.fn(),
			setHighlight: vi.fn(),
			setEndpoints: vi.fn(),
			setDrag: vi.fn(),
			setAdjust: vi.fn(),
			setVertices: vi.fn(),
			setLasso: vi.fn(),
			setHover: vi.fn(),
		};
		settings = { tool: "select", color: "#111", size: 4 };
		c = new Controller(
			board,
			renderer as unknown as Renderer,
			settings,
			new Viewport(),
			"me",
			() => "n",
		);
		for (const s of [line("l"), pen("p"), rect("r")]) board.addStroke(s);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("the object under the cursor is highlighted before any click, and cleared on empty space", () => {
		c.pointerHover(ev(200, 100));
		expect(renderer.setHover).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "l" }),
		);
		now += 100;
		c.pointerHover(ev(200, 500));
		expect(renderer.setHover).toHaveBeenLastCalledWith(null);
	});

	test("a hovering pen (tip off the glass, pressure 0) highlights too", () => {
		c.pointerHover(ev(200, 310, { pointerType: "pen", pressure: 0 }));
		expect(renderer.setHover).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "p" }),
		);
	});

	test("a hovering pen that reports buttons=1 still highlights: contact is pressure, not buttons", () => {
		// A hovering S Pen/Apple Pencil can send pointermove with buttons=1 while the tip is
		// off the glass; only pressure>0 means a drawing contact.
		c.pointerHover(
			ev(200, 310, { pointerType: "pen", pressure: 0, buttons: 1 }),
		);
		expect(renderer.setHover).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "p" }),
		);
		now += 100;
		c.pointerHover(
			ev(200, 310, { pointerType: "pen", pressure: 0.5, buttons: 1 }),
		);
		expect(renderer.setHover).toHaveBeenLastCalledWith(null);
	});

	test("hover highlights exactly the object a click grabs: 5 px off a thin line (R-072)", () => {
		c.pointerHover(ev(200, 105));
		expect(renderer.setHover).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "l" }),
		);
		c.pointerDown(ev(200, 105));
		c.pointerUp(ev(200, 105));
		expect(c.selection.map((s) => s.id)).toEqual(["l"]);
	});

	test("when objects overlap, hover and click both take the topmost one", () => {
		board.addStroke({
			...base,
			id: "top",
			z: 99,
			points: [pt(150, 95), pt(250, 105), pt(200, 90)],
		});
		c.pointerHover(ev(200, 100));
		expect(renderer.setHover).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "top" }),
		);
		c.pointerDown(ev(200, 100));
		c.pointerUp(ev(200, 100));
		expect(c.selection.map((s) => s.id)).toEqual(["top"]);
	});

	test("hover and click agree on a rotated object", () => {
		board.addStroke({
			...base,
			id: "rot",
			kind: "rect",
			rot: Math.PI / 4,
			points: [pt(400, 400), pt(500, 500)],
		});
		// The middle of the rect's right edge, turned by 45 degrees around (450, 450).
		const s = Math.SQRT1_2 * 50;
		const at = [450 + s, 450 + s] as const;
		c.pointerHover(ev(at[0], at[1]));
		expect(renderer.setHover).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "rot" }),
		);
		c.pointerDown(ev(at[0], at[1]));
		c.pointerUp(ev(at[0], at[1]));
		expect(c.selection.map((s2) => s2.id)).toEqual(["rot"]);
	});

	test("no hover for touch, a pressed button, readOnly, another tool or a gesture", () => {
		c.pointerHover(ev(200, 100, { pointerType: "touch" }));
		c.pointerHover(ev(200, 100, { buttons: 1 }));
		c.pointerHover(ev(200, 100, { pointerType: "pen", pressure: 0.5 }));
		c.readOnly = true;
		c.pointerHover(ev(200, 100));
		c.readOnly = false;
		settings.tool = "pen";
		c.pointerHover(ev(200, 100));
		settings.tool = "select";
		c.pointerDown(ev(200, 100)); // a gesture begins
		c.pointerHover(ev(200, 100));
		c.pointerUp(ev(200, 100));
		expect(renderer.setHover).not.toHaveBeenCalled();
	});

	test("a selected object gets no second hover (it already glows, R-058)", () => {
		c.pointerHover(ev(200, 100));
		expect(renderer.setHover).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "l" }),
		);
		c.select("l");
		expect(renderer.setHover).toHaveBeenLastCalledWith(null);
		now += 100;
		c.pointerHover(ev(200, 100));
		expect(renderer.setHover).toHaveBeenCalledTimes(2); // still just: l, then null
	});

	test("over a handle of the active selection the hover is cleared, the object under it ignored", () => {
		board.addStroke({
			...base,
			id: "under",
			kind: "rect",
			points: [pt(600, 200), pt(640, 240)],
		});
		c.select("r");
		const f = renderer.setSelection.mock.lastCall?.[0];
		const se = [f.cx + f.w / 2, f.cy + f.h / 2] as const;
		c.pointerHover(ev(se[0], se[1])); // on the corner handle, over "under"
		expect(renderer.setHover).not.toHaveBeenCalled();
		now += 100;
		c.pointerHover(ev(635, 235)); // inside "under", away from every handle
		expect(renderer.setHover).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "under" }),
		);
	});

	test("no hover when the selection is very large, while a huge board still hovers via the spatial index", () => {
		const many: Stroke[] = [];
		for (let i = 0; i < 51; i++)
			many.push({
				...base,
				id: `m${i}`,
				z: 100 + i,
				points: [pt(i * 30, 600), pt(i * 30 + 20, 600)],
			});
		for (const s of many) board.addStroke(s);
		c.select(many.map((s) => s.id));
		c.pointerHover(ev(200, 100));
		expect(renderer.setHover).not.toHaveBeenCalled();
		c.select(null);
		for (let i = 0; i < 5001; i++)
			board.addStroke({
				...base,
				id: `b${i}`,
				z: 1000 + i,
				points: [pt(0, 1000 + i * 2), pt(10, 1000 + i * 2)],
			});
		const qp = vi.spyOn(board, "queryPoint");
		c.pointerHover(ev(200, 100));
		expect(qp).toHaveBeenCalled();
		expect(renderer.setHover).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "l" }),
		);
	});

	test("the hover check is throttled to ~50 ms while the pointer moves", () => {
		c.pointerHover(ev(200, 100));
		expect(renderer.setHover).toHaveBeenCalledTimes(1);
		c.pointerHover(ev(200, 500)); // within 50 ms: not checked yet
		expect(renderer.setHover).toHaveBeenCalledTimes(1);
		now += 100;
		c.pointerHover(ev(200, 500));
		expect(renderer.setHover).toHaveBeenLastCalledWith(null);
		expect(renderer.setHover).toHaveBeenCalledTimes(2);
	});

	test("a move swallowed by the throttle is looked for when the window is over: the resting place glows", () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			c.pointerHover(ev(200, 100));
			expect(renderer.setHover).toHaveBeenLastCalledWith(
				expect.objectContaining({ id: "l" }),
			);
			c.pointerHover(ev(200, 500)); // throttled: kept for later
			expect(renderer.setHover).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(60); // the window is over
			expect(renderer.setHover).toHaveBeenLastCalledWith(null);
			expect(renderer.setHover).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	test("a fresh check cancels a stale throttled one: the newest position wins, no flicker back", () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			c.pointerHover(ev(200, 100)); // leading: the line
			expect(renderer.setHover).toHaveBeenLastCalledWith(
				expect.objectContaining({ id: "l" }),
			);
			c.pointerHover(ev(200, 500)); // throttled: empty space kept for later
			expect(renderer.setHover).toHaveBeenCalledTimes(1);
			now += 100;
			c.pointerHover(ev(200, 100)); // leading again, back on the line
			expect(renderer.setHover).toHaveBeenCalledTimes(1); // still the line, no new call
			vi.advanceTimersByTime(200); // the stale timer must not clear it
			expect(renderer.setHover).toHaveBeenCalledTimes(1);
			expect(renderer.setHover).toHaveBeenLastCalledWith(
				expect.objectContaining({ id: "l" }),
			);
		} finally {
			vi.useRealTimers();
		}
	});

	test("pointerdown, clearHover and hideFrame clear the hover at once", () => {
		c.pointerHover(ev(200, 100));
		c.pointerDown(ev(200, 100));
		expect(renderer.setHover).toHaveBeenLastCalledWith(null);
		c.pointerUp(ev(200, 100)); // the click grabbed "l"
		c.select(null);
		now += 100;
		c.pointerHover(ev(200, 100));
		expect(renderer.setHover).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "l" }),
		);
		c.clearHover();
		expect(renderer.setHover).toHaveBeenLastCalledWith(null);
		now += 100;
		c.pointerHover(ev(200, 100));
		c.hideFrame(); // the view moves
		expect(renderer.setHover).toHaveBeenLastCalledWith(null);
	});

	test("a remote erase or update of the hovered object clears the hover", () => {
		c.pointerHover(ev(200, 100));
		expect(renderer.setHover).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "l" }),
		);
		board.applyRemote({ t: "update", stroke: { ...line("l"), color: "#f00" } });
		expect(renderer.setHover).toHaveBeenLastCalledWith(null);
		now += 100;
		c.pointerHover(ev(200, 100));
		expect(renderer.setHover).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "l" }),
		);
		board.applyRemote({ t: "remove", id: "l" });
		expect(renderer.setHover).toHaveBeenLastCalledWith(null);
	});

	test("a remote update that changes z also clears the hover", () => {
		c.pointerHover(ev(200, 100));
		expect(renderer.setHover).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "l" }),
		);
		board.applyRemote({
			t: "update",
			stroke: { ...line("l"), z: 999, color: "#090" },
		});
		expect(renderer.setHover).toHaveBeenLastCalledWith(null);
	});

	test("hover and click agree 1:1 on an elongated ellipse beyond its box and a rotated rect on an indexed board", () => {
		for (let i = 0; i < 220; i++)
			board.addStroke({
				...base,
				id: `pad${i}`,
				z: 10 + i,
				points: [pt(2000 + i * 20, 2000), pt(2010 + i * 20, 2000)],
			});
		// Elongated ellipse: box reaches x=404 (+8=412), while normalised-radius hit reaches x=450.
		board.addStroke({
			...base,
			id: "ell",
			kind: "ellipse",
			z: 500,
			points: [pt(0, 0), pt(400, 20)],
		});
		board.addStroke({
			...base,
			id: "rot2",
			kind: "rect",
			z: 501,
			rot: Math.PI / 4,
			points: [pt(700, 700), pt(800, 800)],
		});
		c.pointerHover(ev(450, 10));
		expect(renderer.setHover).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "ell" }),
		);
		c.pointerDown(ev(450, 10));
		c.pointerUp(ev(450, 10));
		expect(c.selection.map((s) => s.id)).toEqual(["ell"]);
		c.select(null);

		now += 100;
		const d = Math.SQRT1_2 * 50;
		c.pointerHover(ev(750 + d, 750 + d));
		expect(renderer.setHover).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "rot2" }),
		);
		c.pointerDown(ev(750 + d, 750 + d));
		c.pointerUp(ev(750 + d, 750 + d));
		expect(c.selection.map((s) => s.id)).toEqual(["rot2"]);
	});

	test("a pending throttled hover is ignored (and any hover cleared) if readOnly, tool or selection > 50 changed before the timer fires", () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			// 1. readOnly becomes true during throttle window
			c.pointerHover(ev(200, 100));
			expect(renderer.setHover).toHaveBeenLastCalledWith(
				expect.objectContaining({ id: "l" }),
			);
			c.pointerHover(ev(200, 310)); // throttled over "p"
			c.readOnly = true;
			vi.advanceTimersByTime(60);
			expect(renderer.setHover).toHaveBeenLastCalledWith(null);
			c.readOnly = false;

			// 2. tool changes away from select during throttle window
			now += 100;
			c.pointerHover(ev(200, 100));
			expect(renderer.setHover).toHaveBeenLastCalledWith(
				expect.objectContaining({ id: "l" }),
			);
			c.pointerHover(ev(200, 310)); // throttled over "p"
			settings.tool = "pen";
			vi.advanceTimersByTime(60);
			expect(renderer.setHover).toHaveBeenLastCalledWith(null);
			settings.tool = "select";

			// 3. selection grows past 50 during throttle window
			const manyIds: string[] = [];
			for (let i = 0; i < 51; i++) {
				const id = `sel${i}`;
				manyIds.push(id);
				board.addStroke({
					...base,
					id,
					z: 200 + i,
					points: [pt(i * 30, 700), pt(i * 30 + 20, 700)],
				});
			}
			now += 100;
			c.pointerHover(ev(200, 100));
			c.pointerHover(ev(200, 310)); // throttled over "p"
			c.select(manyIds); // clears hover to null
			const callsAfterSelect = renderer.setHover.mock.calls.length;
			vi.advanceTimersByTime(60);
			expect(renderer.setHover).toHaveBeenCalledTimes(callsAfterSelect);
			expect(renderer.setHover).toHaveBeenLastCalledWith(null);
		} finally {
			vi.useRealTimers();
		}
	});
});
