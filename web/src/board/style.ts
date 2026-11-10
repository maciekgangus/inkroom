import type { Stroke } from "./board";
import { fontSizeFor, fontSizeOf } from "./text";

export type Dash = "solid" | "dashed" | "dotted";

/** Changes to apply to elements; each only touches the kinds it makes sense for. */
export interface StylePatch {
	color?: string;
	/** Line width in px (1 to 50). */
	size?: number;
	/** Font size in px (4 to 400), for texts only. */
	fontSize?: number;
	dash?: Dash;
	/** A colour, or null to remove the fill. */
	fill?: string | null;
	opacity?: number;
}

const clamp = (n: number, min: number, max: number) =>
	Math.max(min, Math.min(max, n));

const isShape = (el: Stroke) =>
	el.kind === "rect" || el.kind === "circle" || el.kind === "ellipse";
const isDashable = (el: Stroke) => el.kind === "line" || isShape(el);

/** The element with the patch applied where it applies (see ADR 0008). */
export function applyStyle(el: Stroke, patch: StylePatch): Stroke {
	const out: Stroke = { ...el };
	if (patch.color !== undefined && el.kind !== "image") out.color = patch.color;
	if (patch.size !== undefined && el.kind !== "image") {
		out.size = clamp(patch.size, 1, 50);
		if (el.kind === "text") out.fontSize = fontSizeFor(out.size);
	}
	if (patch.fontSize !== undefined && el.kind === "text")
		out.fontSize = clamp(patch.fontSize, 4, 400);
	if (patch.dash !== undefined && isDashable(el)) {
		if (patch.dash === "solid") delete out.dash;
		else out.dash = patch.dash;
	}
	if (patch.fill !== undefined && isShape(el)) {
		if (patch.fill === null) delete out.fill;
		else out.fill = patch.fill;
	}
	if (patch.opacity !== undefined) {
		const o = Math.max(0, Math.min(1, patch.opacity));
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
		dash: els.some(isDashable),
		fill: els.some(isShape),
		text: els.some((e) => e.kind === "text"),
		/** Only texts are selected: the size slider is then a font size. */
		textOnly: els.length > 0 && els.every((e) => e.kind === "text"),
	};
}

/** The values the panel shows: those of the first selected element. */
export function styleOf(els: Stroke[]): {
	color: string;
	size: number;
	fontSize: number;
	dash: Dash;
	fill: string | null;
	opacity: number;
} {
	const e = els[0];
	return {
		color: e.color,
		size: e.size,
		fontSize: e.kind === "text" ? fontSizeOf(e) : 0,
		dash: e.dash ?? "solid",
		fill: e.fill ?? null,
		opacity: e.opacity ?? 1,
	};
}
