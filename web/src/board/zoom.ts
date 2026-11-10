/** One notch of a mouse wheel in pixels (browsers report 100), and how many lines a notch is. */
const NOTCH_PX = 100;
const LINES_PER_NOTCH = 3;
/** The zoom step of one notch: about ten percent. */
const NOTCH_STEP = 0.1;

/**
 * The factor to zoom by for one wheel event. A notch of a mouse wheel is a gentle step of
 * about ten percent instead of the leap a straight exponential gave; the small, frequent
 * deltas of a trackpad pinch stay fine-grained. One smooth curve covers both, so there is no
 * threshold at which the feel changes. `deltaMode` 1 counts lines (Firefox).
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
	const px = deltaMode === 1 ? (deltaY * NOTCH_PX) / LINES_PER_NOTCH : deltaY;
	const step = NOTCH_STEP * Math.tanh(Math.abs(px) / 10);
	return Math.exp(-Math.sign(px) * step);
}

/** How long (ms) the zoom takes to cover most of the way to its target. */
const ZOOM_TAU_MS = 80;

/**
 * The scale after `dtMs` of easing from `current` towards `target`. It moves in the log scale,
 * so every percent is passed in turn and zooming in and out feel the same, it eases out, does
 * not depend on the frame rate, and lands exactly on the target once it is close.
 */
export function stepZoom(
	current: number,
	target: number,
	dtMs: number,
): number {
	if (current === target || dtMs <= 0) return current;
	const rest = Math.log(target / current);
	const next = rest * (1 - Math.exp(-dtMs / ZOOM_TAU_MS));
	return Math.abs(rest - next) < 0.002 ? target : current * Math.exp(next);
}
