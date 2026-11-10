import type { Stroke } from "./board";
import { isPolygonKind } from "./shapes";
import { elementCorners, geomBox, rotatePoint, worldBounds } from "./transform";

type Vec = [number, number];

/** Grab radius of a handle and how far the rotation handle floats above the frame, in screen pixels. */
export const HANDLE_PX = 12;
export const ROT_OFFSET_PX = 28;

/** The frame drawn around the selection: centre, size and rotation. */
export interface Frame {
	cx: number;
	cy: number;
	w: number;
	h: number;
	rot: number;
}

export type Corner = "nw" | "ne" | "se" | "sw";
export type Edge = "n" | "e" | "s" | "w";
export type Handle = Corner | Edge | "rot";

/**
 * Whether the selection frame is drawn as an outline box (R-034): images, shapes and several
 * elements get one, and so does a line (its end dots come in addition, R-041); a lone stroke or
 * text shows only its handles and glows, so no big
 * box covers what was selected. The handles work the same either way.
 */
export function showsBox(els: Stroke[]): boolean {
	if (els.length === 0) return false;
	if (els.length > 1) return true;
	const kind = els[0].kind;
	return (
		kind === "image" ||
		kind === "line" ||
		kind === "rect" ||
		kind === "circle" ||
		kind === "ellipse" ||
		isPolygonKind(kind)
	);
}

/**
 * The frame around the selected elements: a lone element gets its own (possibly rotated) box,
 * several get the upright box around all of them as they appear on the board.
 */
export function frameOf(els: Stroke[], groupRot = 0): Frame | null {
	if (els.length === 0) return null;
	if (els.length > 1 && groupRot !== 0) return turnedFrame(els, groupRot);
	if (els.length === 1) {
		const b = geomBox(els[0]);
		return {
			cx: (b.minX + b.maxX) / 2,
			cy: (b.minY + b.maxY) / 2,
			w: b.maxX - b.minX,
			h: b.maxY - b.minY,
			rot: els[0].rot ?? 0,
		};
	}
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const el of els) {
		const b = worldBounds(el);
		minX = Math.min(minX, b.minX);
		minY = Math.min(minY, b.minY);
		maxX = Math.max(maxX, b.maxX);
		maxY = Math.max(maxY, b.maxY);
	}
	return {
		cx: (minX + maxX) / 2,
		cy: (minY + maxY) / 2,
		w: maxX - minX,
		h: maxY - minY,
		rot: 0,
	};
}

/** Whether a board point lies inside the (possibly rotated) frame. */
export function pointInFrame(f: Frame, p: Vec): boolean {
	const [x, y] = rotatePoint(p, [f.cx, f.cy], -f.rot);
	return Math.abs(x - f.cx) <= f.w / 2 && Math.abs(y - f.cy) <= f.h / 2;
}

/**
 * The box around several elements measured in axes turned by `rot`, so a group that was turned
 * keeps the size of its frame and the frame turns with it, instead of growing to cover the
 * corners of the turned elements.
 */
function turnedFrame(els: Stroke[], rot: number): Frame {
	const origin: Vec = [0, 0];
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const el of els) {
		for (const corner of elementCorners(el)) {
			const [x, y] = rotatePoint(corner, origin, -rot);
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	}
	const [cx, cy] = rotatePoint(
		[(minX + maxX) / 2, (minY + maxY) / 2],
		origin,
		rot,
	);
	return { cx, cy, w: maxX - minX, h: maxY - minY, rot };
}

const at = (f: Frame, dx: number, dy: number): Vec =>
	rotatePoint([f.cx + dx, f.cy + dy], [f.cx, f.cy], f.rot);

/** The four corners on the board: nw, ne, se, sw. */
export function frameCorners(f: Frame): [Vec, Vec, Vec, Vec] {
	const hw = f.w / 2;
	const hh = f.h / 2;
	return [at(f, -hw, -hh), at(f, hw, -hh), at(f, hw, hh), at(f, -hw, hh)];
}

/** Where one corner of the frame is on the board. */
export function cornerPos(f: Frame, corner: Corner): Vec {
	return frameCorners(f)[{ nw: 0, ne: 1, se: 2, sw: 3 }[corner]];
}

/** The middle of a side of the frame (R-041): n is the top one before any rotation. */
export function edgePos(f: Frame, edge: Edge): Vec {
	const hw = f.w / 2;
	const hh = f.h / 2;
	return {
		n: at(f, 0, -hh),
		e: at(f, hw, 0),
		s: at(f, 0, hh),
		w: at(f, -hw, 0),
	}[edge];
}
export function oppositeEdge(e: Edge): Edge {
	return { n: "s", e: "w", s: "n", w: "e" }[e] as Edge;
}
/** Whether a handle is the middle of a side rather than a corner or the rotation handle. */
export const isEdge = (h: Handle): h is Edge =>
	h === "n" || h === "e" || h === "s" || h === "w";
/** Where a corner or side handle is, and the point opposite it that stays put when it is dragged. */
export function handlePos(f: Frame, h: Corner | Edge): Vec {
	return isEdge(h) ? edgePos(f, h) : cornerPos(f, h);
}
export function oppositeHandle(h: Corner | Edge): Corner | Edge {
	return isEdge(h) ? oppositeEdge(h) : oppositeCorner(h);
}
export function oppositeCorner(c: Corner): Corner {
	return { nw: "se", ne: "sw", se: "nw", sw: "ne" }[c] as Corner;
}

/** The rotation handle: above the middle of the frame's top edge, `offset` board units away. */
export function rotationHandlePos(f: Frame, offset: number): Vec {
	return at(f, 0, -f.h / 2 - offset);
}

/** Which handle (the rotation one first, then the corners) is within `radius` of the point. */
export function hitFrameHandle(
	f: Frame,
	p: Vec,
	radius: number,
	rotOffset: number,
): Handle | null {
	const r = rotationHandlePos(f, rotOffset);
	if (Math.hypot(p[0] - r[0], p[1] - r[1]) <= radius) return "rot";
	const names: Corner[] = ["nw", "ne", "se", "sw"];
	const corners = frameCorners(f);
	for (const [i, name] of names.entries()) {
		if (Math.hypot(p[0] - corners[i][0], p[1] - corners[i][1]) <= radius)
			return name;
	}
	for (const edge of ["n", "e", "s", "w"] as Edge[]) {
		const e = edgePos(f, edge);
		if (Math.hypot(p[0] - e[0], p[1] - e[1]) <= radius) return edge;
	}
	return null;
}
