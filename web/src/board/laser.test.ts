import { describe, expect, test } from "vitest";
import { LASER_TTL_MS, LaserTrails } from "./laser";

describe("LaserTrails: the red pointer whose trail fades", () => {
	test("a point is fully there when it is new and gone after the time is up", () => {
		const l = new LaserTrails();
		l.add("a", [[10, 20]], true, 1000);
		expect(l.visible(1000)[0].points[0]).toMatchObject({
			x: 10,
			y: 20,
			alpha: 1,
		});
		const half = l.visible(1000 + LASER_TTL_MS / 2)[0].points[0].alpha;
		expect(half).toBeGreaterThan(0.4);
		expect(half).toBeLessThan(0.6);
		expect(l.visible(1000 + LASER_TTL_MS + 1)).toEqual([]);
		expect(l.active(1000 + LASER_TTL_MS + 1)).toBe(false);
	});

	test("older points of the same trail are fainter than newer ones", () => {
		const l = new LaserTrails();
		l.add("a", [[0, 0]], true, 1000);
		l.add("a", [[5, 5]], false, 1400);
		const [trail] = l.visible(1600);
		expect(trail.points).toHaveLength(2);
		expect(trail.points[0].alpha).toBeLessThan(trail.points[1].alpha);
	});

	test("the points of a trail that is already gone are dropped from the front", () => {
		const l = new LaserTrails();
		l.add("a", [[0, 0]], true, 1000);
		l.add("a", [[1, 1]], false, 2000);
		const [trail] = l.visible(1000 + LASER_TTL_MS + 100);
		expect(trail.points.map((p) => p.x)).toEqual([1]);
	});

	test("a start begins a new line: two strokes are not joined by a segment", () => {
		const l = new LaserTrails();
		l.add(
			"a",
			[
				[0, 0],
				[1, 1],
			],
			true,
			1000,
		);
		l.add(
			"a",
			[
				[50, 50],
				[51, 51],
			],
			true,
			1100,
		);
		expect(l.visible(1100)).toHaveLength(2);
	});

	test("every person has trails of their own", () => {
		const l = new LaserTrails();
		l.add("a", [[0, 0]], true, 1000);
		l.add("b", [[9, 9]], true, 1000);
		expect(
			l
				.visible(1000)
				.map((t) => t.id)
				.sort(),
		).toEqual(["a", "b"]);
	});

	test("a trail does not grow without limit", () => {
		const l = new LaserTrails();
		const pts = Array.from(
			{ length: 5000 },
			(_, i) => [i, i] as [number, number],
		);
		l.add("a", pts, true, 1000);
		expect(l.visible(1000)[0].points.length).toBeLessThanOrEqual(600);
	});

	test("nothing visible, nothing active; points that are not numbers are ignored", () => {
		const l = new LaserTrails();
		expect(l.visible(0)).toEqual([]);
		expect(l.active(0)).toBe(false);
		l.add(
			"a",
			[
				[Number.NaN, 1],
				["x" as never, 2],
			],
			true,
			0,
		);
		expect(l.active(0)).toBe(false);
	});
});
