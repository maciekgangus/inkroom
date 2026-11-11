import { describe, expect, test, vi } from "vitest";
import { CanvasRenderer } from "./canvas-renderer";
import { Viewport } from "./viewport";

describe("CanvasRenderer contexts (N-012)", () => {
	test("the live layer asks for low latency, the committed one is left to the compositor", () => {
		const committed = {
			getContext: vi.fn(() => null),
		} as unknown as HTMLCanvasElement;
		const live = {
			getContext: vi.fn(() => null),
		} as unknown as HTMLCanvasElement;
		new CanvasRenderer(committed, live, new Viewport());
		// desynchronized: the stroke being drawn is shown without waiting for the next compositor frame
		expect(live.getContext).toHaveBeenCalledWith("2d", {
			desynchronized: true,
		});
		expect(committed.getContext).toHaveBeenCalledWith("2d");
	});
});
