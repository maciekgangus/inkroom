// The arithmetic of rendering a recording to video frames (R-115).

/** The recording time of frame `i`, in ms. */
export const frameTimeMs = (i: number, fps: number): number => (i * 1000) / fps;

/** How many frames cover `durationMs`; at least one. */
export const frameCount = (durationMs: number, fps: number): number =>
	Math.max(1, Math.ceil((durationMs * fps) / 1000));

/** A keyframe every two seconds: a player can start from it, and so can a seek. */
export const keyframeEvery = (fps: number): number => fps * 2;
