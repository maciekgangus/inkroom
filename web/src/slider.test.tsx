import { render } from "preact";
import { describe, expect, test, vi } from "vitest";
import { Slider, THUMB_PX } from "./slider";

const mount = (value: number, min = 1, max = 100) => {
	const root = document.createElement("div");
	render(
		<Slider
			label="test"
			min={min}
			max={max}
			value={value}
			unit="%"
			onInput={vi.fn()}
			onChange={vi.fn()}
		/>,
		root,
	);
	return root.querySelector("input") as HTMLInputElement;
};
/** The position of the value along the travel of the thumb, 0 to 1. */
const along = (el: HTMLInputElement) =>
	Number(el.style.getPropertyValue("--p"));

describe("Slider fill", () => {
	test("the thumb is 16 px wide, and the fill is measured to the middle of it", () => {
		expect(THUMB_PX).toBe(16);
	});

	test("the position is 0 at the minimum and 1 at the maximum", () => {
		expect(along(mount(100))).toBe(1);
		expect(along(mount(1))).toBe(0);
	});

	test("is proportional in between, whatever the range", () => {
		expect(along(mount(50.5, 1, 100))).toBeCloseTo(0.5);
		expect(along(mount(25, 0, 100))).toBeCloseTo(0.25);
		expect(along(mount(30, 10, 50))).toBeCloseTo(0.5);
	});

	test("never goes outside the track", () => {
		expect(along(mount(500, 1, 100))).toBe(1);
		expect(along(mount(-5, 1, 100))).toBe(0);
	});

	test("a range with nothing to choose from does not divide by zero", () => {
		expect(along(mount(5, 5, 5))).toBe(0);
	});
});
