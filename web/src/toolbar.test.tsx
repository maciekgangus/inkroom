import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Settings } from "./board/controller";
import { COLORS, SIZES, Toolbar } from "./toolbar";

describe("Toolbar", () => {
	let root: HTMLElement;
	let settings: Settings;
	let onUndo: () => void;
	let onRedo: () => void;

	beforeEach(() => {
		root = document.createElement("div");
		settings = { tool: "pen", color: COLORS[0], size: SIZES[1] };
		onUndo = vi.fn();
		onRedo = vi.fn();
		render(
			<Toolbar settings={settings} onUndo={onUndo} onRedo={onRedo} />,
			root,
		);
	});

	const click = (label: string) =>
		(root.querySelector(`[aria-label="${label}"]`) as HTMLElement).click();

	test("has 5 colors and 3 sizes", () => {
		expect(COLORS).toHaveLength(5);
		expect(SIZES).toHaveLength(3);
	});

	test("tool buttons show an icon and a Polish tooltip instead of a text label", () => {
		const pen = root.querySelector('[aria-label="pen"]') as HTMLElement;
		expect(pen.querySelector("svg")).not.toBeNull();
		expect(pen.textContent).toBe("");
		expect(pen.title).toBe("Pióro");
		expect(root.querySelector('[aria-label="undo"] svg')).not.toBeNull();
	});

	test("the chosen tool, colour and size are marked as pressed", () => {
		const pressed = () =>
			[...root.querySelectorAll('[aria-pressed="true"]')].map((b) =>
				b.getAttribute("aria-label"),
			);
		expect(pressed()).toEqual([
			"pen",
			`color ${COLORS[0]}`,
			`size ${SIZES[1]}`,
		]);
		act(() => click("eraser"));
		expect(pressed()).toEqual(["eraser", `size ${SIZES[1]}`]);
	});

	test("eraser and pen buttons switch the tool", () => {
		click("eraser");
		expect(settings.tool).toBe("eraser");
		click("pen");
		expect(settings.tool).toBe("pen");
	});

	test("the hand button switches to panning", () => {
		click("pan");
		expect(settings.tool).toBe("pan");
		click(`color ${COLORS[1]}`);
		expect(settings.tool).toBe("pen");
	});

	test("shape and text buttons select their tools", () => {
		for (const tool of ["line", "rect", "circle", "text"] as const) {
			click(tool);
			expect(settings.tool).toBe(tool);
		}
	});

	test("picking a colour keeps a shape or text tool, but leaves the eraser and the hand", () => {
		click("rect");
		click(`color ${COLORS[3]}`);
		expect(settings.tool).toBe("rect");
		expect(settings.color).toBe(COLORS[3]);
		click("text");
		click(`color ${COLORS[1]}`);
		expect(settings.tool).toBe("text");
		click("eraser");
		click(`color ${COLORS[2]}`);
		expect(settings.tool).toBe("pen");
	});

	test("color buttons set the color and switch back to the pen", () => {
		click("eraser");
		click(`color ${COLORS[2]}`);
		expect(settings.color).toBe(COLORS[2]);
		expect(settings.tool).toBe("pen");
	});

	test("size buttons set the size", () => {
		click(`size ${SIZES[2]}`);
		expect(settings.size).toBe(SIZES[2]);
	});

	test("undo and redo buttons call the handlers", () => {
		click("undo");
		click("redo");
		expect(onUndo).toHaveBeenCalledOnce();
		expect(onRedo).toHaveBeenCalledOnce();
	});
});
