import { describe, expect, test } from "vitest";
import type { Stroke } from "./board";
import {
	centerOf,
	elementCorners,
	geomBox,
	rotateEl,
	rotatePoint,
	scaleEl,
	scaleElBy,
	snapAngle,
	softSnapAngle,
	toLocal,
	translateEl,
	worldBounds,
} from "./transform";

const base = { id: "e", authorId: "a", color: "#000", size: 4, z: 0 };
const pts = (...p: [number, number][]) =>
	p.map(([x, y]) => [x, y, 0.5] as [number, number, number]);

const rect = (a: [number, number], b: [number, number]): Stroke => ({
	...base,
	kind: "rect",
	points: pts(a, b),
});
const circle = (c: [number, number], e: [number, number]): Stroke => ({
	...base,
	kind: "circle",
	points: pts(c, e),
});
const stroke = (...p: [number, number][]): Stroke => ({
	...base,
	points: pts(...p),
});
const text = (
	at: [number, number],
	t: string,
	extra: Partial<Stroke> = {},
): Stroke => ({ ...base, kind: "text", text: t, points: pts(at), ...extra });

const close = (a: number[], b: number[], digits = 6) => {
	expect(a).toHaveLength(b.length);
	for (const [i, v] of a.entries()) expect(v).toBeCloseTo(b[i], digits);
};
const flat = (c: [number, number][]) => c.flat();

describe("geomBox", () => {
	test("a stroke or line is the box around its points", () => {
		expect(geomBox(stroke([10, 20], [50, 5], [30, 40]))).toEqual({
			minX: 10,
			minY: 5,
			maxX: 50,
			maxY: 40,
		});
		expect(
			geomBox({ ...base, kind: "line", points: pts([0, 0], [10, 20]) }),
		).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 20 });
	});

	test("a rectangle is its two corners, whichever way they were dragged", () => {
		expect(geomBox(rect([50, 40], [10, 10]))).toEqual({
			minX: 10,
			minY: 10,
			maxX: 50,
			maxY: 40,
		});
	});

	test("a circle is its centre plus and minus the radius", () => {
		expect(geomBox(circle([100, 100], [130, 140]))).toEqual({
			minX: 50,
			minY: 50,
			maxX: 150,
			maxY: 150,
		});
	});

	test("an image is its two corners", () => {
		expect(
			geomBox({
				...base,
				kind: "image",
				src: "x",
				points: pts([5, 6], [25, 16]),
			}),
		).toEqual({ minX: 5, minY: 6, maxX: 25, maxY: 16 });
	});

	test("a text is its estimated box and follows an own font size", () => {
		const small = geomBox(text([10, 10], "abcd"));
		const big = geomBox(text([10, 10], "abcd", { fontSize: 100 }));
		expect(small.minX).toBe(10);
		expect(big.maxX - big.minX).toBeGreaterThan(small.maxX - small.minX);
	});
});

describe("rotatePoint and toLocal", () => {
	test("rotates a point around a centre", () => {
		close(rotatePoint([1, 0], [0, 0], Math.PI / 2), [0, 1]);
		close(rotatePoint([3, 2], [2, 2], Math.PI), [1, 2]);
	});

	test("toLocal undoes the element's rotation", () => {
		const el = { ...rect([0, 0], [100, 50]), rot: Math.PI / 2 };
		const c = centerOf(el);
		const world = rotatePoint([90, 25], c, Math.PI / 2);
		close(toLocal(el, world), [90, 25]);
	});

	test("an element without rotation is its own local frame", () => {
		expect(toLocal(rect([0, 0], [10, 10]), [3, 4])).toEqual([3, 4]);
	});
});

