import type { ElementKind } from "./board";

type Vec = [number, number];

/** Which shapes the shape tool can draw (R-033, R-039). */
export type ShapeChoice =
	| "rect"
	| "ellipse"
	| "trapezoid"
	| "rhombus"
	| "parallelogram"
	| "triangle"
	| "righttriangle"
	| "righttrapezoid"
	| "pentagon"
	| "hexagon"
	| "octagon"
	| "star"
	| "roundrect"
	| "semicircle"
	| "quadrant"
	| "cube"
	| "cuboid"
	| "cylinder"
	| "parallelepiped"
	| "pyramid"
	| "cone"
	| "sphere"
	| "tetrahedron"
	| "hexprism"
	| "octahedron"
	| "pyramidfrustum"
	| "conefrustum"
	| "sine"
	| "bell"
	| "scurve"
	| "parabola"
	| "axes";

/** One entry of the list: the element kind, its Polish name and, for the two with a fixed icon, that icon. */
export interface ShapeEntry {
	kind: ShapeChoice;
	label: string;
	icon?: "rect" | "circle";
}

/** The categories of the list, in the order of the toolbar (R-039). */
export const SHAPE_GROUPS: { title: string; shapes: ShapeEntry[] }[] = [
	{
		title: "Podstawowe wielokąty",
		shapes: [
			{ kind: "rect", label: "Prostokąt", icon: "rect" },
			{ kind: "triangle", label: "Trójkąt" },
			{ kind: "righttriangle", label: "Trójkąt prostokątny" },
			{ kind: "righttrapezoid", label: "Trapez prostokątny" },
			{ kind: "trapezoid", label: "Trapez" },
			{ kind: "parallelogram", label: "Równoległobok" },
			{ kind: "rhombus", label: "Romb" },
		],
	},
	{
		title: "Regularne wielokąty",
		shapes: [
			{ kind: "pentagon", label: "Pięciokąt" },
			{ kind: "hexagon", label: "Sześciokąt" },
			{ kind: "octagon", label: "Ośmiokąt" },
			{ kind: "star", label: "Gwiazda" },
		],
	},
	{
		title: "Zaokrąglone kształty",
		shapes: [
			{ kind: "ellipse", label: "Okrąg i owal", icon: "circle" },
			{ kind: "roundrect", label: "Prostokąt zaokrąglony" },
			{ kind: "semicircle", label: "Półokrąg" },
			{ kind: "quadrant", label: "Ćwiartka koła" },
		],
	},
	{
		title: "Bryły 3D",
		shapes: [
			{ kind: "cube", label: "Sześcian" },
			{ kind: "cuboid", label: "Prostopadłościan" },
			{ kind: "cylinder", label: "Walec" },
			{ kind: "parallelepiped", label: "Równoległościan" },
			{ kind: "pyramid", label: "Ostrosłup" },
			{ kind: "cone", label: "Stożek" },
			{ kind: "sphere", label: "Kula" },
			{ kind: "tetrahedron", label: "Czworościan" },
			{ kind: "hexprism", label: "Graniastosłup sześciokątny" },
			{ kind: "octahedron", label: "Ośmiościan" },
			{ kind: "pyramidfrustum", label: "Ostrosłup ścięty" },
			{ kind: "conefrustum", label: "Stożek ścięty" },
		],
	},
	{
		title: "Krzywe",
		shapes: [
			{ kind: "sine", label: "Sinusoida" },
			{ kind: "bell", label: "Krzywa dzwonowa" },
			{ kind: "scurve", label: "Krzywa S" },
			{ kind: "parabola", label: "Parabola" },
		],
	},
	{
		title: "Wykresy",
		shapes: [{ kind: "axes", label: "Układ współrzędnych" }],
	},
];

/** Every shape of the list, in order. */
export const SHAPES: ShapeEntry[] = SHAPE_GROUPS.flatMap((g) => g.shapes);

/**
 * The kinds drawn from the box of their two corners by `shapeParts` (everything of the list
 * except the rectangle and the ellipse, which have their own paths).
 */
const PARAMETRIC: ElementKind[] = SHAPES.map((s) => s.kind).filter(
	(k) => k !== "rect" && k !== "ellipse",
);

/** The kinds without an inside: curves and the coordinate system. */
const OPEN: ElementKind[] = ["sine", "bell", "scurve", "parabola", "axes"];

/** Whether a shape has an inside that can be filled and hit (false for curves and axes). */
export const hasInside = (kind: ElementKind | undefined): boolean =>
	kind === undefined || !OPEN.includes(kind);

/** Whether the element is drawn from parts computed from the box of its two corners. */
export const isPolygonKind = (kind: ElementKind | undefined): boolean =>
	kind !== undefined && PARAMETRIC.includes(kind);

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
