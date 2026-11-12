import { describe, expect, test } from "vitest";
import { isReservedName } from "./names";

describe("isReservedName (R-065)", () => {
	test("the Administrator is reserved in any letter case and with anything between the letters", () => {
		for (const n of [
			"Administrator",
			"administrator",
			"  ADMINISTRATOR ",
			"Admin.istrator",
			"a-d-m-i-n-i-s-t-r-a-t-o-r",
			"Administrator!",
		])
			expect(isReservedName(n)).toBe(true);
	});

	test("other names are free", () => {
		for (const n of ["admin", "administrators", "Administratorka", "Ola", ""])
			expect(isReservedName(n)).toBe(false);
	});
});
