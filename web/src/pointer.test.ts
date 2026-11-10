import { afterEach, describe, expect, test, vi } from "vitest";
import { hasFinePointer } from "./pointer";

describe("hasFinePointer", () => {
	afterEach(() => vi.unstubAllGlobals());

	test("asks for a hovering, precise main pointer, so a laptop with a touch screen counts as a PC", () => {
		const mm = vi.fn(() => ({ matches: true }));
		vi.stubGlobal("matchMedia", mm);
		expect(hasFinePointer()).toBe(true);
		expect(mm).toHaveBeenCalledWith("(hover: hover) and (pointer: fine)");
	});

	test("is false on a tablet and where matchMedia is missing", () => {
		vi.stubGlobal("matchMedia", () => ({ matches: false }));
		expect(hasFinePointer()).toBe(false);
		vi.stubGlobal("matchMedia", undefined);
		expect(hasFinePointer()).toBe(false);
	});
});