describe("elementCorners and worldBounds", () => {
	test("corners come in nw, ne, se, sw order", () => {
		expect(elementCorners(rect([0, 0], [100, 50]))).toEqual([
			[0, 0],
			[100, 0],
			[100, 50],
			[0, 50],
		]);
	});

	test("a quarter turn swaps the width and height of the bounds around the same centre", () => {
		const el = { ...rect([0, 0], [100, 50]), rot: Math.PI / 2 };
		const b = worldBounds(el);
		expect(b.maxX - b.minX).toBeCloseTo(50);
		expect(b.maxY - b.minY).toBeCloseTo(100);
		expect((b.minX + b.maxX) / 2).toBeCloseTo(50);
		expect((b.minY + b.maxY) / 2).toBeCloseTo(25);
	});

	test("without rotation the bounds are the box", () => {
		expect(worldBounds(rect([10, 20], [30, 60]))).toEqual({
			minX: 10,
			minY: 20,
			maxX: 30,
			maxY: 60,
		});
	});
});

describe("translateEl", () => {
	test("moves every point and nothing else", () => {
		const el = { ...stroke([0, 0], [10, 10]), rot: 0.3, fontSize: undefined };
		const moved = translateEl(el, 5, -3);
		expect(moved.points.map((p) => [p[0], p[1]])).toEqual([
			[5, -3],
			[15, 7],
		]);
		expect(moved.rot).toBe(0.3);
		expect(el.points[0][0]).toBe(0); // the original is untouched
	});
});

describe("scaleEl", () => {
	test("scales a rectangle about an anchor point", () => {
		const s = scaleEl(rect([100, 100], [200, 150]), [100, 100], 2);
		expect(geomBox(s)).toEqual({ minX: 100, minY: 100, maxX: 300, maxY: 200 });
	});

	test("scales a circle's radius and keeps its centre on the right place", () => {
		const s = scaleEl(circle([100, 100], [150, 100]), [0, 0], 2);
		close(s.points[0].slice(0, 2), [200, 200]);
		expect(
			Math.hypot(
				s.points[1][0] - s.points[0][0],
				s.points[1][1] - s.points[0][1],
			),
		).toBeCloseTo(100);
	});

	test("scales a freehand stroke's points but not its line width", () => {
		const s = scaleEl(stroke([0, 0], [10, 20]), [0, 0], 3);
		expect(s.points.map((p) => [p[0], p[1]])).toEqual([
			[0, 0],
			[30, 60],
		]);
		expect(s.size).toBe(4);
	});

	test("scales a text's font size and keeps it in proportion", () => {
		const t = text([10, 10], "abcd", { fontSize: 20 });
		const s = scaleEl(t, [10, 10], 2);
		expect(s.fontSize).toBe(40);
		const a = geomBox(t);
		const b = geomBox(s);
		expect(b.maxX - b.minX).toBeCloseTo(2 * (a.maxX - a.minX));
		expect(b.maxY - b.minY).toBeCloseTo(2 * (a.maxY - a.minY));
	});

	test("a rotated element scales as a whole: its corners move away from the anchor by the factor", () => {
		const el = { ...rect([0, 0], [100, 50]), rot: 0.7 };
		const anchor: [number, number] = [-20, 30];
		const s = scaleEl(el, anchor, 1.5);
		expect(s.rot).toBe(0.7);
		const before = elementCorners(el);
		const after = elementCorners(s);
		for (const [i, c] of before.entries()) {
			close(after[i], [
				anchor[0] + 1.5 * (c[0] - anchor[0]),
				anchor[1] + 1.5 * (c[1] - anchor[1]),
			]);
		}
	});

	test("does not change the original", () => {
		const el = rect([0, 0], [10, 10]);
		scaleEl(el, [0, 0], 5);
		expect(el.points[1][0]).toBe(10);
	});
});

