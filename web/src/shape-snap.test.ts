import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadSnapShapes, saveSnapShapes } from "./shape-snap";

describe("the switch for straightening shapes (R-095)", () => {
	beforeEach(() => localStorage.clear());
	afterEach(() => vi.unstubAllGlobals());

	const pointer = (coarse: boolean) =>
		vi.stubGlobal("matchMedia", (q: string) => ({
			matches: coarse && q.includes("coarse"),
		}));

	test("is on by default on a touch screen and off on a computer", () => {
		pointer(true);
		expect(loadSnapShapes()).toBe(true);
		pointer(false);
		expect(loadSnapShapes()).toBe(false);
	});

	test("what was chosen on the device wins over the default", () => {
		pointer(true);
		saveSnapShapes(false);
		expect(loadSnapShapes()).toBe(false);
		pointer(false);
		saveSnapShapes(true);
		expect(loadSnapShapes()).toBe(true);
	});
});
