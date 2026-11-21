import type { StrokeOptions } from "perfect-freehand";
import type { Point, Stroke } from "./board";

/** True when every point has the same pressure, as with a mouse or a finger (no stylus). */
const uniformPressure = (pts: Point[]): boolean =>
	pts.every((p) => Math.abs(p[2] - pts[0][2]) < 0.01);

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
	// A short stroke has little room for the tapers, which would eat it whole (a tap left no
	// mark): they shrink with its length, none for a dot (R-075).
	const pts = s.points;
	const length = pts.reduce(
		(sum, p, i) =>
			i ? sum + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0,
		0,
	);
	const tapered = length >= size * 3; // a tap or a tiny dash stays a plain dot
	return {
		size,
		thinning: 0.5,
		smoothing: 0.7,
		streamline: 0.65,
		simulatePressure: uniformPressure(pts),
		start: {
			taper: tapered ? Math.min(size * 2.5, length * 0.4) : 0,
			cap: true,
		},
		end: { taper: tapered ? Math.min(size * 4, length * 0.6) : 0, cap: true },
	};
}
