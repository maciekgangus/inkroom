import { describe, expect, test } from "vitest";
import { assignColors, CURSOR_COLORS, cursorColor } from "./cursor-colors";

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

describe("assignColors", () => {
	test("gives everyone a different colour while there are colours to spare", () => {
		for (let n = 2; n <= CURSOR_COLORS.length; n++) {
			const ids = Array.from({ length: n }, (_, i) => `person-${i}-x`);
			const colors = assignColors(ids);
			expect(new Set(ids.map((id) => colors.get(id))).size).toBe(n);
		}
	});

	test("is the same on every client, whatever the order of the list", () => {
		const a = assignColors(["m1", "k2", "z9", "b3"]);
		const b = assignColors(["b3", "z9", "m1", "k2"]);
		for (const id of ["m1", "k2", "z9", "b3"])
			expect(a.get(id)).toBe(b.get(id));
	});

	test("keeps a person's usual colour when it is free", () => {
		expect(assignColors(["solo"]).get("solo")).toBe(cursorColor("solo"));
	});

	test("still colours everyone when there are more people than colours", () => {
		const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
		const colors = assignColors(ids);
		for (const id of ids) expect(CURSOR_COLORS).toContain(colors.get(id));
	});
});
