import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board, type Stroke } from "./board";
import {
	Controller,
	type PointerInput,
	type Renderer,
	type Settings,
} from "./controller";
import { geomBox } from "./transform";
import { Viewport } from "./viewport";

const pt = (x: number, y: number) => [x, y, 0.5] as [number, number, number];
const base = { authorId: "a", color: "#111", size: 4, z: 1 };
const rect = (id = "r"): Stroke => ({
	...base,
	id,
	kind: "rect",
	points: [pt(100, 100), pt(300, 200)],
});
const line = (id = "l", extra: Partial<Stroke> = {}): Stroke => ({
	...base,
	id,
	kind: "line",
	points: [pt(100, 100), pt(300, 100)],
	...extra,
});
const ev = (x: number, y: number, shiftKey = false): PointerInput => ({
	pointerId: 1,
	pointerType: "mouse",
	clientX: x,
	clientY: y,
	pressure: 0.5,
	button: 0,
	shiftKey,
});

describe("edit handles (R-041)", () => {
	let board: Board;
	let c: Controller;
	let endpoints: ([number, number][] | null)[];
	let frames: unknown[];
	const get = (id: string) => board.strokes.find((s) => s.id === id) as Stroke;
	const drag = (
		from: [number, number],
		to: [number, number],
		shift = false,
	) => {
		c.pointerDown(ev(...from, shift));
		c.pointerMove(ev(...to, shift));
		c.pointerUp(ev(...to, shift));
	};
	const lastEnds = () => endpoints[endpoints.length - 1];

	beforeEach(() => {
		board = new Board();
		endpoints = [];
		frames = [];
		const renderer: Renderer = {
			drawLive: vi.fn(),
			redraw: vi.fn(),
			setSelection: (f) => frames.push(f),
			setHighlight: vi.fn(),
			setMarquee: vi.fn(),
			setEndpoints: (p) => endpoints.push(p),
		};
		const settings: Settings = { tool: "select", color: "#111", size: 4 };
		c = new Controller(
			board,
			renderer,
			settings,
			new Viewport(),
			"me",
			() => "n",
		);
		board.addStroke(rect());
		board.addStroke(line("l"));
		board.strokes
			.find((s) => s.id === "l")
			?.points.forEach((p) => {
				p[1] += 400; // the line lives below the rectangle: y = 500
			});
	});

	describe("the sides of a frame stretch one dimension", () => {
		test("the east side changes only the width, the west side stays", () => {
			c.select("r");
			drag([300, 150], [400, 150]);
			const b = geomBox(get("r"));
			expect([b.minX, b.maxX, b.minY, b.maxY]).toEqual([100, 400, 100, 200]);
		});

		test("the west side moves the left edge, the right one stays", () => {
			c.select("r");
			drag([100, 150], [40, 150]);
			const b = geomBox(get("r"));
			expect([b.minX, b.maxX, b.minY, b.maxY]).toEqual([40, 300, 100, 200]);
		});

		test("the north side changes only the height, the bottom stays", () => {
			c.select("r");
			drag([200, 100], [200, 50]);
			const b = geomBox(get("r"));
			expect([b.minX, b.maxX, b.minY, b.maxY]).toEqual([100, 300, 50, 200]);
		});

		test("the south side moves the bottom edge", () => {
			c.select("r");
			drag([200, 200], [200, 260]);
			const b = geomBox(get("r"));
			expect([b.minX, b.maxX, b.minY, b.maxY]).toEqual([100, 300, 100, 260]);
		});

		test("a side cannot be pulled past the other one", () => {
			c.select("r");
			drag([300, 150], [20, 150]);
			const b = geomBox(get("r"));
			expect(b.maxX).toBeGreaterThan(b.minX);
			expect(b.minX).toBeCloseTo(100);
		});

		test("with Shift the proportions stay", () => {
			c.select("r");
			drag([300, 150], [400, 150], true);
			const b = geomBox(get("r"));
			expect((b.maxX - b.minX) / (b.maxY - b.minY)).toBeCloseTo(2);
		});

		test("is one undo step", () => {
			c.select("r");
			drag([300, 150], [400, 150]);
			board.undo("me");
			expect(geomBox(get("r")).maxX).toBe(300);
		});
	});

	describe("a line has dots at its ends", () => {
		test("a lone line shows its two ends and no frame", () => {
			c.select("l");
			expect(lastEnds()).toEqual([
				[100, 500],
				[300, 500],
			]);
			expect(frames[frames.length - 1]).toBeNull();
		});

		test("other elements show no end dots, and several lines get a frame", () => {
			c.select("r");
			expect(lastEnds()).toBeNull();
			c.select(["l", "r"]);
			expect(lastEnds()).toBeNull();
			expect(frames[frames.length - 1]).not.toBeNull();
		});

		test("dragging the start moves only the start: the line is lengthened", () => {
			c.select("l");
			drag([100, 500], [20, 470]);
			expect(get("l").points.map((p) => [p[0], p[1]])).toEqual([
				[20, 470],
				[300, 500],
			]);
		});

		test("dragging the end moves only the end: the line is shortened", () => {
			c.select("l");
			drag([300, 500], [180, 500]);
			expect(get("l").points.map((p) => [p[0], p[1]])).toEqual([
				[100, 500],
				[180, 500],
			]);
		});

		test("with Shift the line snaps to steps of 15 degrees around the other end", () => {
			c.select("l");
			drag([300, 500], [380, 560], true); // about 36.9 degrees: snaps to 30 or 45
			const [a, b] = get("l").points;
			const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
			expect(angle % 15).toBeCloseTo(0, 6);
			expect(a.slice(0, 2)).toEqual([100, 500]); // the start did not move
		});

		test("is one undo step and the dots follow the new ends", () => {
			c.select("l");
			drag([300, 500], [180, 500]);
			expect(lastEnds()).toEqual([
				[100, 500],
				[180, 500],
			]);
			board.undo("me");
			expect(get("l").points[1].slice(0, 2)).toEqual([300, 500]);
		});

		test("grabbing the middle still moves the whole line", () => {
			c.select("l");
			drag([200, 500], [200, 560]);
			expect(get("l").points.map((p) => [p[0], p[1]])).toEqual([
				[100, 560],
				[300, 560],
			]);
		});

		test("a turned line shows its dots where its ends are, and editing one keeps the other in place", () => {
			board.eraseStroke("me", "l");
			board.addStroke(
				line("t", { rot: Math.PI / 2, points: [pt(100, 500), pt(300, 500)] }),
			);
			c.select("t");
			const [first, second] = lastEnds() as [number, number][];
			// turned a quarter about its centre (200, 500): the ends are now above and below it
			expect(first[0]).toBeCloseTo(200);
			expect(Math.abs(first[1] - 500)).toBeCloseTo(100);
			const stay = second;
			drag([first[0], first[1]], [first[0] + 50, first[1]]);
			const t = get("t");
			expect(t.rot).toBeUndefined(); // the turn is baked into the points
			const [a, b] = t.points;
			expect(a[0]).toBeCloseTo(first[0] + 50);
			expect(b[0]).toBeCloseTo(stay[0]);
			expect(b[1]).toBeCloseTo(stay[1]);
		});
	});
});