describe("rotateEl", () => {
	test("rotating about its own centre only changes the angle", () => {
		const el = rect([0, 0], [100, 50]);
		const r = rotateEl(el, centerOf(el), Math.PI / 2);
		expect(r.rot).toBeCloseTo(Math.PI / 2);
		expect(flat(r.points.map((p) => [p[0], p[1]] as [number, number]))).toEqual(
			[0, 0, 100, 50],
		);
	});

	test("rotating about another pivot moves the element as a rigid body", () => {
		const el = rect([100, 0], [140, 20]);
		const pivot: [number, number] = [0, 0];
		const r = rotateEl(el, pivot, Math.PI / 2);
		const before = elementCorners(el);
		const after = elementCorners(r);
		for (const [i, c] of before.entries()) {
			close(after[i], rotatePoint(c, pivot, Math.PI / 2));
		}
	});

	test("angles add up across rotations", () => {
		const el = rect([0, 0], [10, 10]);
		const r = rotateEl(rotateEl(el, centerOf(el), 0.4), centerOf(el), 0.5);
		expect(r.rot).toBeCloseTo(0.9);
	});

	test("an angle is kept within one turn", () => {
		const el = rect([0, 0], [10, 10]);
		const r = rotateEl(el, centerOf(el), 3 * Math.PI);
		expect(Math.abs(r.rot ?? 0)).toBeLessThanOrEqual(Math.PI + 1e-9);
	});
});

describe("snapAngle and softSnapAngle", () => {
	test("snapAngle rounds to the nearest step", () => {
		const step = Math.PI / 12; // 15 degrees
		expect(snapAngle(0.27, step)).toBeCloseTo(step); // 15.5 degrees -> 15
		expect(snapAngle(0.6, step)).toBeCloseTo(2 * step); // 34.4 degrees -> 30
	});

	test("softSnapAngle pulls close angles onto right angles and leaves the rest alone", () => {
		const tol = (3 * Math.PI) / 180;
		expect(softSnapAngle(0.02, tol)).toBe(0);
		expect(softSnapAngle(Math.PI / 2 + 0.03, tol)).toBeCloseTo(Math.PI / 2);
		expect(softSnapAngle(0.3, tol)).toBe(0.3);
	});
});

describe("scaleElBy (free scaling)", () => {
	const size = (el: Stroke) => {
		const b = geomBox(el);
		return [b.maxX - b.minX, b.maxY - b.minY];
	};

	test("stretches a rectangle in one direction only, about the anchor", () => {
		const r = rect([100, 100], [300, 200]);
		const out = scaleElBy(r, [100, 100], 2, 1, 0);
		expect(size(out)).toEqual([400, 100]);
		expect(geomBox(out).minX).toBe(100);
		expect(geomBox(out).minY).toBe(100);
	});

	test("with equal factors it is the uniform scale", () => {
		const r = { ...rect([100, 100], [300, 200]), rot: 0.4 };
		expect(scaleElBy(r, [50, 50], 1.5, 1.5, 0.9)).toEqual(
			scaleEl(r, [50, 50], 1.5),
		);
	});

	test("the factors follow the frame's axes: a frame turned a quarter treats x as the board's y", () => {
		const r = rect([100, 100], [300, 200]); // 200 wide, 100 tall, not turned
		const out = scaleElBy(r, [100, 100], 2, 1, Math.PI / 2); // frame x axis points down
		expect(size(out)[0]).toBeCloseTo(200); // width untouched
		expect(size(out)[1]).toBeCloseTo(200); // height doubled
	});

	test("an element turned with the frame is stretched along its own axes", () => {
		const r = { ...rect([100, 100], [300, 200]), rot: Math.PI / 2 };
		const out = scaleElBy(r, [200, 150], 2, 1, Math.PI / 2);
		expect(size(out)[0]).toBeCloseTo(400);
		expect(size(out)[1]).toBeCloseTo(100);
	});

	test("a circle and a text can only grow evenly, by the geometric mean", () => {
		const circle: Stroke = {
			...base,
			kind: "circle",
			points: pts([100, 100], [110, 100]),
		};
		const c2 = scaleElBy(circle, [100, 100], 4, 1, 0);
		expect(geomBox(c2).maxX - geomBox(c2).minX).toBeCloseTo(40); // radius 10 -> 20
		const text: Stroke = {
			...base,
			kind: "text",
			text: "hi",
			fontSize: 20,
			points: pts([0, 0]),
		};
		expect(scaleElBy(text, [0, 0], 4, 1, 0).fontSize).toBeCloseTo(40);
	});
});
