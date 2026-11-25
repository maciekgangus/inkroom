import type { Stroke } from "./board";
import { clamp } from "./clamp";
import { type PlaneFn, sanitizeFns } from "./functions";
import { hasInside, isPolygonKind } from "./shapes";
import { fontSizeFor, fontSizeOf } from "./text";
import { FONT_KEYS, type FontKey, fontKeyOf } from "./text-wrap";
import { MIN_AREA_WIDTH } from "./transform";

export type Dash = "solid" | "dashed" | "dotted" | "natural";

/** Changes to apply to elements; each only touches the kinds it makes sense for. */
export interface StylePatch {
	color?: string;
	/** Line width in px (1 to 50). */
	size?: number;
	/** Font size in px (4 to 400), for texts only. */
	fontSize?: number;
	/** Font family of a text (R-101). */
	font?: FontKey;
	/** Width of a text area in board units (R-101); makes a text at a point an area. */
	width?: number;
	dash?: Dash;
	/** A colour, or null to remove the fill. */
	fill?: string | null;
	opacity?: number;
	/** Numbers on the marks of a coordinate system. */
	numbered?: boolean;
	/** For a coordinate plane (R-084): the grid on or off, the axes on or off, the size of a cell. */
	grid?: boolean;
	showAxes?: boolean;
	cell?: number;
	/** For a coordinate plane: the numbers 1 2 3, the multiples of π, or none (R-084). */
	numbering?: "numbers" | "pi" | "none";
	/** For a coordinate plane (R-092): the whole list of its function graphs, replacing the old one. */
	fns?: PlaneFn[];
}

const isShape = (el: Stroke) =>
	el.kind === "rect" ||
	el.kind === "circle" ||
	el.kind === "ellipse" ||
	isPolygonKind(el.kind);
/** A freehand stroke: no kind, or the explicit stroke kind. */
export const isFreehand = (el: Stroke) => !el.kind || el.kind === "stroke";
const isDashable = (el: Stroke) =>
	el.kind === "line" || (isShape(el) && el.kind !== "plane");

/** Lines and shapes take solid, dashed and dotted; freehand strokes all four (R-037). */
function dashFits(el: Stroke, dash: Dash): boolean {
	if (isDashable(el)) return dash !== "natural";
	return isFreehand(el);
}

/** The styles the line style row offers for a selection, solid first. */
export function dashOptions(els: Stroke[]): Dash[] {
	const options: Dash[] = ["solid"];
	if (els.some((e) => isDashable(e) || isFreehand(e)))
		options.push("dashed", "dotted");
	if (els.some(isFreehand)) options.push("natural");
	return options;
}

/** The element with the patch applied where it applies (see ADR 0008). */
export function applyStyle(el: Stroke, patch: StylePatch): Stroke {
	const out: Stroke = { ...el };
	if (patch.color !== undefined && el.kind !== "image") out.color = patch.color;
	if (patch.size !== undefined && el.kind !== "image") {
		// A line may be finer than a pixel; a text keeps whole sizes (its size makes the font).
		out.size =
			el.kind === "text"
				? clamp(patch.size, 1, 50)
				: clamp(patch.size, 0.25, 50);
		if (el.kind === "text") out.fontSize = fontSizeFor(out.size);
	}
	if (patch.fontSize !== undefined && el.kind === "text")
		out.fontSize = clamp(patch.fontSize, 4, 400);
	if (patch.font !== undefined && el.kind === "text") {
		// Inter is the default and is not stored.
		if (patch.font === "sans" || !FONT_KEYS.includes(patch.font))
			delete out.font;
		else out.font = patch.font;
	}
	if (patch.width !== undefined && el.kind === "text")
		out.width = Math.max(MIN_AREA_WIDTH, patch.width);
	if (patch.dash !== undefined && dashFits(el, patch.dash)) {
		if (patch.dash === "solid") delete out.dash;
		else out.dash = patch.dash;
	}
	if (patch.fill !== undefined && isShape(el) && hasInside(el.kind)) {
		if (patch.fill === null) delete out.fill;
		else out.fill = patch.fill;
	}
	if (el.kind === "plane") {
		// On is the usual state, so only "off" is stored (R-084).
		if (patch.grid !== undefined) {
			if (patch.grid) delete out.grid;
			else out.grid = false;
		}
		if (patch.showAxes !== undefined) {
			if (patch.showAxes) delete out.showAxes;
			else out.showAxes = false;
		}
		if (patch.cell !== undefined) out.cell = clamp(patch.cell, 10, 200);
		if (patch.fns !== undefined) {
			const fns = sanitizeFns(patch.fns);
			if (fns?.length === 0) delete out.fns;
			else if (fns) out.fns = fns;
		}
		if (patch.numbering !== undefined) {
			if (patch.numbering === "none") delete out.numbered;
			else out.numbered = true;
			if (patch.numbering === "pi") out.pi = true;
			else delete out.pi;
		}
	}
	if (
		patch.numbered !== undefined &&
		(el.kind === "axes" || el.kind === "plane")
	) {
		if (patch.numbered) out.numbered = true;
		else delete out.numbered;
	}
	if (patch.opacity !== undefined) {
		const o = clamp(patch.opacity, 0, 1);
		if (o >= 1) delete out.opacity;
		else out.opacity = o;
	}
	return out;
}

/** What the properties panel may offer for a selection. */
export function capabilities(els: Stroke[]) {
	return {
		color: els.some((e) => e.kind !== "image"),
		size: els.some((e) => e.kind !== "image"),
		dash: dashOptions(els).length > 1,
		fill: els.some((e) => isShape(e) && hasInside(e.kind)),
		text: els.some((e) => e.kind === "text"),
		/** A coordinate system is selected: its marks can be numbered. */
		numbers: els.some((e) => e.kind === "axes" || e.kind === "plane"),
		/** A coordinate plane is selected: its grid, axes and cell can be set (R-084). */
		plane: els.some((e) => e.kind === "plane"),
		/** Only texts are selected: the size slider is then a font size. */
		textOnly: els.length > 0 && els.every((e) => e.kind === "text"),
	};
}

/** The values the panel shows: those of the first selected element. */
export function styleOf(els: Stroke[]): {
	color: string;
	size: number;
	fontSize: number;
	font: FontKey;
	dash: Dash;
	fill: string | null;
	opacity: number;
	numbered: boolean;
} {
	const e = els[0];
	return {
		color: e.color,
		size: e.size,
		fontSize: e.kind === "text" ? fontSizeOf(e) : 0,
		font: fontKeyOf(e.font),
		dash: e.dash ?? "solid",
		fill: e.fill ?? null,
		opacity: e.opacity ?? 1,
		numbered: e.numbered === true,
	};
}

/** The settings of the first selected coordinate plane, with their usual values (R-084). */
export function planeOf(els: Stroke[]): {
	cell: number;
	grid: boolean;
	showAxes: boolean;
	numbering: "numbers" | "pi" | "none";
	fns: PlaneFn[];
} {
	const e = els.find((x) => x.kind === "plane");
	return {
		cell: e?.cell ?? 40,
		grid: e?.grid !== false,
		showAxes: e?.showAxes !== false,
		numbering: !e?.numbered ? "none" : e.pi ? "pi" : "numbers",
		fns: e?.fns ?? [],
	};
}
