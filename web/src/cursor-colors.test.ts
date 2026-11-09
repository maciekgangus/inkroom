import { describe, expect, test } from "vitest";
import { CURSOR_COLORS, cursorColor } from "./cursor-colors";

describe("cursorColor", () => {
	test("is stable for the same person", () => {
		expect(cursorColor("abc-123")).toBe(cursorColor("abc-123"));
	});

	test("always comes from the palette", () => {
		for (const id of ["a", "b", "ola", "x9f3k2", "0123456789abcdef", ""]) {
			expect(CURSOR_COLORS).toContain(cursorColor(id));
		}
	});

	test("different people usually get different colours", () => {
		const colours = new Set(
			Array.from({ length: 40 }, (_, i) => cursorColor(`user-${i}`)),
		);
		expect(colours.size).toBeGreaterThan(3);
	});
});
