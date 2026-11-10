import { render } from "preact";
import { describe, expect, test, vi } from "vitest";
import { Slider } from "./slider";

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
const fill = (el: HTMLInputElement) => el.style.getPropertyValue("--fill");

describe("Slider fill", () => {
	test("is completely filled at the maximum and empty at the minimum", () => {
		expect(fill(mount(100))).toBe("100%");
		expect(fill(mount(1))).toBe("0%");
	});

	test("is proportional in between, whatever the range", () => {
		expect(fill(mount(50.5, 1, 100))).toBe("50%");
		expect(fill(mount(25, 0, 100))).toBe("25%");
		expect(fill(mount(30, 10, 50))).toBe("50%");
	});

	test("never goes outside the track", () => {
		expect(fill(mount(500, 1, 100))).toBe("100%");
		expect(fill(mount(-5, 1, 100))).toBe("0%");
	});
});
