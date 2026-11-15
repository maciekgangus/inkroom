import { getStroke } from "perfect-freehand";
import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import { strokeOptions } from "./stroke-style";

const pt = (x: number, y: number, p = 0.5) =>
	[x, y, p] as [number, number, number];
const long = [pt(0, 0), pt(100, 50), pt(200, 0)];
const make = (
	extra: Partial<Stroke> = {},
	points = [pt(0, 0), pt(10, 5), pt(20, 0)],
): Stroke => ({
	id: "s",
	authorId: "a",
	color: "#000",
	size: 6,
	z: 1,
	points,
	...extra,
});

describe("strokeOptions (R-037)", () => {
	test("the ordinary pen keeps the look it has always had", () => {
		expect(strokeOptions(make())).toEqual({
			size: 6,
			thinning: 0.6,
			smoothing: 0.5,
			streamline: 0.4,
			simulatePressure: false,
		});
	});

	test("the natural pen thins with speed, smooths more and tapers both ends", () => {
		const o = strokeOptions(make({ dash: "natural" }, long));
		// The base width is a little larger, as the stroke thins where the hand is fast.
		expect(o.size as number).toBeGreaterThanOrEqual(6);
		expect(o.size as number).toBeLessThanOrEqual(12);
		expect(o.simulatePressure).toBe(true); // a mouse has one fixed pressure
		expect(o.smoothing).toBeGreaterThan(0.5);
		expect(o.streamline).toBeGreaterThan(0.4);
		expect(o.thinning as number).toBeGreaterThan(0.3);
		expect(o.thinning as number).toBeLessThan(0.7); // never thin enough to vanish
		expect(o.start).toMatchObject({ cap: true });
		expect((o.start as { taper: number }).taper).toBeGreaterThan(0);
		expect((o.end as { taper: number }).taper).toBeGreaterThan(0);
	});

	test("a tap with the natural pen leaves a dot: the tapers never eat a short stroke (R-075)", () => {
		for (const pts of [[pt(10, 10, 0.5)], [pt(10, 10, 0.5), pt(11, 10, 0.5)]]) {
			const s = make({ dash: "natural", size: 4 }, pts);
			const outline = getStroke(s.points, strokeOptions(s));
			const xs = outline.map((p) => p[0]);
			expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(3);
		}
	});

	test("a stylus keeps its real pressure instead of a simulated one", () => {
		const pressed = make({ dash: "natural" }, [
			pt(0, 0, 0.2),
			pt(10, 5, 0.7),
			pt(20, 0, 0.4),
		]);
		expect(strokeOptions(pressed).simulatePressure).toBe(false);
	});

	test("the tapers grow with the width, so a thick line has long soft ends", () => {
		const thin = strokeOptions(make({ dash: "natural", size: 2 }, long));
		const thick = strokeOptions(make({ dash: "natural", size: 20 }, long));
		expect((thick.start as { taper: number }).taper).toBeGreaterThan(
			(thin.start as { taper: number }).taper,
		);
	});

	test("other dash values draw like the ordinary pen", () => {
		expect(strokeOptions(make({ dash: "solid" }))).toEqual(
			strokeOptions(make()),
		);
	});
});
