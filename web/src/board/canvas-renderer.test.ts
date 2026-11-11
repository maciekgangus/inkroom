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
