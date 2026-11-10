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
		rect: { code: "KeyK", label: "K" },
	};

const isShape = (t: Tool): t is "rect" | "circle" =>
	t === "rect" || t === "circle";

/** Switches the tool, remembering the shape being left so K can return to it. */
export function selectTool(settings: Settings, tool: Tool): void {
	if (isShape(settings.tool)) settings.lastShape = settings.tool;
	settings.tool = tool;
}

/**
 * Switches the tool for a tool key (physical key, so any layout works). Returns whether the
 * key was one; the caller prevents its default. K means the last chosen shape.
 */
export function applyToolShortcut(
	e: KeyboardEvent,
	settings: Settings,
): boolean {
	if (e.ctrlKey || e.metaKey || e.altKey) return false;
	const entry = (Object.entries(TOOL_KEYS) as [Tool, { code: string }][]).find(
		([, k]) => k.code === e.code,
	);
	if (!entry) return false;
	const tool = entry[0];
	if (tool === "rect" && isShape(settings.tool)) return true; // K never swaps shapes
	selectTool(settings, tool === "rect" ? (settings.lastShape ?? "rect") : tool);
	return true;
}
