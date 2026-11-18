import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CanvasRenderer } from "./canvas-renderer";
import { Viewport } from "./viewport";

/** A context that counts the clears (each paint of a layer starts with one). */
const layer = () => {
	const ctx = new Proxy(
		{ clears: 0 },
		{
			get: (t, k) =>
				k === "clears"
					? t.clears
					: k === "canvas"
						? {}
						: k === "clearRect" || k === "fillRect"
							? () => t.clears++
							: () => ctx,
			set: () => true,
		},
	) as unknown as CanvasRenderingContext2D & { clears: number };
	const canvas = {
		getContext: () => ctx,
		width: 100,
		height: 100,
		style: {} as Record<string, string>,
	};
	return { ctx, canvas: canvas as unknown as HTMLCanvasElement };
};

describe("CanvasRenderer overdraw: the board is painted a little beyond the screen (R-074)", () => {
	beforeEach(() => {
		vi.stubGlobal("requestAnimationFrame", undefined);
		vi.stubGlobal("innerWidth", 1000);
		vi.stubGlobal("innerHeight", 800);
		vi.stubGlobal("devicePixelRatio", 1);
	});
	afterEach(() => vi.unstubAllGlobals());

	test("the board layer is larger than the window and stands out beyond its edges; the live layer is not", () => {
		const a = layer();
		const b = layer();
		const r = new CanvasRenderer(a.canvas, b.canvas, new Viewport());
		r.resize();
		expect(a.canvas.width).toBe(1500); // a quarter more on each side
		expect(a.canvas.height).toBe(1200);
		expect(a.canvas.style.left).toBe("-250px");
		expect(a.canvas.style.top).toBe("-200px");
		expect(a.canvas.style.width).toBe("1500px");
		expect(a.canvas.style.height).toBe("1200px");
		expect(b.canvas.width).toBe(1000);
		expect(b.canvas.style.left).toBeUndefined();
	});

	test("while the view moves, the board layer scales about the screen's corner, not its own", () => {
		const a = layer();
		const v = new Viewport();
		const r = new CanvasRenderer(a.canvas, layer().canvas, v);
		r.resize();
		v.setScaleAt(0, 0, 2);
		r.moveView();
		expect(a.canvas.style.transformOrigin).toBe("250px 200px");
	});
});

describe("CanvasRenderer buffer limit: a big screen does not get a bigger layer than a device can hold (R-077)", () => {
	beforeEach(() => vi.stubGlobal("requestAnimationFrame", undefined));
	afterEach(() => vi.unstubAllGlobals());
	const size = (w: number, h: number, dpr: number) => {
		vi.stubGlobal("innerWidth", w);
		vi.stubGlobal("innerHeight", h);
		vi.stubGlobal("devicePixelRatio", dpr);
		const a = layer();
		new CanvasRenderer(a.canvas, layer().canvas, new Viewport()).resize();
		return a.canvas;
	};

	test("a tablet with a dense screen gets no overdraw beyond the limit", () => {
		const c = size(1600, 1000, 2); // full overdraw would be 4800 x 3000 pixels
		expect(c.width * c.height).toBeLessThanOrEqual(10_000_000);
	});

	test("a desktop window keeps the full overdraw", () => {
		const c = size(1920, 1080, 1);
		expect(c.width).toBe(2880);
		expect(c.height).toBe(1620);
	});

	test("the overdraw shrinks smoothly, never below the window", () => {
		const c = size(1400, 900, 2); // full overdraw would be 4200 x 2700 = 11M pixels
		expect(c.width).toBeGreaterThanOrEqual(1400 * 2);
		expect(c.height).toBeGreaterThanOrEqual(900 * 2);
		expect(c.width * c.height).toBeLessThanOrEqual(10_000_000);
	});
});

describe("CanvasRenderer.moveView: the view moves without painting every frame", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("requestAnimationFrame", undefined);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	test("moves and scales the bitmaps with CSS, paints once the view has settled", () => {
		const a = layer();
		const b = layer();
		const v = new Viewport();
		const r = new CanvasRenderer(a.canvas, b.canvas, v);
		r.redraw([]);
		const painted = a.ctx.clears;
		// zoom in by 2 around the screen point (100, 50): world point under it stays
		v.setScaleAt(100, 50, 2);
		r.moveView();
		expect(a.ctx.clears).toBe(painted); // no repaint in the frame
		const t = a.canvas.style.transform;
		expect(t).toBe("translate(-100px, -50px) scale(2)");
		expect(b.canvas.style.transform).toBe(t);
		v.setScaleAt(100, 50, 1.5); // another frame of the zoom: still from the same picture
		r.moveView();
		expect(a.ctx.clears).toBe(painted);
		expect(a.canvas.style.transform).toMatch(/scale\(1\.5\)$/);
		vi.advanceTimersByTime(200); // the view settled
		expect(a.ctx.clears).toBeGreaterThan(painted); // painted sharp
		expect(a.canvas.style.transform).toBe(""); // and the bitmap is back as it is
	});

	test("a zoom that stretches the bitmap too far is painted at once, not when the hand stops (R-077)", () => {
		const a = layer();
		const v = new Viewport();
		const r = new CanvasRenderer(a.canvas, layer().canvas, v);
		r.redraw([]);
		const painted = a.ctx.clears;
		v.setScaleAt(100, 50, 1.9);
		r.moveView();
		expect(a.ctx.clears).toBe(painted); // within the limit: still the CSS-scaled picture
		v.setScaleAt(100, 50, 2.5); // stretched more than twice
		r.moveView();
		expect(a.ctx.clears).toBeGreaterThan(painted);
		const again = a.ctx.clears;
		v.setScaleAt(100, 50, 1.1); // and squeezed to less than half of the painted scale
		r.moveView();
		v.setScaleAt(100, 50, 0.5);
		r.moveView();
		expect(a.ctx.clears).toBeGreaterThan(again);
	});

	test("a view that never stops moving is still painted from time to time", () => {
		const a = layer();
		const v = new Viewport();
		const r = new CanvasRenderer(a.canvas, layer().canvas, v);
		r.redraw([]);
		const painted = a.ctx.clears;
		for (let i = 0; i < 40; i++) {
			v.panBy(-10, 0);
			r.moveView();
			vi.advanceTimersByTime(30); // never idle for 120 ms
		}
		expect(a.ctx.clears).toBeGreaterThan(painted);
	});

	test("repainting the live layer alone leaves the board bitmap where it is moved to", () => {
		const a = layer();
		const b = layer();
		const v = new Viewport();
		const r = new CanvasRenderer(a.canvas, b.canvas, v);
		v.panBy(-30, -20);
		r.moveView();
		const moved = a.canvas.style.transform;
		expect(moved).not.toBe("");
		r.setHighlight([]); // paints the live layer only, as the frame being put away does
		expect(a.canvas.style.transform).toBe(moved); // the board layer was not painted
		expect(b.canvas.style.transform).toBe(""); // the live one was, so it is in place
	});

	test("any other repaint takes the bitmap back to place too", () => {
		const a = layer();
		const v = new Viewport();
		const r = new CanvasRenderer(a.canvas, layer().canvas, v);
		v.panBy(-30, -20);
		r.moveView();
		expect(a.canvas.style.transform).not.toBe("");
		r.redraw([]);
		expect(a.canvas.style.transform).toBe("");
	});
});
