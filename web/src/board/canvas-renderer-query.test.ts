import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Stroke } from "./board";
import { CanvasRenderer } from "./canvas-renderer";
import type { Rect } from "./viewport";
import { Viewport } from "./viewport";

/** A 2d context that counts the calls, so a test can tell how many elements were drawn. */
const layer = () => {
	const target = { counts: {} as Record<string, number> };
	const ctx = new Proxy(target, {
		get: (t, k) => {
			if (k === "counts") return t.counts;
			if (k === "canvas") return {};
			if (typeof k === "string")
				return () => {
					t.counts[k] = (t.counts[k] ?? 0) + 1;
					return ctx;
				};
			return undefined;
		},
		set: () => true,
	});
	const canvas = {
		getContext: () => ctx,
		width: 100,
		height: 100,
		style: {} as Record<string, string>,
	};
	return {
		ctx: ctx as unknown as CanvasRenderingContext2D & {
			counts: Record<string, number>;
		},
		canvas: canvas as unknown as HTMLCanvasElement,
	};
};

const line = (
	id: string,
	a: [number, number],
	b: [number, number],
): Stroke => ({
	id,
	authorId: "a",
	color: "#111",
	size: 4,
	z: Number(id.slice(1)),
	kind: "line",
	points: [
		[a[0], a[1], 0.5],
		[b[0], b[1], 0.5],
	],
});

/** Twenty lines across the home view (1000x800 at scale 1). */
const twenty = (): Stroke[] =>
	Array.from({ length: 20 }, (_, i) =>
		line(`s${i}`, [i * 40 + 10, 10], [i * 40 + 50, 30]),
	);

describe("CanvasRenderer spatial query source (R-118)", () => {
	beforeEach(() => {
		vi.stubGlobal("requestAnimationFrame", undefined);
		vi.stubGlobal("innerWidth", 1000);
		vi.stubGlobal("innerHeight", 800);
		vi.stubGlobal("devicePixelRatio", 1);
		vi.stubGlobal(
			"Path2D",
			class {
				moveTo() {}
				lineTo() {}
				quadraticCurveTo() {}
				closePath() {}
				rect() {}
				ellipse() {}
				arc() {}
			},
		);
	});
	afterEach(() => vi.unstubAllGlobals());

	test("paintCommitted asks the query source which elements to draw, with the view and the given list", () => {
		const a = layer();
		const r = new CanvasRenderer(a.canvas, layer().canvas, new Viewport());
		const strokes = twenty();
		const query = vi.fn((_rect: Rect, all: readonly Stroke[]) =>
			all.slice(0, 3),
		);
		r.setQuery(query);
		r.redraw(strokes);
		expect(query).toHaveBeenCalledTimes(1);
		expect(query.mock.calls[0][0]).toMatchObject({
			minX: 0,
			minY: 0,
			maxX: 1000,
			maxY: 800,
		});
		expect(query.mock.calls[0][1]).toBe(strokes);
		// Only the three returned elements were stroked.
		expect(a.ctx.counts.stroke).toBe(3);
	});

	test("without a query source the renderer draws the whole list given to redraw", () => {
		const a = layer();
		const r = new CanvasRenderer(a.canvas, layer().canvas, new Viewport());
		r.redraw(twenty());
		expect(a.ctx.counts.stroke).toBe(20);
	});

	test("the query sees the exact array passed to redraw, so a foreign list can fall back to itself", () => {
		const a = layer();
		const r = new CanvasRenderer(a.canvas, layer().canvas, new Viewport());
		const mine = twenty();
		const foreign = twenty().map((s) => ({ ...s, id: `x${s.id}` }));
		// What board-view.tsx wires: use the index only when redraw got the board's own array.
		r.setQuery((_rect, all) => (all === mine ? all.slice(0, 5) : all));
		r.redraw(foreign);
		expect(a.ctx.counts.stroke).toBe(20); // foreign list: drawn whole, as before
		r.redraw(mine);
		expect(a.ctx.counts.stroke).toBe(20 + 5); // the board's list: only the query's five
	});

	test("elements being dragged are still left out when a query source is set", () => {
		const a = layer();
		const r = new CanvasRenderer(a.canvas, layer().canvas, new Viewport());
		const strokes = twenty();
		r.setQuery((_rect, all) => all);
		r.setDrag({ ids: ["s0"], elements: [strokes[0]], offset: [10, 10] });
		r.redraw(strokes);
		expect(a.ctx.counts.stroke).toBe(19);
	});
});
