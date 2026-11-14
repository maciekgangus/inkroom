import type { Settings } from "./board/controller";

type Tool = Settings["tool"];

/** The keys of the tools as they come (R-030): the physical key, so any layout works. */
const DEFAULT_KEYS: Partial<Record<Tool, string>> = {
	select: "KeyQ",
	pen: "KeyF",
	text: "KeyT",
	pan: "KeyM",
	eraser: "KeyE",
	line: "KeyL",
	shape: "KeyK",
	laser: "KeyP",
};

/** The tools that have a key, in the order they are listed, with the name shown. */
export const KEYED_TOOLS: { tool: Tool; name: string }[] = [
	{ tool: "select", name: "Zaznacz" },
	{ tool: "pen", name: "Pióro" },
	{ tool: "text", name: "Tekst" },
	{ tool: "pan", name: "Łapka" },
	{ tool: "eraser", name: "Gumka" },
	{ tool: "line", name: "Linia" },
	{ tool: "shape", name: "Kształty" },
	{ tool: "laser", name: "Wskaźnik" },
];

/** Keys that already do something else on the board or in the browser: no tool can have them. */
const RESERVED = new Set([
	"Escape",
	"Backspace",
	"Delete",
	"Enter",
	"Tab",
	"ShiftLeft",
	"ShiftRight",
	"ControlLeft",
	"ControlRight",
	"AltLeft",
	"AltRight",
	"MetaLeft",
	"MetaRight",
	"CapsLock",
]);

const STORE_KEY = "inkroom.shortcuts";

/** What the user changed, by tool; read from this device once, then kept in memory. */
let custom: Partial<Record<Tool, string>> | null = null;

function load(): Partial<Record<Tool, string>> {
	if (custom) return custom;
	custom = {};
	try {
		const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
		if (saved && typeof saved === "object") {
			for (const { tool } of KEYED_TOOLS) {
				const code = (saved as Record<string, unknown>)[tool];
				if (typeof code === "string" && code && !RESERVED.has(code))
					custom[tool] = code;
			}
		}
	} catch {
		// nothing saved, or not readable: the keys as they come
	}
	return custom;
}

function save(): void {
	try {
		if (Object.keys(custom ?? {}).length === 0)
			localStorage.removeItem(STORE_KEY);
		else localStorage.setItem(STORE_KEY, JSON.stringify(custom));
	} catch {
		// the choice then lasts until the page is closed
	}
}

/** The key as a short text for a button or a tooltip ("KeyF" is F, "Digit3" is 3). */
export function codeLabel(code: string): string {
	if (/^Key[A-Z]$/.test(code)) return code.slice(3);
	if (/^Digit[0-9]$/.test(code)) return code.slice(5);
	if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
	return code;
}

/** The physical key and its label for a tool, if it has one. */
export function toolKey(
	tool: Tool,
): { code: string; label: string } | undefined {
	const code = load()[tool] ?? DEFAULT_KEYS[tool];
	return code ? { code, label: codeLabel(code) } : undefined;
}

/** Gives a tool another key; refused when it belongs to another tool or does something else. */
export function setShortcut(
	tool: Tool,
	code: string,
): { ok: true } | { ok: false; reserved: true } | { ok: false; taken: Tool } {
	if (RESERVED.has(code)) return { ok: false, reserved: true };
	const other = KEYED_TOOLS.find(
		(t) => t.tool !== tool && toolKey(t.tool)?.code === code,
	);
	if (other) return { ok: false, taken: other.tool };
	load()[tool] = code;
	save();
	return { ok: true };
}

/** Brings every key back to what it was; `memoryOnly` just forgets what was read (tests, reload). */
export function resetShortcuts(memoryOnly = false): void {
	custom = null;
	if (memoryOnly) return;
	try {
		localStorage.removeItem(STORE_KEY);
	} catch {
		// nothing to remove
	}
}

/** The tools that start a new drawing: choosing one lets go of what was selected. */
export const dropsSelection = (tool: Tool): boolean =>
	tool === "pen" || tool === "line" || tool === "shape" || tool === "text";

/** Switches the tool. */
export function selectTool(settings: Settings, tool: Tool): void {
	settings.tool = tool;
}

/**
 * Switches the tool for a tool key (physical key, so any layout works). Returns whether the
 * key was one; the caller prevents its default. K is the shape tool, whatever shape was chosen.
 * `dropSelection` is called when the key cancels the selection: Escape, or a tool that starts
 * a new drawing.
 */
export function applyToolShortcut(
	e: KeyboardEvent,
	settings: Settings,
	dropSelection?: () => void,
): boolean {
	if (e.ctrlKey || e.metaKey || e.altKey) return false;
	// Escape always cancels the selection, whatever keys the tools have.
	const tool =
		e.code === "Escape"
			? "select"
			: KEYED_TOOLS.find((t) => toolKey(t.tool)?.code === e.code)?.tool;
	if (!tool) return false;
	selectTool(settings, tool); // K keeps the shape chosen before: it is in settings.shape
	if (e.code === "Escape" || dropsSelection(tool)) dropSelection?.();
	return true;
}
