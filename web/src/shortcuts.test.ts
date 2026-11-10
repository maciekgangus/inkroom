import { describe, expect, test } from "vitest";
import type { Settings } from "./board/controller";
import { applyToolShortcut, TOOL_KEYS } from "./shortcuts";

const fresh = (tool: Settings["tool"] = "pen"): Settings => ({
	tool,
	color: "#111",
	size: 4,
});
const key = (code: string, extra: Partial<KeyboardEvent> = {}) =>
	({
		code,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		...extra,
	}) as KeyboardEvent;

describe("tool shortcuts (R-030)", () => {
	test.each([
		["KeyF", "pen"],
		["KeyT", "text"],
		["KeyM", "pan"],
		["Escape", "select"],
		["KeyE", "eraser"],
		["KeyL", "line"],
		["KeyK", "rect"],
	] as const)("%s switches to %s", (code, tool) => {
		const s = fresh("eraser");
		expect(applyToolShortcut(key(code), s)).toBe(true);
		expect(s.tool).toBe(tool);
	});

	test("K uses the last chosen shape, the rectangle by default", () => {
		const s = fresh("circle");
		applyToolShortcut(key("KeyF"), s); // leave the circle for the pen
		applyToolShortcut(key("KeyK"), s);
		expect(s.tool).toBe("circle");
	});

	test("K while a shape tool is active changes nothing", () => {
		const s = fresh("circle");
		s.lastShape = "rect";
		expect(applyToolShortcut(key("KeyK"), s)).toBe(true);
		expect(s.tool).toBe("circle");
	});

	test("picking a shape remembers it for K", () => {
		const s = fresh();
		s.tool = "circle";
		applyToolShortcut(key("KeyF"), s);
		expect(s.lastShape).toBe("circle");
	});

	test("other keys, and keys held with Ctrl, Cmd or Alt, are left alone", () => {
		const s = fresh();
		expect(applyToolShortcut(key("KeyQ"), s)).toBe(false);
		expect(applyToolShortcut(key("KeyE", { ctrlKey: true }), s)).toBe(false);
		expect(applyToolShortcut(key("KeyE", { metaKey: true }), s)).toBe(false);
		expect(applyToolShortcut(key("KeyE", { altKey: true }), s)).toBe(false);
		expect(s.tool).toBe("pen");
	});

	test("every toolbar tool but the circle has a labelled key", () => {
		expect(TOOL_KEYS.pen?.label).toBe("F");
		expect(TOOL_KEYS.select?.label).toBe("Esc");
		expect(TOOL_KEYS.rect?.label).toBe("K");
	});
});
