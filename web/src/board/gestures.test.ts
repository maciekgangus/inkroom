import { beforeEach, describe, expect, test, vi } from "vitest";
import { TouchGestures } from "./gestures";
import { Viewport } from "./viewport";

function touch(id: number, x: number, y: number) {
	return {
		pointerId: id,
		pointerType: "touch",
		clientX: x,
		clientY: y,
		pressure: 0.5,
	};
}

describe("TouchGestures", () => {
	let viewport: Viewport;
	let onChange: () => void;
	let penActive: boolean;
	let g: TouchGestures;

	beforeEach(() => {
		viewport = new Viewport();
		onChange = vi.fn();
		penActive = false;
		g = new TouchGestures(viewport, () => penActive, onChange);
	});

	test("a single finger does nothing", () => {
		g.down(touch(1, 100, 100));
		g.move(touch(1, 200, 250));
		expect(viewport).toMatchObject({ x: 0, y: 0, scale: 1 });
		expect(onChange).not.toHaveBeenCalled();
	});

	test("two fingers moving together pan the view", () => {
		g.down(touch(1, 100, 100));
		g.down(touch(2, 200, 100));
		g.move(touch(1, 130, 120));
		g.move(touch(2, 230, 120));
		// Content followed the fingers: it moved right 30 and down 20.
		expect(viewport.toScreen(0, 0)[0]).toBeCloseTo(30);
		expect(viewport.toScreen(0, 0)[1]).toBeCloseTo(20);
		expect(viewport.scale).toBeCloseTo(1);
		expect(onChange).toHaveBeenCalled();
	});

	test("spreading two fingers zooms in around their centre", () => {
		g.down(touch(1, 100, 100));
		g.down(touch(2, 200, 100));
		const centre = viewport.toWorld(150, 100);
		g.move(touch(1, 50, 100));
		g.move(touch(2, 250, 100)); // distance 100 -> 200
		expect(viewport.scale).toBeCloseTo(2);
		const [sx, sy] = viewport.toScreen(centre[0], centre[1]);
		expect(sx).toBeCloseTo(150);
		expect(sy).toBeCloseTo(100);
	});

	test("pinching two fingers together zooms out", () => {
		g.down(touch(1, 0, 100));
		g.down(touch(2, 200, 100));
		g.move(touch(1, 50, 100));
		g.move(touch(2, 150, 100));
		expect(viewport.scale).toBeCloseTo(0.5);
	});

	test("touches are ignored while the pen is drawing", () => {
		penActive = true;
		g.down(touch(1, 100, 100));
		g.down(touch(2, 200, 100));
		g.move(touch(1, 150, 100));
		g.move(touch(2, 250, 100));
		expect(viewport).toMatchObject({ x: 0, y: 0, scale: 1 });
	});

	test("lifting a finger ends the gesture and the next one starts without a jump", () => {
		g.down(touch(1, 100, 100));
		g.down(touch(2, 200, 100));
		g.move(touch(2, 210, 100));
		g.up(touch(2, 210, 100));
		const snapshot = { x: viewport.x, y: viewport.y, scale: viewport.scale };
		g.move(touch(1, 300, 300)); // lone finger: nothing
		expect(viewport).toMatchObject(snapshot);
		g.down(touch(3, 500, 500));
		expect(viewport).toMatchObject(snapshot); // no jump when the second finger lands
	});

	test("cancelled touches are dropped too", () => {
		g.down(touch(1, 100, 100));
		g.down(touch(2, 200, 100));
		g.cancel(touch(1, 100, 100));
		g.move(touch(2, 400, 400));
		expect(viewport).toMatchObject({ x: 0, y: 0, scale: 1 });
	});

	test("reports whether a gesture is in progress", () => {
		expect(g.active).toBe(false);
		g.down(touch(1, 0, 0));
		expect(g.active).toBe(false);
		g.down(touch(2, 10, 0));
		expect(g.active).toBe(true);
		g.up(touch(2, 10, 0));
		expect(g.active).toBe(false);
	});
});
