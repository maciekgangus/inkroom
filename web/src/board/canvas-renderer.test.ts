import { describe, expect, test, vi } from "vitest";
import type { Stroke } from "./board";
import { CanvasRenderer, paintElements } from "./canvas-renderer";
import { Viewport } from "./viewport";

describe("CanvasRenderer contexts", () => {
	test("no layer is desynchronized: a layer cleared and drawn again must never be shown half way", () => {
		const canvas = () =>
			({ getContext: vi.fn(() => null) }) as unknown as HTMLCanvasElement;
		const committed = canvas();
		const live = canvas();
		new CanvasRenderer(committed, live, new Viewport());
		// The unfinished stroke is cleared and drawn whole at every move. A desynchronized canvas has
		// one buffer, shown as it is: between the clear and the drawing the stroke is gone for a
		// moment, which is seen as flicker (measured in Chrome at 3782 by 2012 pixels).
		for (const layer of [committed, live]) {
			const asked = vi.mocked(layer.getContext).mock.calls[0];
			expect(asked[0]).toBe("2d");
			expect(asked[1]).toBeUndefined();
		}
	});
});

describe("CanvasRenderer selection glow (R-058)", () => {
	test("every selected element glows, however many are selected", () => {
		vi.stubGlobal("requestAnimationFrame", undefined);
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
		const blurs: number[] = [];
		const ctx = new Proxy(
			{},
			{
				get: (_t, k) => (k === "canvas" ? {} : () => ctx),
				set: (_t, k, v) => {
					if (k === "shadowBlur") blurs.push(v);
					return true;
				},
			},
		) as unknown as CanvasRenderingContext2D;
		const canvas = () =>
			({
				getContext: () => ctx,
				style: {},
				width: 100,
				height: 100,
			}) as unknown as HTMLCanvasElement;
		const renderer = new CanvasRenderer(canvas(), canvas(), new Viewport());
		const many = Array.from({ length: 40 }, (_, i) => ({
			id: `s${i}`,
			authorId: "a",
			color: "#111",
			size: 4,
			z: i,
			kind: "line" as const,
			points: [
				[0, i * 5, 0.5],
				[50, i * 5, 0.5],
			] as [number, number, number][],
		}));
		renderer.setHighlight(many);
		// Two passes of blur per element.
		expect(blurs.filter((b) => b > 0).length).toBeGreaterThanOrEqual(40);
		vi.unstubAllGlobals();
	});
});

describe("the coordinate system on the canvas", () => {
	const record = () => {
		const widths: number[] = [];
		const texts: string[] = [];
		const ctx = new Proxy({ lineWidth: 1 } as Record<string, unknown>, {
			get: (t, k) => {
				if (k === "stroke") return () => widths.push(t.lineWidth as number);
				if (k === "fillText") return (text: string) => texts.push(text);
				if (k in t) return t[k as string];
				return () => ctx;
			},
			set: (t, k, v) => {
				t[k as string] = v;
				return true;
			},
		}) as unknown as CanvasRenderingContext2D;
		return { ctx, widths, texts };
	};
	const axes = (numbered: boolean) =>
		({
			id: "ax",
			authorId: "a",
			color: "#111",
			size: 4,
			z: 1,
			kind: "axes",
			...(numbered ? { numbered: true } : {}),
			points: [
				[0, 0, 0.5],
				[300, 200, 0.5],
			],
		}) as Stroke;
	const big = { minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 };

	test("the marks are drawn much thinner than the axes", () => {
		vi.stubGlobal(
			"Path2D",
			class {
				moveTo() {}
				lineTo() {}
				closePath() {}
				rect() {}
			},
		);
		const r = record();
		paintElements(r.ctx, [axes(false)], big, null);
		vi.unstubAllGlobals();
		const [axis, marks] = [Math.max(...r.widths), Math.min(...r.widths)];
		expect(axis).toBe(4);
		expect(marks).toBeLessThanOrEqual(axis * 0.4);
		expect(marks).toBeGreaterThan(0);
	});

	test("the numbers are written only when asked for", () => {
		vi.stubGlobal(
			"Path2D",
			class {
				moveTo() {}
				lineTo() {}
				closePath() {}
				rect() {}
			},
		);
		const off = record();
		paintElements(off.ctx, [axes(false)], big, null);
		const on = record();
		paintElements(on.ctx, [axes(true)], big, null);
		vi.unstubAllGlobals();
		expect(off.texts).toEqual([]);
		expect(on.texts).toContain("1");
		expect(on.texts).toContain("-1");
	});
});

describe("the laser pointer on the live layer", () => {
	test("a trail is drawn red, fainter towards its tail, and the layer is cleared when it is gone", () => {
		vi.stubGlobal("requestAnimationFrame", undefined);
		const alphas: number[] = [];
		const styles: string[] = [];
		let clears = 0;
		const ctx = new Proxy(
			{ globalAlpha: 1, strokeStyle: "" } as Record<string, unknown>,
			{
				get: (t, k) => {
					if (k === "stroke")
						return () => {
							alphas.push(t.globalAlpha as number);
							styles.push(String(t.strokeStyle));
						};
					if (k === "clearRect" || k === "fillRect") return () => clears++;
					if (k === "canvas") return {};
					if (k in t) return t[k as string];
					return () => ctx;
				},
				set: (t, k, v) => {
					t[k as string] = v;
					return true;
				},
			},
		) as unknown as CanvasRenderingContext2D;
		const canvas = () =>
			({
				getContext: () => ctx,
				width: 100,
				height: 100,
				style: {},
			}) as unknown as HTMLCanvasElement;
		const r = new CanvasRenderer(canvas(), canvas(), new Viewport());
		r.setLasers([
			{
				id: "a",
				points: [
					{ x: 0, y: 0, alpha: 0.2 },
					{ x: 10, y: 10, alpha: 0.6 },
					{ x: 20, y: 20, alpha: 1 },
				],
			},
		]);
		expect(alphas.length).toBeGreaterThanOrEqual(2);
		expect(alphas[0]).toBeLessThan(alphas[alphas.length - 1]);
		expect(styles.every((s) => /^#(f|e|d)[0-9a-f]{5}$|red|rgb/i.test(s))).toBe(
			true,
		);
		const before = clears;
		r.setLasers([]);
		expect(clears).toBeGreaterThan(before); // painted again, empty
		vi.unstubAllGlobals();
	});
});
