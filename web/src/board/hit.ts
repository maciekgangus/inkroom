import type { Stroke } from "./board";
import { partsOf } from "./shape-parts";
import { isPolygonKind, pointInPolygon } from "./shapes";
import { textBox } from "./text";
import { geomBox, toLocal } from "./transform";

function distToSegment(
	px: number,
	py: number,
	ax: number,
	ay: number,
	bx: number,
	by: number,
): number {
	const dx = bx - ax;
	const dy = by - ay;
	const len2 = dx * dx + dy * dy;
	const t =
		len2 === 0
			? 0
			: Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** True if the polyline through `pts` passes within `reach` of (x, y). */
function nearPolyline(
	pts: number[][],
	x: number,
	y: number,
	reach: number,
): boolean {
	if (pts.length === 1)
		return Math.hypot(x - pts[0][0], y - pts[0][1]) <= reach;
	for (let i = 1; i < pts.length; i++) {
		if (
			distToSegment(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <=
			reach
		)
			return true;
	}
	return false;
}

/** True if (x, y) is within `radius` of the element's outline (its half-width included). */
export function strokeHit(
	stroke: Stroke,
	x: number,
	y: number,
	radius: number,
): boolean {
	const [lx, ly] = toLocal(stroke, [x, y]);
	return hitLocal(stroke, lx, ly, radius);
}

/**
 * True if clicking (x, y) should select the element: like `strokeHit`, but a filled shape is
 * hit anywhere inside and an image anywhere inside too (the eraser never takes an image).
 */
export function objectHit(
	stroke: Stroke,
	x: number,
	y: number,
	radius: number,
): boolean {
	const [lx, ly] = toLocal(stroke, [x, y]);
	const reach = radius + stroke.size / 2;
	if (stroke.kind === "image" || (stroke.kind === "rect" && stroke.fill)) {
		const b = geomBox(stroke);
		const slack = stroke.kind === "image" ? radius : reach;
		if (
			lx >= b.minX - slack &&
			lx <= b.maxX + slack &&
			ly >= b.minY - slack &&
			ly <= b.maxY + slack
		)
			return true;
	}
	if (isPolygonKind(stroke.kind) && stroke.fill) {
		const fill = partsOf(stroke)?.fill ?? [];
		if (fill.length >= 3 && pointInPolygon(fill, lx, ly)) return true;
	}
	if (stroke.kind === "ellipse" && stroke.fill) {
		const { cx, cy, rx, ry } = ellipseOf(stroke);
		if (
			rx > 0 &&
			ry > 0 &&
			Math.hypot((lx - cx) / rx, (ly - cy) / ry) <= 1 + reach / Math.min(rx, ry)
		)
			return true;
	}
	if (stroke.kind === "circle" && stroke.fill) {
		const [c, edge] = stroke.points;
		const r = Math.hypot(edge[0] - c[0], edge[1] - c[1]);
		if (Math.hypot(lx - c[0], ly - c[1]) <= r + reach) return true;
	}
	return hitLocal(stroke, lx, ly, radius);
}

/** Centre and radii of an ellipse element (inscribed in the box of its two corners). */
function ellipseOf(el: Stroke): {
	cx: number;
	cy: number;
	rx: number;
	ry: number;
} {
	const [a, b] = el.points;
	return {
		cx: (a[0] + b[0]) / 2,
		cy: (a[1] + b[1]) / 2,
		rx: Math.abs(b[0] - a[0]) / 2,
		ry: Math.abs(b[1] - a[1]) / 2,
	};
}

/** The hit test in the element's own, unrotated frame. */
function hitLocal(
	stroke: Stroke,
	x: number,
	y: number,
	radius: number,
): boolean {
	const reach = radius + stroke.size / 2;
	const pts = stroke.points;
	if (isPolygonKind(stroke.kind)) {
		// A shape made of lines (R-039): near any of its lines, hidden edges included.
		const parts = partsOf(stroke);
		if (!parts) return false;
		return [...parts.lines, ...parts.hidden].some((line) =>
			nearPolyline(line, x, y, reach),
		);
	}
	switch (stroke.kind) {
		case "image":
			return false; // photos are removed by selecting them, never by erasing over them
		case "rect": {
			const [a, b] = pts;
			const corners = [
				[a[0], a[1]],
				[b[0], a[1]],
				[b[0], b[1]],
				[a[0], b[1]],
				[a[0], a[1]],
			];
			return nearPolyline(corners, x, y, reach);
		}
		case "ellipse": {
			// Distance from the outline, approximated by how far the normalised radius is from 1.
			const { cx, cy, rx, ry } = ellipseOf(stroke);
			if (rx === 0 || ry === 0) return false;
			const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
			return Math.abs(d - 1) * Math.min(rx, ry) <= reach;
		}
		case "circle": {
			const [c, edge] = pts;
			const r = Math.hypot(edge[0] - c[0], edge[1] - c[1]);
			return Math.abs(Math.hypot(x - c[0], y - c[1]) - r) <= reach;
		}
		case "text": {
			const box = textBox(stroke);
			return (
				x >= box.minX - radius &&
				x <= box.maxX + radius &&
				y >= box.minY - radius &&
				y <= box.maxY + radius
			);
		}
		default:
			return nearPolyline(pts, x, y, reach);
	}
}

/** Topmost (last drawn) stroke under the eraser, if any. */
export function findHit(
	strokes: Stroke[],
	x: number,
	y: number,
	radius: number,
): Stroke | undefined {
	for (let i = strokes.length - 1; i >= 0; i--) {
		if (strokeHit(strokes[i], x, y, radius)) return strokes[i];
	}
	return undefined;
}
