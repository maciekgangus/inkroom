import type { Stroke } from "./board";
import { fontSizeFor } from "./text";

export type Dash = "solid" | "dashed" | "dotted";

/** Changes to apply to elements; each only touches the kinds it makes sense for. */
export interface StylePatch {
	color?: string;
	size?: number;
	dash?: Dash;
	/** A colour, or null to remove the fill. */
	fill?: string | null;
	opacity?: number;
}

const isShape = (el: Stroke) => el.kind === "rect" || el.kind === "circle";
const isDashable = (el: Stroke) => el.kind === "line" || isShape(el);

/** The element with the patch applied where it applies (see ADR 0008). */
export function applyStyle(el: Stroke, patch: StylePatch): Stroke {
	const out: Stroke = { ...el };
	if (patch.color !== undefined && el.kind !== "image") out.color = patch.color;
	if (patch.size !== undefined && el.kind !== "image") {
		out.size = patch.size;
		if (el.kind === "text") out.fontSize = fontSizeFor(patch.size);
	}
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
	};
}

/** The values the panel shows: those of the first selected element. */
export function styleOf(els: Stroke[]): {
	color: string;
	size: number;
	dash: Dash;
	fill: string | null;
	opacity: number;
} {
	const e = els[0];
	return {
		color: e.color,
		size: e.size,
		dash: e.dash ?? "solid",
		fill: e.fill ?? null,
		opacity: e.opacity ?? 1,
	};
}
