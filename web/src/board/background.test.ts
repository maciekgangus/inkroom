import { describe, expect, test } from "vitest";
import { BACKGROUNDS, backgroundStyle, isBackground } from "./background";
import { Viewport } from "./viewport";

const view = (x: number, y: number, scale: number) =>
	Object.assign(new Viewport(), { x, y, scale });

describe("backgroundStyle", () => {
	test("there are four backgrounds and unknown names are rejected", () => {
		expect(BACKGROUNDS).toEqual(["plain", "dots", "grid", "lines"]);
		expect(isBackground("grid")).toBe(true);
		expect(isBackground("stars")).toBe(false);
		expect(isBackground(undefined)).toBe(false);
	});

	test("plain has no pattern", () => {
		expect(backgroundStyle("plain", view(0, 0, 1))).toEqual({});
	});

	test("the grid moves with the board", () => {
		const s = backgroundStyle("grid", view(10, 5, 1));
		expect(s.backgroundSize).toBe("24px 24px");
		expect(s.backgroundPosition).toBe("14px 19px");
		expect(s.backgroundImage?.match(/linear-gradient/g)).toHaveLength(2);
	});

	test("the grid scales with the zoom", () => {
		const s = backgroundStyle("grid", view(10, 5, 2));
		expect(s.backgroundSize).toBe("48px 48px");
		expect(s.backgroundPosition).toBe("28px 38px");
	});

	test("when zoomed far out the spacing doubles so the pattern stays readable", () => {
		expect(backgroundStyle("grid", view(0, 0, 0.25)).backgroundSize).toBe(
			"12px 12px",
		);
		expect(backgroundStyle("grid", view(0, 0, 0.1)).backgroundSize).toBe(
			"19.2px 19.2px",
		);
	});

	test("lines are horizontal only and dots sit on the grid crossings", () => {
		const lines = backgroundStyle("lines", view(0, 0, 1));
		expect(lines.backgroundImage?.match(/linear-gradient/g)).toHaveLength(1);
		expect(lines.backgroundSize).toBe("32px 32px");
		const dots = backgroundStyle("dots", view(0, 0, 1));
		expect(dots.backgroundImage).toContain("radial-gradient");
		expect(dots.backgroundPosition).toBe("12px 12px");
	});
});
