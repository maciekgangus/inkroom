/**
 * How much more than the screen the board layer is painted, on each side, as a share of the
 * window (R-074): the view can be moved well beyond the screen before the unpainted edge shows.
 */
export const OVERDRAW = 0.5;

/**
 * The most pixels the board layer may have (R-077). A tablet with a dense screen cannot hold a
 * big layer: the page is killed for lack of memory. This is a crash fix, not a speed setting.
 */
export const MAX_LAYER_PIXELS = 10_000_000;

/** A desktop with plenty of memory may hold a bigger layer, so its margin is not shrunk by a dense screen. */
export const MAX_LAYER_PIXELS_DESKTOP = 16_000_000;

/** The pixel cap for this device: touch devices keep the crash-fix cap whatever memory they report. */
export function layerCap(env: {
	touch: boolean;
	memoryGb: number | undefined;
}): number {
	if (env.touch || (env.memoryGb ?? 0) < 8) return MAX_LAYER_PIXELS;
	return MAX_LAYER_PIXELS_DESKTOP;
}

/** The cap for the device this page runs on. */
export function currentLayerCap(): number {
	return layerCap({
		touch:
			typeof matchMedia === "function" &&
			matchMedia("(pointer: coarse)").matches,
		memoryGb: (navigator as { deviceMemory?: number }).deviceMemory,
	});
}

/**
 * The overdraw in CSS px, left/right and top/bottom, for a window of w x h CSS px at pixel
 * ratio dpr: OVERDRAW of the window, shrunk (down to none) until the layer fits under `cap`.
 */
export function layerMargin(
	w: number,
	h: number,
	dpr: number,
	cap: number,
): { mx: number; my: number } {
	const fits = (f: number) =>
		w * (1 + 2 * f * OVERDRAW) * dpr * (h * (1 + 2 * f * OVERDRAW) * dpr) <=
		cap;
	let lo = 0;
	let hi = 1;
	if (fits(1)) lo = 1;
	else
		for (let i = 0; i < 12; i++) {
			const mid = (lo + hi) / 2;
			if (fits(mid)) lo = mid;
			else hi = mid;
		}
	return {
		mx: Math.floor(w * OVERDRAW * lo),
		my: Math.floor(h * OVERDRAW * lo),
	};
}
