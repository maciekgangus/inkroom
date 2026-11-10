import type { ElementKind } from "./board";

type Vec = [number, number];

/** The kinds of the shape category (R-033), in the order of the list in the toolbar. */
export type ShapeChoice =
	| "rect"
	| "ellipse"
	| "trapezoid"
	| "rhombus"
	| "parallelogram";

/** What the toolbar offers: the element kind, its Polish name and the icon to show. */
export const SHAPES: {
	kind: ShapeChoice;
	label: string;
	icon: "rect" | "circle" | "trapezoid" | "rhombus" | "parallelogram";
}[] = [
	{ kind: "rect", label: "Prostokąt", icon: "rect" },
	{ kind: "ellipse", label: "Okrąg i owal", icon: "circle" },
	{ kind: "trapezoid", label: "Trapez", icon: "trapezoid" },
	{ kind: "rhombus", label: "Romb", icon: "rhombus" },
	{ kind: "parallelogram", label: "Równoległobok", icon: "parallelogram" },
];

const POLYGONS: ElementKind[] = ["trapezoid", "rhombus", "parallelogram"];

/** Whether the element is drawn as a polygon computed from the box of its two corners. */
export const isPolygonKind = (kind: ElementKind | undefined): boolean =>
	kind !== undefined && POLYGONS.includes(kind);

/** How far a trapezoid's or parallelogram's slanted sides lean in, as a share of the width. */
const SLANT = 0.25;

/**
 * The corners of a polygon shape inside the box spanned by two opposite corners, clockwise from
 * the top left when dragged down and to the right. The direction of the drag orients it:
 * dragging upward turns a trapezoid upside down, dragging to the left mirrors a parallelogram
 * (a rhombus looks the same either way). The element stores only the two corners, in drag order.
 */
export function polygonPoints(kind: ElementKind, a: Vec, b: Vec): Vec[] {
	const minX = Math.min(a[0], b[0]);
	const maxX = Math.max(a[0], b[0]);
	const minY = Math.min(a[1], b[1]);
	const maxY = Math.max(a[1], b[1]);
	const w = maxX - minX;
	const midX = (minX + maxX) / 2;
	const midY = (minY + maxY) / 2;
	let points: Vec[];
	switch (kind) {
		case "rhombus":
			points = [
				[midX, minY],
				[maxX, midY],
				[midX, maxY],
				[minX, midY],
			];
			break;
		case "trapezoid":
			points = [
				[minX + SLANT * w, minY],
				[maxX - SLANT * w, minY],
				[maxX, maxY],
				[minX, maxY],
			];
			break;
		case "parallelogram":
			points = [
				[minX + SLANT * w, minY],
				[maxX, minY],
				[maxX - SLANT * w, maxY],
				[minX, maxY],
			];
			break;
		default:
			points = [
				[minX, minY],
				[maxX, minY],
				[maxX, maxY],
				[minX, maxY],
			];
	}
	const flipX = b[0] < a[0];
	const flipY = b[1] < a[1];
	return points.map(([x, y]) => [
		flipX ? minX + maxX - x : x,
		flipY ? minY + maxY - y : y,
	]);
}

/** Whether (x, y) lies inside the polygon (even-odd rule). */
export function pointInPolygon(poly: Vec[], x: number, y: number): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, yi] = poly[i];
		const [xj, yj] = poly[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

const STORAGE_KEY = "inkroom.shape";

/** The shape chosen last on this device, the rectangle if none (a personal setting). */
export function loadShape(): ShapeChoice {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		return SHAPES.find((s) => s.kind === v)?.kind ?? "rect";
	} catch {
		return "rect";
	}
}

/** Remembers the chosen shape on this device; storage may be blocked, then it is skipped. */
export function saveShape(kind: ShapeChoice): void {
	try {
		localStorage.setItem(STORAGE_KEY, kind);
	} catch {
		// private window or blocked storage: the choice just is not remembered
	}
}
