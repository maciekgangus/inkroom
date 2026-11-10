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
		["KeyK", "shape"],
	] as const)("%s switches to %s", (code, tool) => {
		const s = fresh("eraser");
		expect(applyToolShortcut(key(code), s)).toBe(true);
		expect(s.tool).toBe(tool);
	});

	test("K picks the shape tool and keeps the shape chosen before", () => {
		const s = fresh("pen");
		s.shape = "rhombus";
		applyToolShortcut(key("KeyK"), s);
		expect(s.tool).toBe("shape");
		expect(s.shape).toBe("rhombus");
	});

	test("K while the shape tool is active changes nothing", () => {
		const s = fresh("shape");
		s.shape = "trapezoid";
		expect(applyToolShortcut(key("KeyK"), s)).toBe(true);
		expect(s.tool).toBe("shape");
		expect(s.shape).toBe("trapezoid");
	});

	test("other keys, and keys held with Ctrl, Cmd or Alt, are left alone", () => {
		const s = fresh();
		expect(applyToolShortcut(key("KeyQ"), s)).toBe(false);
		expect(applyToolShortcut(key("KeyE", { ctrlKey: true }), s)).toBe(false);
		expect(applyToolShortcut(key("KeyE", { metaKey: true }), s)).toBe(false);
		expect(applyToolShortcut(key("KeyE", { altKey: true }), s)).toBe(false);
		expect(s.tool).toBe("pen");
	});

	test("the tools have labelled keys", () => {
		expect(TOOL_KEYS.pen?.label).toBe("F");
		expect(TOOL_KEYS.select?.label).toBe("Esc");
		expect(TOOL_KEYS.shape?.label).toBe("K");
	});
});
