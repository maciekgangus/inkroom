import type { Settings } from "./board/controller";
import type { Dash } from "./board/style";

const KEY = "inkroom.toolStyles";

/** The tools that draw with a line, each remembering its own look (R-097). */
export type StyledTool = "pen" | "line" | "shape";

const DEFAULTS: Record<StyledTool, Dash> = {
	pen: "natural", // R-073
	line: "solid",
	shape: "solid",
};

/** What a tool keeps besides its line style: colour, thickness and opacity. */
interface Kept {
	dashes: Partial<Record<StyledTool, Dash>>;
	colors: Partial<Record<StyledTool, string>>;
	sizes: Partial<Record<StyledTool, number>>;
	opacities: Partial<Record<StyledTool, number>>;
	/** The drawing tool the page was left with. */
	last?: StyledTool;
}

let kept: Kept | undefined;

const isStyled = (tool: string): tool is StyledTool => tool in DEFAULTS;

const isColor = (c: unknown): c is string =>
	typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c);

/** The thickness slider runs from 0.25 to 50 (board units). */
const isSize = (n: unknown): n is number =>
	typeof n === "number" && n >= 0.25 && n <= 50;

/** The opacity slider runs from 1 % to 100 %. */
const isOpacity = (n: unknown): n is number =>
	typeof n === "number" && n >= 0.01 && n <= 1;

/** Lines and shapes have no natural pen (R-073). */
const fits = (tool: StyledTool, dash: unknown): dash is Dash =>
	dash === "solid" ||
	dash === "dashed" ||
	dash === "dotted" ||
	(dash === "natural" && tool === "pen");

function load(): Kept {
	if (kept) return kept;
	const k: Kept = { dashes: {}, colors: {}, sizes: {}, opacities: {} };
	kept = k;
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
		for (const tool of Object.keys(DEFAULTS) as StyledTool[]) {
			if (fits(tool, saved?.[tool])) k.dashes[tool] = saved[tool];
			if (isColor(saved?.colors?.[tool])) k.colors[tool] = saved.colors[tool];
			if (isSize(saved?.sizes?.[tool])) k.sizes[tool] = saved.sizes[tool];
			if (isOpacity(saved?.opacities?.[tool]))
				k.opacities[tool] = saved.opacities[tool];
		}
		if (typeof saved?.last === "string" && isStyled(saved.last))
			k.last = saved.last;
	} catch {
		// nothing usable stored: the defaults apply
	}
	return k;
}

function save(): void {
	const k = load();
	// A plain object keeps the line styles where earlier versions wrote them.
	const out: Record<string, unknown> = { ...k.dashes };
	if (Object.keys(k.colors).length) out.colors = k.colors;
	if (Object.keys(k.sizes).length) out.sizes = k.sizes;
	if (Object.keys(k.opacities).length) out.opacities = k.opacities;
	if (k.last) out.last = k.last;
	try {
		localStorage.setItem(KEY, JSON.stringify(out));
	} catch {
		// it then lasts until the page is closed
	}
}

/** The line style a tool had last on this device, or its default. */
export function lineStyleFor(tool: StyledTool): Dash {
	return load().dashes[tool] ?? DEFAULTS[tool];
}

/** Remembers the line style chosen for a tool, on this device. */
export function rememberLineStyle(tool: string, dash: Dash): void {
	if (!isStyled(tool) || !fits(tool, dash)) return;
	load().dashes[tool] = dash;
	save();
}

/** The colour a tool had last on this device (the colour as chosen, not as shown in a theme). */
export function colorFor(tool: StyledTool): string | undefined {
	return load().colors[tool];
}

/** Remembers the colour a tool draws with, on this device (R-097). */
export function rememberColor(tool: string, color: string): void {
	if (!isStyled(tool) || !isColor(color)) return;
	const k = load();
	if (k.colors[tool] === color) return;
	k.colors[tool] = color;
	save();
}

/** The thickness a tool had last on this device, if it was set. */
export function sizeFor(tool: StyledTool): number | undefined {
	return load().sizes[tool];
}

/** Remembers the thickness a tool draws with, on this device (R-097). */
export function rememberSize(tool: string, size: number): void {
	if (!isStyled(tool) || !isSize(size)) return;
	const k = load();
	if (k.sizes[tool] === size) return;
	k.sizes[tool] = size;
	save();
}

/** The opacity a tool had last on this device, if it was set. */
export function opacityFor(tool: StyledTool): number | undefined {
	return load().opacities[tool];
}

/** Remembers the opacity a tool draws with, on this device (R-097). */
export function rememberOpacity(tool: string, opacity: number): void {
	if (!isStyled(tool) || !isOpacity(opacity)) return;
	const k = load();
	if (k.opacities[tool] === opacity) return;
	k.opacities[tool] = opacity;
	save();
}

/**
 * Puts on the settings what a drawing tool had last: its line style, colour, thickness and
 * opacity. With `adopt`, what it never had is taken from the settings in hand and kept for it
 * from now on (a tool used for the first time); without, the defaults stay unsaved.
 */
function wear(settings: Settings, tool: StyledTool, adopt: boolean): void {
	settings.lineStyle = lineStyleFor(tool);
	const color = colorFor(tool);
	if (color) settings.color = color;
	else if (adopt) rememberColor(tool, settings.color);
	const size = sizeFor(tool);
	if (size !== undefined) settings.size = size;
	else if (adopt) rememberSize(tool, settings.size);
	const opacity = opacityFor(tool);
	if (opacity !== undefined) settings.opacity = opacity;
	else if (adopt && settings.opacity !== undefined)
		rememberOpacity(tool, settings.opacity);
}

/**
 * Switches the tool and, for pen, line and shapes, restores the line style, colour, thickness and
 * opacity that tool had last, so a dashed blue line and a solid red pen do not have to be set
 * again after each switch (R-097). What is in hand goes to the tool being left, and a tool used
 * for the first time starts with what is in hand.
 */
export function switchTool(settings: Settings, tool: Settings["tool"]): void {
	const from = settings.tool;
	if (isStyled(from)) {
		rememberColor(from, settings.color);
		rememberSize(from, settings.size);
		if (settings.opacity !== undefined) rememberOpacity(from, settings.opacity);
	}
	settings.tool = tool;
	if (!isStyled(tool)) return;
	wear(settings, tool, true);
	const k = load();
	if (k.last !== tool) {
		k.last = tool;
		save();
	}
}

/**
 * Sets up the settings of a page that has just opened: the drawing tool it was left with (the
 * pen when there is none) wearing what it had last. The eraser, the hand and the laser are never
 * the tool a page starts with (R-097).
 */
export function restoreStart(settings: Settings): void {
	const tool = load().last ?? "pen";
	settings.tool = tool;
	wear(settings, tool, false);
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
