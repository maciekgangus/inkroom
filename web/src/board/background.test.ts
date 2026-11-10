import { describe, expect, test } from "vitest";
import {
	BACKGROUNDS,
	drawBackground,
	GRID_MIN_SCREEN,
	gridLevels,
	gridPositions,
	isBackground,
} from "./background";
import { Viewport } from "./viewport";

describe("backgrounds", () => {
	test("there are four backgrounds and unknown names are rejected", () => {
		expect(BACKGROUNDS).toEqual(["plain", "dots", "grid", "lines"]);
		expect(isBackground("grid")).toBe(true);
		expect(isBackground("checkers")).toBe(false);
		expect(isBackground(3)).toBe(false);
	});
});

describe("gridLevels (R-032)", () => {
	const scales = Array.from({ length: 200 }, (_, i) => 0.05 * 1.03 ** i); // ~0.05 to ~18

	test("plain has no grid", () => {
		expect(gridLevels("plain", 1)).toEqual([]);
	});

	test("the main level always stays 2 to 4 times the minimum spacing on screen", () => {
		for (const scale of scales) {
			const [main] = gridLevels("grid", scale);
			const screen = main.spacing * scale;
			expect(screen).toBeGreaterThanOrEqual(GRID_MIN_SCREEN * 2 - 1e-9);
			expect(screen).toBeLessThan(GRID_MIN_SCREEN * 4);
			expect(main.alpha).toBe(1);
		}
	});

	test("the finer level is half the spacing and fades in from invisible to full", () => {
		for (const scale of scales) {
			const levels = gridLevels("grid", scale);
			const [main, fine] = levels;
			if (!fine) continue; // still invisible
			expect(fine.spacing).toBeCloseTo(main.spacing / 2);
			expect(fine.alpha).toBeGreaterThan(0);
			expect(fine.alpha).toBeLessThanOrEqual(1);
		}
		// just past a step the finer level is nearly invisible, just before the next it is full
		const at = (screen: number) => gridLevels("grid", screen / 24)[1];
		expect(at(GRID_MIN_SCREEN * 2 + 0.2)?.alpha ?? 0).toBeLessThan(0.1);
		expect(at(GRID_MIN_SCREEN * 4 - 0.2).alpha).toBeGreaterThan(0.9);
	});

	test("zooming never makes the picture jump: the same spacing keeps nearly the same strength", () => {
		// How strongly a line at a multiple of `spacing` shows: any level that divides it covers it.
		const strength = (scale: number, spacing: number) =>
			gridLevels("grid", scale)
				.filter((l) => {
					const r = spacing / l.spacing;
					return Math.abs(r - Math.round(r)) < 1e-9;
				})
				.reduce((a, l) => Math.max(a, l.alpha), 0);
		// the scale where the main level (48 board units) has just reached 4 x the minimum
		const edge = (GRID_MIN_SCREEN * 4) / 48;
		for (const spacing of [48, 24, 12]) {
			const before = strength(edge * (1 - 1e-6), spacing);
			const after = strength(edge * (1 + 1e-6), spacing);
			expect(Math.abs(before - after)).toBeLessThan(1e-3);
		}
	});

	test("every spacing is the base raster times a power of two, so grids always line up", () => {
		for (const kind of ["dots", "grid", "lines"] as const) {
			const base = kind === "lines" ? 32 : 24;
			for (const scale of scales) {
				for (const { spacing } of gridLevels(kind, scale)) {
					const ratio = Math.log2(spacing / base);
					expect(Math.abs(ratio - Math.round(ratio))).toBeLessThan(1e-9);
				}
			}
		}
	});

	test("zoomed in far there are finer lines, so there is always something to line up with", () => {
		const [main] = gridLevels("grid", 10);
		expect(main.spacing).toBeLessThan(24);
		expect(main.spacing * 10).toBeGreaterThanOrEqual(GRID_MIN_SCREEN * 2);
	});
});

describe("gridPositions", () => {
	test("lists the multiples of the spacing inside the range, computed without drift", () => {
		expect(gridPositions(24, -30, 50)).toEqual([-24, 0, 24, 48]);
		expect(
			gridPositions(0.1, 0, 0.3).map((n) => Math.round(n * 1e6) / 1e6),
		).toEqual([0, 0.1, 0.2, 0.3]);
	});
});

describe("drawBackground", () => {
	/** A canvas context that records where lines and dots go. */
	const fake = () => {
		const calls: [string, ...number[]][] = [];
		const ctx = {
			calls,
			globalAlpha: 1,
			alphas: [] as number[],
			strokeStyle: "",
			fillStyle: "",
			lineWidth: 0,
			save: () => {},
			restore: () => {},
			setTransform: () => {},
			beginPath: () => {},
			moveTo: (x: number, y: number) => calls.push(["moveTo", x, y]),
			lineTo: (x: number, y: number) => calls.push(["lineTo", x, y]),
			arc: (x: number, y: number) => calls.push(["arc", x, y]),
			stroke() {
				this.alphas.push(this.globalAlpha);
			},
			fill() {
				this.alphas.push(this.globalAlpha);
			},
		};
		return ctx;
	};
	const view = (x: number, y: number, scale: number) =>
		Object.assign(new Viewport(), { x, y, scale });

	test("plain draws nothing", () => {
		const ctx = fake();
		drawBackground(ctx as never, "plain", view(0, 0, 1), 200, 200, 1, "#ccc");
		expect(ctx.calls).toEqual([]);
	});

	test("lines sit on the pixel grid of the board coordinates, whatever the pan", () => {
		const ctx = fake();
		// scale 1: the main level is 24 board units; panned so board x = 100 is at screen 0
		drawBackground(ctx as never, "grid", view(100, 0, 1), 400, 100, 1, "#ccc");
		const xs = ctx.calls.filter((c) => c[0] === "moveTo").map((c) => c[1]);
		// board x = 144 (a multiple of the 24 unit level) is at screen 44; drawn on the half pixel
		expect(xs).toContain(44.5);
	});

	test("the finer level is drawn with its own, lower strength", () => {
		const ctx = fake();
		drawBackground(
			ctx as never,
			"lines",
			view(0, 0, 0.55),
			300,
			300,
			1,
			"#ccc",
		);
		expect(ctx.alphas.length).toBeGreaterThan(0);
		expect(Math.max(...ctx.alphas)).toBe(1);
	});

	test("dots are drawn as arcs", () => {
		const ctx = fake();
		drawBackground(ctx as never, "dots", view(0, 0, 1), 100, 100, 1, "#ccc");
		expect(ctx.calls.some((c) => c[0] === "arc")).toBe(true);
	});
});
