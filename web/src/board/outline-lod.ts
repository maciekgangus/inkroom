import { getStroke } from "perfect-freehand";
import type { Stroke } from "./board";
import { decimate, lodTolerance } from "./lod";
import { strokeOptions } from "./stroke-style";

/** The thinnest a stroke can run, as a share of its nominal width (the pen thins with pressure and speed). */
const THIN_SHARE = 0.4;
/** How much of that width the outline may lose, so a thin ribbon never collapses into a line. */
const WIDTH_SHARE = 0.6;

/**
 * The outline of a filled stroke as plain numbers, x and y one after the other (R-100), thinned for
 * a view of the given tier. The thinning works on the finished outline, not on the samples: the
 * natural pen's width depends on the spacing of its samples, so fewer samples would draw a
 * different stroke. The most a vertex may move is the tier's tolerance (0.4 px on the screen at
 * the closest scale of the tier), but a fraction of the stroke's width at most.
 */
export function outlinePolygon(stroke: Stroke, tier: number): Float32Array {
	const options = strokeOptions(stroke);
	const outline = getStroke(stroke.points, options);
	if (outline.length < 2) return new Float32Array(0);
	const width = (options.size ?? stroke.size) * THIN_SHARE;
	const tolerance = Math.min(lodTolerance(tier), width * WIDTH_SHARE);
	const kept = decimate(outline, tolerance, 0);
	const out = new Float32Array(kept.length * 2);
	for (let i = 0; i < kept.length; i++) {
		out[2 * i] = kept[i][0];
		out[2 * i + 1] = kept[i][1];
	}
	return out;
}
