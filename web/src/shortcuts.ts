import type { Settings } from "./board/controller";

type Tool = Settings["tool"];

/** Keyboard shortcuts of the tools (R-030): `code` is the physical key, `label` is shown. */
export const TOOL_KEYS: Partial<Record<Tool, { code: string; label: string }>> =
	{
		pen: { code: "KeyF", label: "F" },
		text: { code: "KeyT", label: "T" },
		pan: { code: "KeyM", label: "M" },
		select: { code: "Escape", label: "Esc" },
		eraser: { code: "KeyE", label: "E" },
		line: { code: "KeyL", label: "L" },
		shape: { code: "KeyK", label: "K" },
	};

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
	const entry = (Object.entries(TOOL_KEYS) as [Tool, { code: string }][]).find(
		([, k]) => k.code === e.code,
	);
	if (!entry) return false;
	const tool = entry[0];
	selectTool(settings, tool); // K keeps the shape chosen before: it is in settings.shape
	if (e.code === "Escape" || dropsSelection(tool)) dropSelection?.();
	return true;
}
