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
let keptColors: Partial<Record<StyledTool, string>> = {};

const isStyled = (tool: string): tool is StyledTool => tool in DEFAULTS;

const isColor = (c: unknown): c is string =>
	typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c);

/** Lines and shapes have no natural pen (R-073). */
const fits = (tool: StyledTool, dash: unknown): dash is Dash =>
	dash === "solid" ||
	dash === "dashed" ||
	dash === "dotted" ||
	(dash === "natural" && tool === "pen");

function load(): Partial<Record<StyledTool, Dash>> {
	if (kept) return kept;
	kept = {};
	keptColors = {};
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
		for (const tool of Object.keys(DEFAULTS) as StyledTool[]) {
			if (fits(tool, saved?.[tool])) kept[tool] = saved[tool];
			if (isColor(saved?.colors?.[tool])) keptColors[tool] = saved.colors[tool];
		}
	} catch {
		// nothing usable stored: the defaults apply
	}
	return kept;
}

function save(): void {
	try {
		const colors = Object.keys(keptColors).length ? { colors: keptColors } : {};
		localStorage.setItem(KEY, JSON.stringify({ ...kept, ...colors }));
	} catch {
		// it then lasts until the page is closed
	}
}

/** The line style a tool had last on this device, or its default. */
export function lineStyleFor(tool: StyledTool): Dash {
	return load()[tool] ?? DEFAULTS[tool];
}

/** Remembers the line style chosen for a tool, on this device. */
export function rememberLineStyle(tool: string, dash: Dash): void {
	if (!isStyled(tool) || !fits(tool, dash)) return;
	load()[tool] = dash;
	save();
}

/** The colour a tool had last on this device (the colour as chosen, not as shown in a theme). */
export function colorFor(tool: StyledTool): string | undefined {
	load();
	return keptColors[tool];
}

/** Remembers the colour a tool draws with, on this device (R-097). */
export function rememberColor(tool: string, color: string): void {
	if (!isStyled(tool) || !isColor(color)) return;
	load();
	if (keptColors[tool] === color) return;
	keptColors[tool] = color;
	save();
}

/**
 * Switches the tool and, for pen, line and shapes, restores the line style and the colour that
 * tool had last, so a dashed blue line and a solid red pen do not have to be set again after each
 * switch (R-097). The colour in hand goes to the tool being left, and a tool used for the first
 * time starts with the colour in hand.
 */
export function switchTool(settings: Settings, tool: Settings["tool"]): void {
	rememberColor(settings.tool, settings.color);
	settings.tool = tool;
	if (!isStyled(tool)) return;
	settings.lineStyle = lineStyleFor(tool);
	const color = colorFor(tool);
	if (color) settings.color = color;
	else rememberColor(tool, settings.color);
}

/** Forgets what was kept (tests); `wipe` also clears the stored copy. */
export function resetToolStyles(wipe = true): void {
	kept = undefined;
	keptColors = {};
	if (!wipe) return;
	try {
		localStorage.removeItem(KEY);
	} catch {
		// nothing to remove
	}
}
