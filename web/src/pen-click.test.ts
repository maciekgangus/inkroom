import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installPenClick } from "./pen-click";

describe("installPenClick (R-069)", () => {
	let button: HTMLButtonElement;
	let clicks: number;
	let off: () => void;
	const lift = (type: string, el: Element = button) =>
		el.dispatchEvent(
			new PointerEvent("pointerup", { bubbles: true, pointerType: type }),
		);

	beforeEach(() => {
		vi.useFakeTimers();
		button = document.createElement("button");
		document.body.append(button);
		clicks = 0;
		button.addEventListener("click", () => clicks++);
		off = installPenClick();
	});
	afterEach(() => {
		off();
		button.remove();
		vi.useRealTimers();
	});

	test("a pen lifted from a button that gets no click presses it", () => {
		lift("pen");
		vi.advanceTimersByTime(200);
		expect(clicks).toBe(1);
	});

	test("when the browser sends its own click, none is added", () => {
		lift("pen");
		button.click();
		vi.advanceTimersByTime(200);
		expect(clicks).toBe(1);
	});

	test("a finger or a mouse is left to the browser", () => {
		lift("touch");
		lift("mouse");
		vi.advanceTimersByTime(200);
		expect(clicks).toBe(0);
	});

	test("a pen lifted off any button does nothing", () => {
		lift("pen", document.body);
		vi.advanceTimersByTime(200);
		expect(clicks).toBe(0);
	});

	test("a disabled button is not pressed", () => {
		button.disabled = true;
		lift("pen");
		vi.advanceTimersByTime(200);
		expect(clicks).toBe(0);
	});
});
