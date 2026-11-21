import { afterEach, describe, expect, test, vi } from "vitest";
import type { Stroke } from "./board";

const outlines = vi.hoisted(() => ({ calls: 0 }));
vi.mock("perfect-freehand", async (orig) => {
	const real = await orig<typeof import("perfect-freehand")>();
	return {
		...real,
		getStroke: (...a: Parameters<typeof real.getStroke>) => {
			outlines.calls++;
			return real.getStroke(...a);
		},
	};
});

import { CanvasRenderer } from "./canvas-renderer";
import { Viewport } from "./viewport";

/** Counts the paths built and their vertices; the context swallows everything. */
function setup(budget?: number) {
	const stats = { paths: 0, vertices: 0, drawn: 0 };
	outlines.calls = 0;
	vi.stubGlobal("requestAnimationFrame", undefined);
	vi.stubGlobal(
		"Path2D",
		class {
			constructor() {
				stats.paths++;
			}
			moveTo() {
				stats.vertices++;
			}
			lineTo() {
				stats.vertices++;
			}
			quadraticCurveTo() {
				stats.vertices++;
			}
			closePath() {}
			rect() {}
			ellipse() {}
			arc() {}
		},
	);
	const ctx = new Proxy(
		{},
		{
			get: (_t, k) =>
				k === "canvas"
					? {}
					: (..._a: unknown[]) => {
							if (k === "lineTo" || k === "moveTo") stats.drawn++;
							return ctx;
						},
			set: () => true,
		},
	) as unknown as CanvasRenderingContext2D;
	const canvas = () =>
		({
			getContext: () => ctx,
			style: {},
			width: 100,
			height: 100,
		}) as unknown as HTMLCanvasElement;
	const viewport = new Viewport();
	const renderer = new CanvasRenderer(
		canvas(),
		canvas(),
		viewport,
		null,
		budget,
	);
	return { renderer, viewport, stats };
}

/** A hand-drawn wave of `n` samples starting at (x0, y0). */
function wave(id: string, x0: number, y0: number, n = 200): Stroke {
	return {
		id,
		authorId: "a",
		color: "#111",
		size: 2,
		z: 0,
		points: Array.from({ length: n }, (_, i) => [
			x0 + i * 1.5,
			y0 + Math.sin(i / 9) * 8,
			0.5,
		]) as [number, number, number][],
	};
}

afterEach(() => vi.unstubAllGlobals());

describe("the outline of a stroke seen from far away (R-100)", () => {
	test("at a tenth of the scale no path object is kept, a thinned polygon is drawn directly", () => {
		const close = setup();
		close.renderer.redraw([wave("s", 100, 100)]);
		const far = setup();
		far.viewport.scale = 0.1;
		far.renderer.redraw([wave("s", 100, 100)]);
		expect(close.stats.vertices).toBeGreaterThan(100);
		expect(far.stats.paths).toBe(0);
		expect(far.stats.drawn).toBeGreaterThan(3);
		expect(far.stats.drawn).toBeLessThan(close.stats.vertices * 0.5);
	});

	test("the polygon is kept: painting again does not build the outline again", () => {
		const { renderer, viewport } = setup();
		const s = wave("s", 100, 100);
		viewport.scale = 0.1;
		renderer.redraw([s]);
		expect(outlines.calls).toBe(1);
		renderer.redraw([s]);
		expect(outlines.calls).toBe(1);
	});

	test("zooming in builds the path again, zooming out keeps it", () => {
		const { renderer, viewport, stats } = setup();
		const s = wave("s", 100, 100);
		viewport.scale = 0.1;
		renderer.redraw([s]);
		expect(stats.paths).toBe(0);
		viewport.scale = 1;
		renderer.redraw([s]);
		expect(stats.paths).toBe(1); // built finer, as a path
		const built = outlines.calls;
		viewport.scale = 0.1;
		renderer.redraw([s]);
		expect(stats.paths).toBe(1);
		expect(outlines.calls).toBe(built); // the fine path still serves
	});

	test("a dashed stroke keeps its path at any distance (it is stroked, not filled)", () => {
		const { renderer, viewport, stats } = setup();
		viewport.scale = 0.1;
		renderer.redraw([{ ...wave("s", 100, 100), dash: "dashed" }]);
		expect(stats.paths).toBe(1);
	});
});

describe("the budget of cached paths (R-100)", () => {
	test("what a frame draws is kept even when it is more than the budget", () => {
		const { renderer, stats } = setup(1);
		const all = Array.from({ length: 20 }, (_, i) => wave(`s${i}`, 0, i * 30));
		renderer.redraw(all);
		expect(stats.paths).toBe(20);
		renderer.redraw(all);
		expect(stats.paths).toBe(20); // not built again: no thrashing
	});

	test("paths of elements out of view are dropped over the budget and built again on return", () => {
		// ten elements of 200 samples, a budget for about five
		const { renderer, viewport, stats } = setup(5 * 200 * 32);
		const all = Array.from({ length: 10 }, (_, i) =>
			wave(`s${i}`, i < 5 ? 0 : 5000, i * 30),
		);
		renderer.redraw(all); // the first five are in view
		expect(stats.paths).toBe(5);
		viewport.x = 5000 - 10; // now the other five
		renderer.redraw(all);
		expect(stats.paths).toBe(10);
		viewport.x = 0; // back: the first five were dropped, they are built again
		renderer.redraw(all);
		expect(stats.paths).toBe(15);
		viewport.x = 5000 - 10; // and the others, dropped in turn
		renderer.redraw(all);
		expect(stats.paths).toBe(20);
	});

	test("under the budget nothing is dropped", () => {
		const { renderer, viewport, stats } = setup(1e9);
		const all = [wave("a", 0, 0), wave("b", 5000, 0)];
		renderer.redraw(all);
		viewport.x = 4990;
		renderer.redraw(all);
		viewport.x = 0;
		renderer.redraw(all);
		expect(stats.paths).toBe(2);
	});

	test("polygons of a far view are dropped over the budget too", () => {
		const { renderer, viewport } = setup(1000);
		const all = Array.from({ length: 10 }, (_, i) =>
			wave(`s${i}`, i < 5 ? 0 : 20000, i * 30),
		);
		viewport.scale = 0.1;
		renderer.redraw(all); // the first five
		expect(outlines.calls).toBe(5);
		viewport.x = 19990;
		renderer.redraw(all); // the other five; the first five are dropped
		expect(outlines.calls).toBe(10);
		viewport.x = 0;
		renderer.redraw(all);
		expect(outlines.calls).toBe(15);
	});
});
