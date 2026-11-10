import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, test, vi } from "vitest";
import { Viewport } from "./board/viewport";
import { Minimap } from "./minimap";

describe("Minimap", () => {
	test("a press on the map puts the middle of the screen at that point and tells the board", async () => {
		const viewport = new Viewport();
		const onNavigate = vi.fn();
		const root = document.createElement("div");
		document.body.append(root);
		await act(async () => {
			render(
				<Minimap
					strokes={[]}
					viewport={viewport}
					screen={{ w: 1000, h: 600 }}
					ink={(c) => c}
					onNavigate={onNavigate}
				/>,
				root,
			);
		});
		const canvas = root.querySelector("canvas") as HTMLCanvasElement;
		canvas.getBoundingClientRect = () => ({
			left: 0,
			top: 0,
			width: 260,
			height: 170,
			right: 260,
			bottom: 170,
			x: 0,
			y: 0,
			toJSON() {},
		});
		canvas.setPointerCapture = () => {};
		// an empty board: the map shows the screen alone, so its middle is the screen's middle
		await act(async () => {
			canvas.dispatchEvent(
				Object.assign(new Event("pointerdown", { bubbles: true }), {
					clientX: 130,
					clientY: 85,
					pointerId: 1,
				}),
			);
		});
		expect(onNavigate).toHaveBeenCalled();
		expect(viewport.x).toBeCloseTo(0, 5);
		expect(viewport.y).toBeCloseTo(0, 5);
	});
});
