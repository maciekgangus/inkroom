import { describe, expect, test, vi } from "vitest";
import { CanvasRenderer } from "./canvas-renderer";
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
			({ getContext: () => ctx, width: 100, height: 100 }) as unknown as HTMLCanvasElement;
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
