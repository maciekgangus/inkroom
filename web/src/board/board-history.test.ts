import { describe, expect, test } from "vitest";
import { Board, HISTORY_LIMITS, type Stroke } from "./board";

/** A freehand stroke of `n` points; `z` and id come from `i`. */
function stroke(i: number, n = 1, authorId = "a"): Stroke {
	return {
		id: String(i),
		authorId,
		color: "#111",
		size: 4,
		z: i,
		points: Array.from(
			{ length: n },
			(_, k) => [k, i, 0.5] as [number, number, number],
		),
	};
}

const ids = (b: Board) => b.strokes.map((s) => s.id);

describe("undo history is bounded (R-008, R-100)", () => {
	test("the default limits are documented constants", () => {
		expect(HISTORY_LIMITS.maxSteps).toBeGreaterThan(0);
		expect(HISTORY_LIMITS.maxPoints).toBeGreaterThan(0);
	});

	test("only the newest maxSteps steps of an author can be undone", () => {
		const board = new Board({ maxSteps: 5, maxPoints: 1_000_000 });
		for (let i = 1; i <= 8; i++) board.addStroke(stroke(i));
		let undone = 0;
		while (board.undo("a")) undone++;
		expect(undone).toBe(5);
		// the dropped steps stay on the board, only their undo is gone
		expect(ids(board)).toEqual(["1", "2", "3"]);
	});

	test("the limit is per author", () => {
		const board = new Board({ maxSteps: 2, maxPoints: 1_000_000 });
		for (let i = 1; i <= 3; i++) board.addStroke(stroke(i, 1, "a"));
		for (let i = 11; i <= 13; i++) board.addStroke(stroke(i, 1, "b"));
		let a = 0;
		while (board.undo("a")) a++;
		let b = 0;
		while (board.undo("b")) b++;
		expect([a, b]).toEqual([2, 2]);
	});

	test("a step counts by the points it holds, not as one", () => {
		// three erase steps of 400 points each against a budget of 1000 points
		const board = new Board({ maxSteps: 100, maxPoints: 1000 });
		for (let i = 1; i <= 3; i++) board.addStroke(stroke(i, 400));
		for (let i = 1; i <= 3; i++) board.eraseStroke("a", String(i));
		let undone = 0;
		while (board.undo("a")) undone++;
		// the three adds and three erases were 6 steps of 400 points: far over the budget,
		// the oldest were dropped and the newest kept
		expect(undone).toBeLessThan(6);
		expect(undone).toBeGreaterThanOrEqual(2);
	});

	test("the newest step is kept even when it alone is over the budget, until another step follows", () => {
		const board = new Board({ maxSteps: 100, maxPoints: 1000 });
		board.setStrokes(Array.from({ length: 50 }, (_, i) => stroke(i + 1, 100)));
		board.eraseMany(
			"a",
			board.strokes.map((s) => s.id),
		); // one step holding 5000 points
		expect(board.historyStats("a").steps).toBe(1);
		// it can be undone: "oops, I deleted everything"
		expect(board.undo("a")).toBe(true);
		expect(board.strokes).toHaveLength(50);
		board.redo("a");
		expect(board.strokes).toHaveLength(0);
		// once another step is recorded the huge one is dropped
		board.addStroke(stroke(100, 10));
		expect(board.historyStats("a").steps).toBe(1);
		expect(board.undo("a")).toBe(true);
		expect(board.undo("a")).toBe(false);
		expect(board.strokes).toHaveLength(0);
	});

	test("a grouped erase within the limits is undone as one step, whole", () => {
		const board = new Board({ maxSteps: 10, maxPoints: 1_000_000 });
		board.setStrokes(Array.from({ length: 300 }, (_, i) => stroke(i + 1, 3)));
		const eraser = board.eraseBatch("a");
		for (let i = 1; i <= 300; i++) eraser.erase(String(i));
		eraser.done();
		expect(board.strokes).toHaveLength(0);
		expect(board.undo("a")).toBe(true);
		expect(board.strokes).toHaveLength(300);
		expect(ids(board).slice(0, 3)).toEqual(["1", "2", "3"]);
	});

	test("dropping the oldest steps releases their erased strokes", () => {
		const board = new Board({ maxSteps: 3, maxPoints: 1_000_000 });
		board.setStrokes(Array.from({ length: 10 }, (_, i) => stroke(i + 1, 50)));
		for (let i = 1; i <= 10; i++) board.eraseStroke("a", String(i));
		const stats = board.historyStats("a");
		expect(stats.steps).toBe(3);
		// 3 erased strokes of 50 points (plus the per-element weight) are all it holds
		expect(stats.points).toBeLessThan(3 * 70);
	});

	test("redo is cleared by a new step as before, and the counts follow", () => {
		const board = new Board({ maxSteps: 5, maxPoints: 1_000_000 });
		for (let i = 1; i <= 3; i++) board.addStroke(stroke(i));
		board.undo("a");
		expect(board.historyStats("a")).toEqual({
			steps: 2,
			redo: 1,
			points: expect.any(Number),
		});
		board.addStroke(stroke(9));
		expect(board.redo("a")).toBe(false);
		expect(board.historyStats("a").redo).toBe(0);
	});

	test("updates keep before and after and are counted", () => {
		const board = new Board({ maxSteps: 2, maxPoints: 1_000_000 });
		board.addStroke(stroke(1));
		for (let k = 0; k < 4; k++)
			board.updateElement("a", { ...stroke(1), size: 5 + k });
		let undone = 0;
		while (board.undo("a")) undone++;
		expect(undone).toBe(2);
		expect(board.strokes[0].size).toBe(6); // two updates undone, the older ones were dropped
	});
});

