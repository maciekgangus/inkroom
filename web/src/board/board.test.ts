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
});
