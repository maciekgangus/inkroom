import { describe, expect, test } from "vitest";
import { Board, type BoardOp, type Point, type Stroke } from "./board";
import { strokeBounds } from "./bounds";
import { parseClipboard, serializeSelection } from "./clipboard";
import { findHit, strokeHit } from "./hit";
import { packedOf, pointCount } from "./points";
import { translateEl } from "./transform";

function wiggle(id: string, n = 60, x0 = 100, y0 = 50, z = 1): Stroke {
	const points: Point[] = [];
	for (let i = 0; i < n; i++)
		points.push([
			Math.round((x0 + i * 1.4) * 100) / 100,
			Math.round((y0 + Math.sin(i / 3) * 8) * 100) / 100,
			0.5,
		]);
	return { id, authorId: "a", color: "#111111", size: 2, z, points };
}

/** The numbers of two point lists within a float's precision. */
function expectClose(got: Point[], want: Point[], eps = 1e-3): void {
	expect(got).toHaveLength(want.length);
	got.forEach((p, i) => {
		for (let k = 0; k < 3; k++)
			expect(Math.abs(p[k] - want[i][k])).toBeLessThan(k < 2 ? eps : 1e-6);
	});
}

describe("the board keeps freehand strokes packed (R-100)", () => {
	test("a stroke drawn here is packed, and goes out with the plain numbers", () => {
		const board = new Board();
		const ops: string[] = [];
		board.onOp = (op) => ops.push(JSON.stringify(op));
		const s = wiggle("s1");
		const plain = JSON.parse(JSON.stringify(s.points)) as Point[];
		board.addStroke(s);
		expect(packedOf(board.strokes[0])).toBeDefined();
		expect(board.strokes[0]).toBe(s); // the same object: identity is kept
		const sent = JSON.parse(ops[0]) as { stroke: Stroke };
		expectClose(sent.stroke.points, plain);
	});

	test("strokes from the server (an add, an update, a snapshot) are packed", () => {
		const board = new Board();
		board.applyRemote({ t: "add", stroke: wiggle("a") });
		expect(packedOf(board.strokes[0])).toBeDefined();
		board.applyRemote({ t: "update", stroke: wiggle("a", 80) });
		expect(packedOf(board.strokes[0])).toBeDefined();
		expect(pointCount(board.strokes[0])).toBe(80);
		board.setStrokes([wiggle("b", 40, 0, 0, 2), wiggle("c", 40, 0, 0, 3)]);
		expect(board.strokes.every((s) => !!packedOf(s))).toBe(true);
	});

	test("short strokes and shapes stay arrays", () => {
		const board = new Board();
		board.addStroke(wiggle("dot", 3));
		board.addStroke({
			...wiggle("line", 2),
			id: "line",
			kind: "line",
			z: 5,
		});
		expect(board.strokes.every((s) => !packedOf(s))).toBe(true);
	});

	test("an edit puts a packed version on the board, and undo and redo restore the same numbers", () => {
		const board = new Board();
		const s = wiggle("s1", 100);
		board.addStroke(s);
		const start = JSON.parse(JSON.stringify(s.points)) as Point[];
		board.updateElement("a", translateEl(board.strokes[0], 30, -12));
		const moved = board.strokes[0];
		expect(packedOf(moved)).toBeDefined();
		expect(moved.points[0][0]).toBeCloseTo(start[0][0] + 30, 2);
		board.undo("a");
		expectClose(board.strokes[0].points, start);
		board.redo("a");
		expect(board.strokes[0].points[0][0]).toBeCloseTo(start[0][0] + 30, 2);
	});

	test("erasing and undoing an erase brings back the very same stroke", () => {
		const board = new Board();
		board.addStroke(wiggle("s1", 100));
		const before = JSON.parse(JSON.stringify(board.strokes[0])) as Stroke;
		board.eraseStroke("a", "s1");
		expect(board.strokes).toHaveLength(0);
		board.undo("a");
		expect(JSON.parse(JSON.stringify(board.strokes[0]))).toEqual(before);
	});

	test("the history counts points without unpacking them", () => {
		const board = new Board();
		board.addStroke(wiggle("s1", 100));
		expect(board.historyStats("a").points).toBe(108);
	});

	test("hit testing a packed stroke agrees with the plain one", () => {
		const plain = wiggle("p", 120, 100, 50);
		const packedBoard = new Board();
		packedBoard.addStroke(wiggle("p", 120, 100, 50));
		const packed = packedBoard.strokes[0];
		expect(packedOf(packed)).toBeDefined();
		for (let x = 90; x < 280; x += 7)
			for (let y = 30; y < 80; y += 5) {
				expect(strokeHit(packed, x, y, 4)).toBe(strokeHit(plain, x, y, 4));
			}
		expect(findHit([packed], 100.4, 50, 3)).toBe(packed);
		expect(findHit([packed], 500, 500, 3)).toBeUndefined();
	});

	test("the bounds of a packed stroke are the plain ones", () => {
		const plain = wiggle("p", 120, 100, 50);
		const board = new Board();
		board.addStroke(wiggle("p", 120, 100, 50));
		const a = strokeBounds(plain);
		const b = strokeBounds(board.strokes[0]);
		expect(b.minX).toBeCloseTo(a.minX, 2);
		expect(b.maxX).toBeCloseTo(a.maxX, 2);
		expect(b.minY).toBeCloseTo(a.minY, 2);
		expect(b.maxY).toBeCloseTo(a.maxY, 2);
	});

	test("the op sent for an update carries plain points too", () => {
		const board = new Board();
		board.addStroke(wiggle("s1", 100));
		const ops: BoardOp[] = [];
		board.onOp = (op) => ops.push(op);
		board.updateElement("a", translateEl(board.strokes[0], 5, 5));
		const json = JSON.parse(JSON.stringify(ops[0])) as { stroke: Stroke };
		expect(Array.isArray(json.stroke.points)).toBe(true);
		expect(json.stroke.points).toHaveLength(100);
	});

	test("copying a packed stroke gives plain points that paste back", () => {
		const board = new Board();
		const s = wiggle("s1", 100);
		const plain = JSON.parse(JSON.stringify(s.points)) as Point[];
		board.addStroke(s);
		const text = serializeSelection([board.strokes[0]], "b1");
		const json = JSON.parse(text) as { elements: Stroke[] };
		expect(Array.isArray(json.elements[0].points)).toBe(true);
		expectClose(json.elements[0].points, plain);
		const back = parseClipboard(text);
		expect(back?.elements).toHaveLength(1);
		expectClose(back?.elements[0].points ?? [], plain);
	});
});
