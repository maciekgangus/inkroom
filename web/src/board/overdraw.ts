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

/**
 * A phone, or an Android tablet that reports less than 8 GB: its layer stays small. A layer of
 * 10M pixels is 40 MB of canvas that the GPU takes up and re-uploads on every repaint, and its
 * side passes what a phone GPU takes as one texture (4096), so the page crashed and the phone
 * got warm. The margin of the layer is what shrinks, the screen itself is always painted.
 */
export const MAX_LAYER_PIXELS_SMALL = 6_000_000;
export const MAX_LAYER_SIDE_SMALL = 4096;

/** The memory a device reports, when it reports any (Safari, so an iPad, does not). */
interface Env {
	touch: boolean;
	memoryGb: number | undefined;
}

/** A touch device that says it has less than 8 GB (Chrome on Android does; an iPad does not). */
const isSmall = (env: Env) =>
	env.touch && env.memoryGb !== undefined && env.memoryGb < 8;

/** The pixel cap for this device: a small touch device is held to 6M, any other touch device keeps the crash-fix cap. */
export function layerCap(env: Env): number {
	if (isSmall(env)) return MAX_LAYER_PIXELS_SMALL;
	if (env.touch || (env.memoryGb ?? 0) < 8) return MAX_LAYER_PIXELS;
	return MAX_LAYER_PIXELS_DESKTOP;
}

/** The longest side of the layer in device pixels, none for a device that is not small. */
export function layerMaxSide(env: Env): number {
	return isSmall(env) ? MAX_LAYER_SIDE_SMALL : Number.POSITIVE_INFINITY;
}

const device = (): Env => ({
	touch:
		typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
	memoryGb: (navigator as { deviceMemory?: number }).deviceMemory,
});

/** The cap for the device this page runs on. */
export function currentLayerCap(): number {
	return layerCap(device());
}

/** The longest side of the layer for the device this page runs on. */
export function currentLayerMaxSide(): number {
	return layerMaxSide(device());
}

/**
 * The overdraw in CSS px, left/right and top/bottom, for a window of w x h CSS px at pixel
 * ratio dpr: OVERDRAW of the window, shrunk (down to none) until the layer fits under `cap` and
 * no side is longer than `maxSide` device pixels.
 */
export function layerMargin(
	w: number,
	h: number,
	dpr: number,
	cap: number,
	maxSide = Number.POSITIVE_INFINITY,
): { mx: number; my: number } {
	const fits = (f: number) =>
		w * (1 + 2 * f * OVERDRAW) * dpr * (h * (1 + 2 * f * OVERDRAW) * dpr) <=
			cap &&
		w * (1 + 2 * f * OVERDRAW) * dpr <= maxSide &&
		h * (1 + 2 * f * OVERDRAW) * dpr <= maxSide;
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
