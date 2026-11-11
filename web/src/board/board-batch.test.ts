import { describe, expect, test, vi } from "vitest";
import { Board, type Stroke } from "./board";

const el = (id: string, z: number, authorId = "me"): Stroke =>
	({
		id,
		authorId,
		color: "#000",
		size: 1,
		z,
		kind: "image",
		src: `src-${id}`,
		points: [
			[0, 0, 0.5],
			[10, 10, 0.5],
		],
	}) as Stroke;

describe("Board.addBatch: elements that arrive one by one and undo as one step", () => {
	test("each is on the board and sent at once, before the batch is done", () => {
		const board = new Board();
		const sent = vi.fn();
		board.onOp = sent;
		const batch = board.addBatch("me");
		batch.add(el("a", 1));
		expect(board.strokes.map((s) => s.id)).toEqual(["a"]);
		expect(sent).toHaveBeenCalledTimes(1);
		batch.add(el("b", 2));
		expect(sent).toHaveBeenCalledTimes(2);
		batch.done();
	});

	test("one undo takes all of them back and one redo brings them again", () => {
		const board = new Board();
		const batch = board.addBatch("me");
		for (const [i, id] of ["a", "b", "c"].entries()) batch.add(el(id, i));
		batch.done();
		expect(board.undo("me")).toBe(true);
		expect(board.strokes).toEqual([]);
		expect(board.undo("me")).toBe(false);
		expect(board.redo("me")).toBe(true);
		expect(board.strokes.map((s) => s.id)).toEqual(["a", "b", "c"]);
	});

	test("the undo is sent as a removal of each element", () => {
		const board = new Board();
		const batch = board.addBatch("me");
		batch.add(el("a", 1));
		batch.add(el("b", 2));
		batch.done();
		const sent = vi.fn();
		board.onOp = sent;
		board.undo("me");
		expect(sent.mock.calls.map((c) => c[0])).toEqual(
			expect.arrayContaining([
				{ t: "remove", id: "a" },
				{ t: "remove", id: "b" },
			]),
		);
	});

	test("an empty batch leaves nothing to undo", () => {
		const board = new Board();
		board.addBatch("me").done();
		expect(board.undo("me")).toBe(false);
	});

	test("it is the history of the author that is changed", () => {
		const board = new Board();
		const batch = board.addBatch("ola");
		batch.add(el("a", 1, "ola"));
		batch.done();
		expect(board.undo("kuba")).toBe(false);
		expect(board.strokes).toHaveLength(1);
		expect(board.undo("ola")).toBe(true);
	});

	test("done is idempotent", () => {
		const board = new Board();
		const batch = board.addBatch("me");
		batch.add(el("a", 1));
		batch.done();
		batch.done();
		board.undo("me");
		expect(board.undo("me")).toBe(false);
	});
});
