import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CustomColor, hexToHsl, hslToHex } from "./custom-color";

describe("hue, saturation, lightness", () => {
	test("pure colours", () => {
		expect(hslToHex(0, 100, 50)).toBe("#ff0000");
		expect(hslToHex(240, 100, 50)).toBe("#0000ff");
		expect(hexToHsl("#00ff00")).toEqual([120, 100, 50]);
	});

	test("a colour goes there and back within one step per channel", () => {
		const back = hslToHex(...hexToHsl("#d32f2f"));
		const a = 0xd32f2f;
		const b = Number.parseInt(back.slice(1), 16);
		for (const shift of [16, 8, 0])
			expect(
				Math.abs(((a >> shift) & 255) - ((b >> shift) & 255)),
			).toBeLessThanOrEqual(2);
	});

	test("black and grey have no hue", () => {
		expect(hexToHsl("#000000")).toEqual([0, 0, 0]);
		expect(hexToHsl("#808080")[1]).toBe(0);
	});
});

describe("CustomColor", () => {
	let root: HTMLElement;
	const calls = { input: vi.fn(), change: vi.fn() };

	const mount = (current: string | null, open: boolean) => {
		const draw = (isOpen: boolean) =>
			render(
				<CustomColor
					label="custom"
					current={current}
					own={current !== null}
					display={(c) => c}
					open={isOpen}
					onToggle={() => act(() => draw(!isOpen))}
					onInput={calls.input}
					onChange={calls.change}
				/>,
				root,
			);
		act(() => draw(open));
	};

	beforeEach(() => {
		root = document.createElement("div");
		calls.input.mockClear();
		calls.change.mockClear();
	});
	afterEach(() => act(() => render(null, root)));

	const q = (label: string) =>
		root.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;

	test("is a round tile with a plus while no colour of its own is set", () => {
		mount(null, false);
		const tile = q("custom") as HTMLElement;
		expect(tile.tagName).toBe("BUTTON");
		expect(tile.getAttribute("aria-expanded")).toBe("false");
		expect(tile.querySelector("svg")).not.toBeNull();
		expect(root.querySelector('input[type="color"]')).toBeNull();
	});

	test("shows its own colour in place of the plus", () => {
		mount("#123456", false);
		const tile = q("custom") as HTMLElement;
		expect(tile.querySelector("svg")).toBeNull();
		expect(tile.style.getPropertyValue("--swatch")).toBe("#123456");
	});

	test("pressing it opens the picker, and again shuts it", () => {
		mount(null, false);
		expect(root.querySelector(".color-picker")).toBeNull();
		act(() => (q("custom") as HTMLElement).click());
		expect(root.querySelector(".color-picker")).not.toBeNull();
		expect(q("custom")?.getAttribute("aria-expanded")).toBe("true");
		act(() => (q("custom") as HTMLElement).click());
		expect(root.querySelector(".color-picker")).toBeNull();
	});

	test("a grey start gets some saturation so that the hue slider does something", () => {
		mount("#808080", true);
		const hue = q("custom hue") as HTMLInputElement;
		hue.value = "200";
		act(() => {
			hue.dispatchEvent(new Event("input", { bubbles: true }));
		});
		const sent = calls.input.mock.calls[0][0] as string;
		expect(sent).toMatch(/^#[0-9a-f]{6}$/);
		expect(sent).not.toBe("#808080");
		expect(hexToHsl(sent)[1]).toBeGreaterThan(50);
	});

	test("moving a slider previews, releasing it makes the change", () => {
		mount("#d32f2f", true);
		const shade = q("custom shade") as HTMLInputElement;
		shade.value = "30";
		act(() => {
			shade.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(calls.input).toHaveBeenCalledOnce();
		expect(calls.change).not.toHaveBeenCalled();
		act(() => {
			shade.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(calls.change).toHaveBeenCalledOnce();
		expect(calls.change.mock.calls[0][0]).toMatch(/^#[0-9a-f]{6}$/);
	});
});
