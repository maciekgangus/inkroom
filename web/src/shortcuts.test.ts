import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Settings } from "./board/controller";
import {
	applyToolShortcut,
	dropsSelection,
	resetShortcuts,
	setShortcut,
	toolKey,
} from "./shortcuts";

beforeEach(() => {
	localStorage.clear();
	resetShortcuts();
});

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
		["KeyQ", "select"],
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
		expect(applyToolShortcut(key("KeyW"), s)).toBe(false);
		expect(applyToolShortcut(key("KeyE", { ctrlKey: true }), s)).toBe(false);
		expect(applyToolShortcut(key("KeyE", { metaKey: true }), s)).toBe(false);
		expect(applyToolShortcut(key("KeyE", { altKey: true }), s)).toBe(false);
		expect(s.tool).toBe("pen");
	});

	test("the tools have labelled keys", () => {
		expect(toolKey("pen")?.label).toBe("F");
		expect(toolKey("select")?.label).toBe("Q"); // Esc still cancels, but Q is the key of the tool
		expect(toolKey("shape")?.label).toBe("K");
	});

	describe("what happens to the selection", () => {
		test("Escape cancels the selection and picks Select", () => {
			const s = fresh("shape");
			const drop = vi.fn();
			applyToolShortcut(key("Escape"), s, drop);
			expect(drop).toHaveBeenCalledOnce();
			expect(s.tool).toBe("select");
		});

		test("picking a drawing tool drops the selection, so a new drawing starts clean", () => {
			for (const code of ["KeyF", "KeyT", "KeyL", "KeyK"]) {
				const drop = vi.fn();
				applyToolShortcut(key(code), fresh("select"), drop);
				expect(drop).toHaveBeenCalledOnce();
			}
		});

		test("the eraser and the hand keep the selection", () => {
			for (const code of ["KeyE", "KeyM"]) {
				const drop = vi.fn();
				applyToolShortcut(key(code), fresh("select"), drop);
				expect(drop).not.toHaveBeenCalled();
			}
		});

		test("dropsSelection tells which tools start a new drawing", () => {
			for (const t of ["pen", "line", "shape", "text"] as const)
				expect(dropsSelection(t)).toBe(true);
			for (const t of ["select", "eraser", "pan"] as const)
				expect(dropsSelection(t)).toBe(false);
		});

		test("without a callback nothing breaks", () => {
			expect(() =>
				applyToolShortcut(key("Escape"), fresh("pen")),
			).not.toThrow();
		});
	});
});

describe("own shortcuts", () => {
	test("a tool can be given another key, and the old one stops working", () => {
		expect(setShortcut("pen", "KeyG")).toEqual({ ok: true });
		const s = fresh("eraser");
		expect(applyToolShortcut(key("KeyG"), s)).toBe(true);
		expect(s.tool).toBe("pen");
		expect(applyToolShortcut(key("KeyF"), fresh("eraser"))).toBe(false);
		expect(toolKey("pen")).toEqual({ code: "KeyG", label: "G" });
	});

	test("a key of another tool is refused and says whose it is", () => {
		expect(setShortcut("pen", "KeyE")).toEqual({ ok: false, taken: "eraser" });
		expect(toolKey("pen")?.label).toBe("F");
	});

	test("the keys that do something else are not offered", () => {
		for (const code of [
			"Escape",
			"Backspace",
			"Delete",
			"Enter",
			"Tab",
			"ShiftLeft",
			"ControlLeft",
		])
			expect(setShortcut("pen", code)).toEqual({ ok: false, reserved: true });
	});

	test("digits and other keys have a readable label", () => {
		setShortcut("pen", "Digit3");
		setShortcut("line", "Numpad7");
		setShortcut("text", "BracketLeft");
		expect(toolKey("pen")?.label).toBe("3");
		expect(toolKey("line")?.label).toBe("Num 7");
		expect(toolKey("text")?.label).toBe("BracketLeft");
	});

	test("the choice is kept on this device and read again", () => {
		setShortcut("pen", "KeyG");
		expect(
			JSON.parse(localStorage.getItem("inkroom.shortcuts") ?? "{}"),
		).toEqual({ pen: "KeyG" });
		resetShortcuts(true); // forget what is in memory, as after a reload
		expect(toolKey("pen")?.code).toBe("KeyG");
	});

	test("damaged or foreign saved data is ignored", () => {
		localStorage.setItem(
			"inkroom.shortcuts",
			'{"pen":5,"nonsense":"KeyX","text":"Escape"}',
		);
		resetShortcuts(true);
		expect(toolKey("pen")?.code).toBe("KeyF");
		expect(toolKey("text")?.code).toBe("KeyT");
		localStorage.setItem("inkroom.shortcuts", "not json");
		resetShortcuts(true);
		expect(toolKey("pen")?.code).toBe("KeyF");
	});

	test("reset brings every default back and forgets the saved ones", () => {
		setShortcut("pen", "KeyG");
		resetShortcuts();
		expect(toolKey("pen")?.code).toBe("KeyF");
		expect(localStorage.getItem("inkroom.shortcuts")).toBeNull();
	});

	test("Escape always cancels the selection, whatever the keys", () => {
		setShortcut("select", "KeyW");
		const drop = vi.fn();
		const s = fresh("pen");
		applyToolShortcut(key("Escape"), s, drop);
		expect(s.tool).toBe("select");
		expect(drop).toHaveBeenCalledOnce();
	});
});