describe("Board index (by id, by order)", () => {
	test("lookups stay right after add, erase, undo, redo, remote ops and replacement", () => {
		const board = new Board();
		board.setStrokes([stroke(3), stroke(1), stroke(2)]);
		expect(ids(board)).toEqual(["1", "2", "3"]);
		expect(board.eraseStroke("a", "2")).toBe(true);
		expect(board.eraseStroke("a", "2")).toBe(false);
		board.undo("a");
		expect(ids(board)).toEqual(["1", "2", "3"]);
		board.applyRemote({ t: "remove", id: "1" });
		board.applyRemote({ t: "add", stroke: stroke(1) });
		board.applyRemote({ t: "add", stroke: stroke(1) }); // the echo changes nothing
		expect(ids(board)).toEqual(["1", "2", "3"]);
		// a new z moves the element in the order and the lookups still find it
		expect(board.updateElement("a", { ...stroke(1), z: 10 })).toBe(true);
		expect(ids(board)).toEqual(["2", "3", "1"]);
		expect(board.eraseStroke("a", "1")).toBe(true);
		expect(ids(board)).toEqual(["2", "3"]);
		board.undo("a"); // the erase
		board.undo("a"); // the update
		expect(ids(board)).toEqual(["1", "2", "3"]);
		expect(board.strokes[0].z).toBe(1);
	});

	test("elements with the same z are ordered and found by id", () => {
		const board = new Board();
		const same = (id: string): Stroke => ({ ...stroke(1), id, z: 5 });
		board.setStrokes([same("c"), same("a"), same("b")]);
		expect(ids(board)).toEqual(["a", "b", "c"]);
		expect(board.eraseStroke("a", "b")).toBe(true);
		expect(ids(board)).toEqual(["a", "c"]);
		board.undo("a");
		expect(ids(board)).toEqual(["a", "b", "c"]);
	});

	test("erasing and undoing a huge group is not quadratic", () => {
		const n = 60_000;
		const board = new Board();
		board.setStrokes(Array.from({ length: n }, (_, i) => stroke(i + 1)));
		const all = board.strokes.map((s) => s.id).reverse(); // not in drawing order
		const t0 = performance.now();
		expect(board.eraseMany("a", all)).toBe(true);
		expect(board.strokes).toHaveLength(0);
		expect(board.undo("a")).toBe(true);
		expect(board.strokes).toHaveLength(n);
		const ms = performance.now() - t0;
		expect(ms).toBeLessThan(1500);
		// and the order is intact
		expect(board.strokes[0].z).toBeLessThan(board.strokes[n - 1].z);
	});
});
