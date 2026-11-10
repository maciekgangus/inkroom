import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createViewSaver } from "./view-saver";

const view = (x: number) => ({ x, y: 0, scale: 1 });

describe("saving where the user looks (R-048)", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	test("waits for the view to settle and saves only the last one", () => {
		const save = vi.fn();
		const saver = createViewSaver(save, 1000);
		saver.schedule(view(1));
		vi.advanceTimersByTime(600);
		saver.schedule(view(2));
		vi.advanceTimersByTime(600);
		expect(save).not.toHaveBeenCalled(); // the second change moved the deadline
		vi.advanceTimersByTime(500);
		expect(save).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenCalledWith(view(2));
	});

	test("flush saves at once what is waiting, once", () => {
		const save = vi.fn();
		const saver = createViewSaver(save, 1000);
		saver.schedule(view(3));
		saver.flush();
		saver.flush();
		vi.advanceTimersByTime(5000);
		expect(save).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenCalledWith(view(3));
	});

	test("a view that is already saved is not saved again", () => {
		const save = vi.fn();
		const saver = createViewSaver(save, 1000);
		saver.schedule(view(1));
		vi.advanceTimersByTime(1000);
		saver.schedule(view(1));
		vi.advanceTimersByTime(1000);
		expect(save).toHaveBeenCalledTimes(1);
	});

	test("nothing is saved until it is told what is already known", () => {
		const save = vi.fn();
		const saver = createViewSaver(save, 1000);
		saver.known(view(7)); // the view that was loaded: no need to send it back
		saver.schedule(view(7));
		vi.advanceTimersByTime(2000);
		expect(save).not.toHaveBeenCalled();
	});
});
