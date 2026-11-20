import { describe, expect, test } from "vitest";
import { layerCap, layerMargin } from "./overdraw";

const pixels = (
	w: number,
	h: number,
	dpr: number,
	m: { mx: number; my: number },
) => (w + 2 * m.mx) * dpr * ((h + 2 * m.my) * dpr);

/** What the layer margin was before R-074 grew (a quarter of the window, shrunk to 10M px). */
const OLD_SHARE = 0.25;

describe("layerMargin (R-074, R-077)", () => {
	test("a desktop window gets a margin of half a screen on each side", () => {
		const m = layerMargin(1920, 1080, 1, 16_000_000);
		expect(m.mx).toBe(960);
		expect(m.my).toBe(540);
		expect(m.mx).toBeGreaterThan(1920 * OLD_SHARE);
		expect(pixels(1920, 1080, 1, m)).toBeLessThanOrEqual(16_000_000);
	});

	test("the margin is larger than before on a desktop at pixel ratio 1.25 too", () => {
		const m = layerMargin(1920, 1080, 1.25, 16_000_000);
		expect(m.mx).toBeGreaterThan(1920 * OLD_SHARE);
		expect(pixels(1920, 1080, 1.25, m)).toBeLessThanOrEqual(16_000_000);
	});

	test("an iPad stays under the cap of a small device", () => {
		const m = layerMargin(1024, 1366, 2, 10_000_000);
		expect(m.mx).toBeGreaterThan(0);
		expect(pixels(1024, 1366, 2, m)).toBeLessThanOrEqual(10_000_000);
	});

	test("a Samsung-like tablet stays under the cap of a small device", () => {
		const m = layerMargin(1600, 2560, 1.5, 10_000_000);
		expect(pixels(1600, 2560, 1.5, m)).toBeLessThanOrEqual(10_000_000);
	});

	test("a screen bigger than the cap gets no margin", () => {
		expect(layerMargin(3840, 2160, 2, 10_000_000)).toEqual({ mx: 0, my: 0 });
	});
});

describe("layerCap", () => {
	test("a touch device keeps the crash-fix cap of 10M pixels whatever its memory", () => {
		expect(layerCap({ touch: true, memoryGb: 8 })).toBe(10_000_000);
	});

	test("a desktop with 8 GB or more may hold a bigger layer", () => {
		expect(layerCap({ touch: false, memoryGb: 8 })).toBe(16_000_000);
	});

	test("a desktop with less memory or an unknown one keeps 10M", () => {
		expect(layerCap({ touch: false, memoryGb: 4 })).toBe(10_000_000);
		expect(layerCap({ touch: false, memoryGb: undefined })).toBe(10_000_000);
	});
});
