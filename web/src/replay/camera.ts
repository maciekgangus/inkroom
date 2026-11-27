import { clampScale } from "../board/viewport";
import type { Camera } from "./engine";

/**
 * Where to put the player's view so the whole of what the teacher saw fits in the player's window
 * (a window of another shape shows more of the board on one side, never less than the teacher saw).
 */
export function fitCamera(
	cam: Camera,
	width: number,
	height: number,
): { x: number; y: number; scale: number } {
	const scale = clampScale(Math.min(width / cam.rw, height / cam.rh));
	return {
		scale,
		x: cam.cx - width / (2 * scale),
		y: cam.cy - height / (2 * scale),
	};
}
