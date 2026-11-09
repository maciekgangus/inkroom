import { beforeEach, describe, expect, test, vi } from "vitest";
import { Board, type Stroke } from "./board";

function stroke(id: string, authorId = "a"): Stroke {
	return {
		id,
		authorId,
		color: "#111",
		size: 4,
		z: Number(id),
		points: [[0, 0, 0.5]],
	};
}

const ids = (b: Board) => b.strokes.map((s) => s.id);

describe("Board", () => {
	let board: Board;
	beforeEach(() => {
		board = new Board();
	});

	test("addStroke appends in drawing order", () => {
		board.addStroke(stroke("1"));
		board.addStroke(stroke("2"));
		expect(ids(board)).toEqual(["1", "2"]);
	});

	test("undo removes the author's last stroke and redo restores it", () => {
		board.addStroke(stroke("1"));
		board.addStroke(stroke("2"));
		expect(board.undo("a")).toBe(true);
		expect(ids(board)).toEqual(["1"]);
		expect(board.redo("a")).toBe(true);
		expect(ids(board)).toEqual(["1", "2"]);
	});

	test("undo only touches the author's own strokes", () => {
		board.addStroke(stroke("1", "a"));
		board.addStroke(stroke("2", "b"));
		board.undo("a");
		expect(ids(board)).toEqual(["2"]);
		expect(board.undo("a")).toBe(false);
		expect(ids(board)).toEqual(["2"]);
	});

	test("eraseStroke removes any author's stroke", () => {
		board.addStroke(stroke("1", "a"));
		expect(board.eraseStroke("b", "1")).toBe(true);
		expect(ids(board)).toEqual([]);
	});

	test("eraseStroke returns false for an unknown id", () => {
		expect(board.eraseStroke("a", "nope")).toBe(false);
	});

	test("undo of an erase restores the stroke at its original position", () => {
		board.addStroke(stroke("1"));
		board.addStroke(stroke("2"));
		board.addStroke(stroke("3"));
		board.eraseStroke("a", "2");
		expect(ids(board)).toEqual(["1", "3"]);
		board.undo("a");
		expect(ids(board)).toEqual(["1", "2", "3"]);
		board.redo("a");
		expect(ids(board)).toEqual(["1", "3"]);
	});

	test("a new action clears the author's redo stack", () => {
		board.addStroke(stroke("1"));
		board.undo("a");
		board.addStroke(stroke("2"));
		expect(board.redo("a")).toBe(false);
		expect(ids(board)).toEqual(["2"]);
	});

	test("undo and redo on empty stacks do nothing", () => {
		expect(board.undo("a")).toBe(false);
		expect(board.redo("a")).toBe(false);
	});

	test("strokes are ordered by (z, id) whatever the insertion order", () => {
		board.addStroke(stroke("3"));
		board.addStroke(stroke("1"));
		board.addStroke(stroke("2"));
		expect(ids(board)).toEqual(["1", "2", "3"]);
	});

	describe("operations", () => {
		test("local actions are reported as add/remove operations", () => {
			const ops: unknown[] = [];
			board.onOp = (op) => ops.push(op);
			const s = stroke("1");
			board.addStroke(s);
			board.undo("a");
			board.redo("a");
			board.eraseStroke("a", "1");
			board.undo("a");
			expect(ops).toEqual([
				{ t: "add", stroke: s },
				{ t: "remove", id: "1" },
				{ t: "add", stroke: s },
				{ t: "remove", id: "1" },
				{ t: "add", stroke: s },
			]);
		});

		test("applyRemote add inserts in order and is idempotent", () => {
			board.addStroke(stroke("1"));
			board.addStroke(stroke("3"));
			board.applyRemote({ t: "add", stroke: stroke("2", "b") });
			board.applyRemote({ t: "add", stroke: stroke("2", "b") });
			expect(ids(board)).toEqual(["1", "2", "3"]);
		});

		test("applyRemote remove is idempotent and ignores unknown ids", () => {
			board.addStroke(stroke("1"));
			board.applyRemote({ t: "remove", id: "1" });
			board.applyRemote({ t: "remove", id: "1" });
			board.applyRemote({ t: "remove", id: "nope" });
			expect(ids(board)).toEqual([]);
		});

		test("remote operations are not reported back and do not enter the history", () => {
			const onOp = vi.fn();
			board.onOp = onOp;
			board.applyRemote({ t: "add", stroke: stroke("1", "b") });
			expect(onOp).not.toHaveBeenCalled();
			expect(board.undo("a")).toBe(false);
			expect(board.undo("b")).toBe(false);
		});

		test("undoing a stroke someone else already removed does not throw", () => {
			board.addStroke(stroke("1"));
			board.applyRemote({ t: "remove", id: "1" });
			expect(board.undo("a")).toBe(true);
			expect(ids(board)).toEqual([]);
		});

		test("setStrokes replaces the content (snapshot)", () => {
			board.addStroke(stroke("1"));
			board.setStrokes([stroke("3", "b"), stroke("2", "b")]);
			expect(ids(board)).toEqual(["2", "3"]);
		});
	});

	describe("updating an element", () => {
		const moved = (id: string, authorId = "a"): Stroke => ({ ...stroke(id, authorId), points: [[9, 9, 0.5]] });

		test("updateElement replaces the element in place and reports an update", () => {
			const ops: unknown[] = [];
			board.addStroke(stroke("1"));
			board.addStroke(stroke("2"));
			board.onOp = (op) => ops.push(op);
			expect(board.updateElement("a", moved("1"))).toBe(true);
			expect(ids(board)).toEqual(["1", "2"]);
			expect(board.strokes[0].points[0]).toEqual([9, 9, 0.5]);
			expect(ops).toEqual([{ t: "update", stroke: moved("1") }]);
		});

		test("updating an element that is gone does nothing", () => {
			const onOp = vi.fn();
			board.onOp = onOp;
			expect(board.updateElement("a", moved("nope"))).toBe(false);
			expect(onOp).not.toHaveBeenCalled();
		});

		test("undo restores the previous version and redo the new one", () => {
			const ops: unknown[] = [];
			board.addStroke(stroke("1"));
			board.updateElement("a", moved("1"));
			board.onOp = (op) => ops.push(op);
			expect(board.undo("a")).toBe(true);
			expect(board.strokes[0].points[0]).toEqual([0, 0, 0.5]);
			expect(board.redo("a")).toBe(true);
			expect(board.strokes[0].points[0]).toEqual([9, 9, 0.5]);
			expect(ops).toEqual([
				{ t: "update", stroke: stroke("1") },
				{ t: "update", stroke: moved("1") },
			]);
		});

		test("undo goes back through add and update in order", () => {
			board.addStroke(stroke("1"));
			board.updateElement("a", moved("1"));
			board.undo("a");
			expect(ids(board)).toEqual(["1"]);
			board.undo("a");
			expect(ids(board)).toEqual([]);
		});

		test("any author may update, and it lands in that author's history", () => {
			board.addStroke(stroke("1", "a"));
			board.updateElement("b", moved("1", "a"));
			expect(board.undo("a")).toBe(true); // a's own add
			board.addStroke(stroke("2", "a"));
			expect(board.undo("b")).toBe(true); // b's update
			expect(board.strokes.find((s) => s.id === "1")?.points[0]).toEqual([0, 0, 0.5]);
		});

		test("applyRemote update replaces an existing element without touching history", () => {
			const onOp = vi.fn();
			board.addStroke(stroke("1"));
			board.onOp = onOp;
			board.applyRemote({ t: "update", stroke: moved("1") });
			expect(board.strokes[0].points[0]).toEqual([9, 9, 0.5]);
			expect(onOp).not.toHaveBeenCalled();
			board.undo("a"); // only the add is in history
			expect(ids(board)).toEqual([]);
		});

		test("applyRemote update for a missing element is ignored", () => {
			board.applyRemote({ t: "update", stroke: moved("ghost") });
			expect(ids(board)).toEqual([]);
		});
	});
});
