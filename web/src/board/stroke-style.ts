import type { StrokeOptions } from "perfect-freehand";
import type { Stroke } from "./board";

/** True when every point has the same pressure, as with a mouse or a finger (no stylus). */
const uniformPressure = (s: Stroke): boolean =>
	s.points.every((p) => Math.abs(p[2] - s.points[0][2]) < 0.01);

/**
 * How a freehand stroke is turned into an outline (R-037). The ordinary pen is as it has always
 * been. The natural pen looks like writing with a real pen: the width follows the speed of the
 * hand (a mouse and a finger have no pressure, so it is simulated from the points) or the
 * pressure of a stylus, both ends taper off and the line is smoothed more. Only the stored
 * points matter, so every client draws the same outline.
 */
export function strokeOptions(s: Stroke): StrokeOptions {
	if (s.dash !== "natural") {
		return {
			size: s.size,
			thinning: 0.6,
			smoothing: 0.5,
			streamline: 0.4,
			simulatePressure: false,
		};
	}
	// Wider to begin with, because the width then falls with the speed of the hand.
	const size = s.size * 1.5;
	return {
		size,
		thinning: 0.5,
		smoothing: 0.7,
		streamline: 0.65,
		simulatePressure: uniformPressure(s),
		start: { taper: size * 2.5, cap: true },
		end: { taper: size * 4, cap: true },
	};
}
