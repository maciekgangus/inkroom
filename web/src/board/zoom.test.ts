import { describe, expect, test } from "vitest";
import { stepZoom, wheelZoomFactor } from "./zoom";

describe("wheelZoomFactor", () => {
	test("a notch of a mouse wheel is a gentle step of about ten percent, not a leap", () => {
		const out = wheelZoomFactor(100, 0); // scroll down: zoom out
		expect(out).toBeGreaterThan(0.85);
		expect(out).toBeLessThan(0.95);
		const inn = wheelZoomFactor(-100, 0);
		expect(inn).toBeGreaterThan(1.05);
		expect(inn).toBeLessThan(1.15);
		expect(out * inn).toBeCloseTo(1, 6); // in and out cancel
	});

	test("the same notch counted in lines (Firefox) is the same step", () => {
		expect(wheelZoomFactor(3, 1)).toBeCloseTo(wheelZoomFactor(100, 0), 1);
	});

	test("a trackpad pinch sends many small deltas, each a fine step", () => {
		const f = wheelZoomFactor(-4, 0);
		expect(f).toBeGreaterThan(1);
		expect(f).toBeLessThan(1.06);
	});

	test("tiny deltas are almost proportional, so a slow pinch is smooth", () => {
		expect(wheelZoomFactor(-1, 0) ** 2).toBeCloseTo(wheelZoomFactor(-2, 0), 3);
		expect(wheelZoomFactor(-2, 0)).toBeGreaterThan(wheelZoomFactor(-1, 0));
	});

	test("bigger deltas never make a bigger step than a notch, and the steps grow without a jump", () => {
		let previous = 1;
		for (const d of [1, 2, 5, 10, 20, 40, 50, 60, 100, 150, 400]) {
			const f = wheelZoomFactor(d, 0);
			expect(f).toBeLessThan(previous + 1e-12); // zooming out more as the delta grows
			expect(previous - f).toBeLessThan(0.06); // no sudden leap between neighbours
			previous = f;
		}
	});

	test("a wild delta cannot throw the zoom more than a few notches", () => {
		expect(wheelZoomFactor(5000, 0)).toBeGreaterThan(0.6);
		expect(wheelZoomFactor(-5000, 0)).toBeLessThan(1.7);
	});
});

describe("stepZoom (smooth zoom towards a target)", () => {
	test("does not move when there is nothing to do or no time has passed", () => {
		expect(stepZoom(1, 1, 16)).toBe(1);
		expect(stepZoom(1, 2, 0)).toBe(1);
	});

	test("moves towards the target, never past it, in either direction", () => {
		let s = 1;
		for (let i = 0; i < 20; i++) {
			const next = stepZoom(s, 2, 16);
			expect(next).toBeGreaterThan(s);
			expect(next).toBeLessThanOrEqual(2);
			s = next;
		}
		let z = 1;
		for (let i = 0; i < 20; i++) {
			const next = stepZoom(z, 0.5, 16);
			expect(next).toBeLessThan(z);
			expect(next).toBeGreaterThanOrEqual(0.5);
			z = next;
		}
	});

	test("takes about a fifth of a second to get there", () => {
		let s = 1;
		for (let i = 0; i < 15; i++) s = stepZoom(s, 2, 1000 / 60); // 250 ms
		expect(s).toBeGreaterThan(1.9);
	});

	test("goes through every percent: the steps are small and even in the log scale", () => {
		let s = 1;
		const ratios: number[] = [];
		for (let i = 0; i < 12; i++) {
			const next = stepZoom(s, 4, 1000 / 60);
			ratios.push(next / s);
			s = next;
		}
		expect(Math.max(...ratios)).toBeLessThan(1.3); // never a leap
		expect(ratios[0]).toBeGreaterThan(ratios[ratios.length - 1]); // eases out
	});

	test("does not depend on the frame rate: two half steps are one whole step", () => {
		const whole = stepZoom(1, 3, 32);
		const halves = stepZoom(stepZoom(1, 3, 16), 3, 16);
		expect(halves).toBeCloseTo(whole, 6);
	});

	test("lands exactly on the target once it is close enough", () => {
		expect(stepZoom(1.9995, 2, 16)).toBe(2);
	});

	test("a long pause lands on the target, not beyond", () => {
		expect(stepZoom(1, 3, 5000)).toBeCloseTo(3, 6);
	});
});
