type Vec = [number, number];

/** Line angles snap to multiples of this (15 degrees) while Shift is held. */
const ANGLE_STEP = Math.PI / 12;

/**
 * The end point of a shape being dragged from `start`, with the drawing aids of R-024 applied
 * when Shift is held: a line snaps to 15 degree steps (length kept), a rectangle becomes a
 * square and an ellipse a circle (side = the larger of the two distances, direction kept).
 * Without Shift the end is returned as it is.
 */
export function constrainEnd(
	kind: "line" | "rect" | "ellipse",
	start: Vec,
	end: Vec,
	shift: boolean,
): Vec {
	if (!shift) return end;
	const dx = end[0] - start[0];
	const dy = end[1] - start[1];
	if (kind === "line") {
		const length = Math.hypot(dx, dy);
		if (length === 0) return end;
		const angle = Math.round(Math.atan2(dy, dx) / ANGLE_STEP) * ANGLE_STEP;
		return [
			start[0] + length * Math.cos(angle),
			start[1] + length * Math.sin(angle),
		];
	}
	const side = Math.max(Math.abs(dx), Math.abs(dy));
	return [
		start[0] + (dx < 0 ? -side : side),
		start[1] + (dy < 0 ? -side : side),
	];
}
