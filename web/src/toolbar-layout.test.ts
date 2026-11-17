import { afterEach, describe, expect, test, vi } from "vitest";
import { currentLayout } from "./toolbar-layout";

const screen = (opts: { portraitTouch: boolean; narrow: boolean }) =>
	vi.stubGlobal("matchMedia", (q: string) => ({
		matches: q.includes("orientation: portrait")
			? opts.portraitTouch
			: q.includes("max-width")
				? opts.narrow
				: false,
		addEventListener: () => {},
		removeEventListener: () => {},
	}));

describe("toolbar layout (R-082)", () => {
	afterEach(() => vi.unstubAllGlobals());

	test("a tablet held upright gets the rail, however narrow", () => {
		screen({ portraitTouch: true, narrow: true });
		expect(currentLayout()).toBe("rail");
	});

	test("a narrow window that is not an upright tablet gets the compact bar", () => {
		screen({ portraitTouch: false, narrow: true });
		expect(currentLayout()).toBe("compact");
	});

	test("a wide window keeps the full bar as it is", () => {
		screen({ portraitTouch: false, narrow: false });
		expect(currentLayout()).toBe("full");
	});

	test("without matchMedia (tests, old browsers) the bar is the full one", () => {
		vi.stubGlobal("matchMedia", undefined);
		expect(currentLayout()).toBe("full");
	});
});
