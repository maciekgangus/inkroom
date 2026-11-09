import { render } from "preact";
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

	test("eraser and pen buttons switch the tool", () => {
		click("eraser");
		expect(settings.tool).toBe("eraser");
		click("pen");
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
