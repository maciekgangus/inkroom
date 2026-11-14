import { expect, test, vi } from "vitest";
import { frameBatch } from "./frame-batch";

test("many marks in one frame give one flush with all their kinds", () => {
	let run: (() => void) | null = null;
	const schedule = vi.fn((f: () => void) => {
		run = f;
	});
	const flush = vi.fn();
	const batch = frameBatch(flush, schedule);
	for (let i = 0; i < 200; i++) batch.mark(i % 2 ? 1 : 2); // 200 messages from the network
	expect(flush).not.toHaveBeenCalled();
	expect(schedule).toHaveBeenCalledTimes(1);
	(run as unknown as () => void)();
	expect(flush).toHaveBeenCalledTimes(1);
	expect(flush).toHaveBeenCalledWith(3);
	batch.mark(4); // the next frame starts clean
	(run as unknown as () => void)();
	expect(flush).toHaveBeenLastCalledWith(4);
});

test("after cancel nothing is flushed any more", () => {
	let run: (() => void) | null = null;
	const flush = vi.fn();
	const batch = frameBatch(flush, (f) => {
		run = f;
	});
	batch.mark(1);
	batch.cancel();
	(run as unknown as () => void)();
	expect(flush).not.toHaveBeenCalled();
});
