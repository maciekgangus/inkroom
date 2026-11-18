import type { Settings } from "./board/controller";
import type { Dash } from "./board/style";

const KEY = "inkroom.toolStyles";

/** The tools that draw with a line style, each remembering its own (R-097). */
export type StyledTool = "pen" | "line" | "shape";

const DEFAULTS: Record<StyledTool, Dash> = {
	pen: "natural", // R-073
	line: "solid",
	shape: "solid",
};

let kept: Partial<Record<StyledTool, Dash>> | undefined;

const isStyled = (tool: string): tool is StyledTool => tool in DEFAULTS;

/** Lines and shapes have no natural pen (R-073). */
const fits = (tool: StyledTool, dash: unknown): dash is Dash =>
	dash === "solid" ||
	dash === "dashed" ||
	dash === "dotted" ||
	(dash === "natural" && tool === "pen");

function load(): Partial<Record<StyledTool, Dash>> {
	if (kept) return kept;
	kept = {};
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
		for (const tool of Object.keys(DEFAULTS) as StyledTool[])
			if (fits(tool, saved?.[tool])) kept[tool] = saved[tool];
	} catch {
		// nothing usable stored: the defaults apply
	}
	return kept;
}

/** The line style a tool had last on this device, or its default. */
export function lineStyleFor(tool: StyledTool): Dash {
	return load()[tool] ?? DEFAULTS[tool];
}

/** Remembers the line style chosen for a tool, on this device. */
export function rememberLineStyle(tool: string, dash: Dash): void {
	if (!isStyled(tool) || !fits(tool, dash)) return;
	load()[tool] = dash;
	try {
		localStorage.setItem(KEY, JSON.stringify(kept));
	} catch {
		// it then lasts until the page is closed
	}
}

/**
 * Switches the tool and, for pen, line and shapes, restores the line style that tool had last,
 * so a dashed line and a solid pen do not have to be set again after each switch (R-097).
 */
export function switchTool(settings: Settings, tool: Settings["tool"]): void {
	settings.tool = tool;
	if (isStyled(tool)) settings.lineStyle = lineStyleFor(tool);
}

/** Forgets what was kept (tests); `wipe` also clears the stored copy. */
export function resetToolStyles(wipe = true): void {
	kept = undefined;
	if (!wipe) return;
	try {
		localStorage.removeItem(KEY);
	} catch {
		// nothing to remove
	}
}
