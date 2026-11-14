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
		v.setScaleAt(100, 50, 4); // another frame of the zoom: still from the same picture
		r.moveView();
		expect(a.ctx.clears).toBe(painted);
		expect(a.canvas.style.transform).toBe("translate(-300px, -150px) scale(4)");
		vi.advanceTimersByTime(200); // the view settled
		expect(a.ctx.clears).toBeGreaterThan(painted); // painted sharp
		expect(a.canvas.style.transform).toBe(""); // and the bitmap is back as it is
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
