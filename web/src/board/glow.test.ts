import { describe, expect, test } from "vitest";
import { DEFAULT_GLOW, glowColor, parseGlow } from "./glow";

describe("selection glow settings (R-058)", () => {
	test("the colour follows hue, lightness and opacity", () => {
		expect(glowColor({ ...DEFAULT_GLOW, hue: 120, light: 50, alpha: 40 })).toBe(
			"hsla(120, 100%, 50%, 0.4)",
		);
	});

	test("stored settings are read back, a bad or missing value falls back to the default", () => {
		const g = { blur: 20, passes: 3, alpha: 80, hue: 200, light: 60 };
		expect(parseGlow(JSON.stringify(g))).toEqual(g);
		expect(parseGlow(null)).toEqual(DEFAULT_GLOW);
		expect(parseGlow("nonsense")).toEqual(DEFAULT_GLOW);
		expect(parseGlow('{"blur":"x","passes":99}')).toEqual({
			...DEFAULT_GLOW,
			passes: 6,
		});
	});
});
