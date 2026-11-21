import { getStroke } from "perfect-freehand";
import { type Background, drawBackground } from "./background";
import type { Stroke } from "./board";
import { intersects, strokeBounds } from "./bounds";
import type { Renderer } from "./controller";
import { planeFrame, sampleFn } from "./functions";
import type { ImageCache } from "./image-cache";
import { imageRect } from "./image-geometry";
import type { LaserLine } from "./laser";
import { lodTier } from "./lod";
import { outlinePolygon } from "./outline-lod";
import { currentLayerCap, currentLayerMaxSide, layerMargin } from "./overdraw";
import { PathBudget } from "./path-budget";
import { pointCount } from "./points";
import { type Frame, HANDLE_PX, ROT_OFFSET_PX } from "./selection-frame";
import { LABEL_PX, PLANE_CELL, type PlaneLook, partsOf } from "./shape-parts";
import { isPolygonKind } from "./shapes";
import { strokeOptions } from "./stroke-style";
import { isFreehand } from "./style";
import { fontSizeOf, LINE_HEIGHT, textLines } from "./text";
import { TEXT_FONT_FAMILY, textFont } from "./text-wrap";
import { centerOf } from "./transform";
import type { Rect, Viewport } from "./viewport";

/** The selection glow (R-058), tuned by eye: a violet close to the nib of the logo. */
const GLOW_COLOR = "hsl(252, 100%, 60%)";
const GLOW_BLUR = 4;
const GLOW_PASSES = 2;
/** The marks of a coordinate system are this part of the width of its axes. */
const FINE_RATIO = 0.3;
/** The red of the laser pointer, and the width of its line on the screen. */
const LASER_COLOR = "#ff1744";
const LASER_WIDTH_PX = 4;
/**
 * A pan that has used this share of the margin paints the board layer again at once (R-074), so
 * the unpainted edge does not arrive before the hand stops; at most once per EDGE_REPAINT_MS.
 */
const EDGE_SHARE = 0.5;
const EDGE_REPAINT_MS = 100;
/** How long the view must stand still before the bitmaps are painted sharp again. */
const MOVE_SETTLE_MS = 120;
/** A layer painted for one scale may be stretched by the CSS this far (or squeezed this far) before it is painted again. */
const MAX_STRETCH = 2;

/** The longest the bitmaps are only moved, however long the view keeps moving. */
const MOVE_MAX_MS = 350;
/** The ink colour of the Inkroom brand, for the handles that edit the selection. */
const HANDLE_INK = "#5b5bf0";

/**
 * Freehand strokes are filled outlines (the pen's width follows the hand); a dashed or dotted one
 * is stroked along its path instead, as a line is. Shapes are stroked paths; text is drawn directly.
 */
const isFilled = (s: Stroke) =>
	isFreehand(s) && s.dash !== "dashed" && s.dash !== "dotted";

/** The path a freehand stroke runs along, smoothed through the midpoints of its samples. */
function centerline(s: Stroke): Path2D | null {
	const pts = s.points;
	if (pts.length === 0) return null;
	const path = new Path2D();
	path.moveTo(pts[0][0], pts[0][1]);
	if (pts.length === 1) {
		path.lineTo(pts[0][0], pts[0][1]); // a tap: a dot, with the round cap
		return path;
	}
	for (let i = 1; i < pts.length - 1; i++) {
		const mx = (pts[i][0] + pts[i + 1][0]) / 2;
		const my = (pts[i][1] + pts[i + 1][1]) / 2;
		path.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
	}
	const last = pts[pts.length - 1];
	path.lineTo(last[0], last[1]);
	return path;
}

function outlinePath(stroke: Stroke): Path2D | null {
	const outline = getStroke(stroke.points, strokeOptions(stroke));
	if (outline.length < 2) return null;
	const path = new Path2D();
	path.moveTo(outline[0][0], outline[0][1]);
	for (let i = 1; i < outline.length; i++)
		path.lineTo(outline[i][0], outline[i][1]);
	path.closePath();
	return path;
}

/** Adds a polyline to a path; it is closed when its last point is its first. */
function addPolyline(path: Path2D, pts: [number, number][]): void {
	if (pts.length < 2) return;
	path.moveTo(pts[0][0], pts[0][1]);
	for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
	const [a, b] = [pts[0], pts[pts.length - 1]];
	if (pts.length > 2 && a[0] === b[0] && a[1] === b[1]) path.closePath();
}

/**
 * What a shape made of lines needs besides its path: the contour to fill and the hidden edges
 * of a solid (drawn dotted), computed once per element.
 */
interface Extras {
	fill: Path2D | null;
	hidden: Path2D | null;
	/** The marks of a coordinate system, drawn thin. */
	fine: Path2D | null;
	/** The cells of a coordinate plane: very light, and every second line with the frame (R-084). */
	grid: Path2D | null;
	cluster: Path2D | null;
	/** A coordinate plane's sheet (rounded), its filled arrow heads and the rest of its look. */
	paper: Path2D | null;
	heads: Path2D | null;
	plane: PlaneLook | null;
	/** The function graphs of a coordinate plane, each as one path with its look (R-092). */
	curves: { path: Path2D; color: string; w: number }[];
	labels: { text: string; x: number; y: number }[];
}
const extras = new WeakMap<Stroke, Extras>();

/**
 * The function graphs of a plane (R-092) as paths in board units. They are made once per version
 * of the element (the cache is per element), so repainting while the view moves or zooms costs
 * nothing more; the sheet clips them when they are drawn.
 */
function curvesOf(s: Stroke, look: PlaneLook): Extras["curves"] {
	if (!s.fns?.length) return [];
	const cell = s.cell ?? PLANE_CELL;
	const frame = planeFrame(look, cell);
	return s.fns.map((f) => {
		const path = new Path2D();
		for (const line of sampleFn(f, frame)) addPolyline(path, line);
		return { path, color: f.color, w: f.w };
	});
}
function extraPaths(s: Stroke): Extras | null {
	if (!isPolygonKind(s.kind)) return null;
	let e = extras.get(s);
	if (!e) {
		const parts = partsOf(s);
		const lined = (lines: [number, number][][] | undefined): Path2D | null => {
			if (!lines?.length) return null;
			const p = new Path2D();
			for (const line of lines) addPolyline(p, line);
			return p;
		};
		let fill: Path2D | null = null;
		if (parts && parts.fill.length >= 3) {
			fill = new Path2D();
			addPolyline(fill, [...parts.fill, parts.fill[0]]);
		}
		const look = parts?.plane ?? null;
		let paper: Path2D | null = null;
		if (look) {
			paper = new Path2D();
			if (typeof paper.roundRect === "function")
				paper.roundRect(look.x0, look.y0, look.w, look.h, look.r);
			else paper.rect(look.x0, look.y0, look.w, look.h);
		}
		e = {
			fill,
			hidden: lined(parts?.hidden),
			fine: lined(parts?.fine),
			grid: lined(parts?.grid),
			cluster: lined(parts?.cluster),
			paper,
			heads: lined(look?.heads),
			plane: look,
			curves: look ? curvesOf(s, look) : [],
			labels: parts?.labels ?? [],
		};
		extras.set(s, e);
	}
	return e;
}

/** The path of a line, rectangle or circle; null for anything else. */
function shapePath(s: Stroke): Path2D | null {
	if (isFreehand(s)) return centerline(s);
	const [a, b] = s.points;
	if (!b) return null;
	const path = new Path2D();
	if (s.kind === "line") {
		path.moveTo(a[0], a[1]);
		path.lineTo(b[0], b[1]);
	} else if (s.kind === "rect") {
		path.rect(
			Math.min(a[0], b[0]),
			Math.min(a[1], b[1]),
			Math.abs(b[0] - a[0]),
			Math.abs(b[1] - a[1]),
		);
	} else if (isPolygonKind(s.kind)) {
		const parts = partsOf(s);
		if (!parts) return null;
		for (const line of parts.lines) addPolyline(path, line);
	} else if (s.kind === "ellipse") {
		path.ellipse(
			(a[0] + b[0]) / 2,
			(a[1] + b[1]) / 2,
			Math.abs(b[0] - a[0]) / 2,
			Math.abs(b[1] - a[1]) / 2,
			0,
			0,
			Math.PI * 2,
		);
	} else if (s.kind === "circle") {
		path.arc(a[0], a[1], Math.hypot(b[0] - a[0], b[1] - a[1]), 0, Math.PI * 2);
	} else {
		return null;
	}
	return path;
}

function elementPath(s: Stroke): Path2D | null {
	return isFilled(s) ? outlinePath(s) : shapePath(s);
}

/** What a cached path of a freehand stroke costs in native memory per sample (measured, R-100). */
const PATH_BYTES_PER_SAMPLE = 32;
/** From this tier on (a quarter of the scale and farther) a filled stroke is kept as a polygon. */
const POLY_TIER = 2;
/** The fixed cost of a polygon: the typed array and its entry in the cache. */
const POLY_OVERHEAD_BYTES = 160;

/** The most native memory the cached paths of freehand strokes may hold: less on a tablet. */
function defaultPathBudget(): number {
	const touch =
		typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
	return (touch ? 24 : 64) * 1024 * 1024;
}

/** Runs `draw` with the element's rotation and opacity applied (ADR 0008). */
function withLook(
	ctx: CanvasRenderingContext2D,
	s: Stroke,
	draw: () => void,
): void {
	if (!s.rot && s.opacity === undefined) {
		draw();
		return;
	}
	ctx.save();
	if (s.rot) {
		const [cx, cy] = centerOf(s);
		ctx.translate(cx, cy);
		ctx.rotate(s.rot);
		ctx.translate(-cx, -cy);
	}
	if (s.opacity !== undefined) ctx.globalAlpha = s.opacity;
	draw();
	ctx.restore();
}

/** Dash pattern for a line style; dots are tiny dashes with round caps. */
function dashPattern(s: Stroke): number[] {
	if (s.dash === "dashed") return [s.size * 3, s.size * 2];
	if (s.dash === "dotted") return [0.1, s.size * 2];
	return [];
}

/**
 * The colour an element is filled with: its own, or for a coordinate plane the white of a sheet of
 * paper, which dark mode shows as the dark of the board's own sheet (R-084).
 */
const fillOf = (
	s: Stroke,
	ink: (color: string) => string,
): string | undefined =>
	s.kind === "plane" ? ink("#ffffff") : s.fill ? ink(s.fill) : undefined;

/** The colours of a coordinate plane's sheet, for the light and the dark theme (R-084). */
const PLANE = {
	light: {
		paper: "#ffffff",
		minor: "#e4e9f2",
		major: "#c5d0e2",
		edge: "rgba(30, 40, 70, 0.22)",
		shadow: "rgba(20, 30, 60, 0.09)",
		text: "#5b6378",
	},
	dark: {
		paper: "#1c1e26",
		minor: "#262935",
		major: "#343949",
		edge: "rgba(255, 255, 255, 0.13)",
		shadow: "rgba(0, 0, 0, 0.45)",
		text: "#9aa1b6",
	},
};

/**
 * A coordinate plane as an opaque sheet of graph paper laid on the board (R-084): rounded, with a
 * hairline edge and a hard shadow, light grid lines of a colour no pen uses so handwriting always
 * wins, axes in the ink colour with filled heads, small numbers on a halo of paper colour, and an
 * x and a y at the tips. It runs inside `withLook`, so rotation and opacity are already applied.
 */
function drawPlane(
	ctx: CanvasRenderingContext2D,
	s: Stroke,
	e: Extras,
	axes: Path2D,
	color: string,
	fill: string | undefined,
	minWidth: number,
): void {
	const p = e.plane;
	const paper = e.paper;
	if (!p || !paper) return;
	// A fill that is the dark ink means the dark theme (see `fillOf`).
	const L = fill?.toLowerCase() === "#111111" ? PLANE.dark : PLANE.light;
	const m = ctx.getTransform();
	const dev = Math.hypot(m.a, m.b) || 1; // device pixels per board unit, whatever the rotation
	const thin = (w: number) => Math.max(w, 1 / dev, minWidth * 0.5);
	ctx.setLineDash([]);
	// The shadow is one unblurred copy, a little lower on the screen whatever the rotation.
	const rot = s.rot ?? 0;
	ctx.save();
	ctx.translate(Math.sin(rot) * 2, Math.cos(rot) * 2);
	ctx.fillStyle = L.shadow;
	ctx.fill(paper);
	ctx.restore();
	ctx.fillStyle = L.paper;
	ctx.fill(paper);
	ctx.save();
	ctx.clip(paper);
	ctx.lineCap = "butt";
	if (e.grid && p.cell * dev >= 7) {
		ctx.strokeStyle = L.minor;
		ctx.lineWidth = thin(0.75);
		ctx.stroke(e.grid);
	}
	if (e.cluster) {
		ctx.strokeStyle = L.major;
		ctx.lineWidth = thin(1);
		ctx.stroke(e.cluster);
	}
	ctx.restore();
	ctx.strokeStyle = L.edge;
	ctx.lineWidth = thin(1);
	ctx.stroke(paper);
	const aw = Math.max(s.size, 1.5 / dev, minWidth);
	ctx.strokeStyle = color;
	ctx.fillStyle = color;
	ctx.lineCap = "butt";
	ctx.lineWidth = aw;
	ctx.stroke(axes);
	if (e.heads) ctx.fill(e.heads);
	if (e.fine) {
		ctx.lineWidth = Math.max(aw * 0.6, minWidth * 0.5);
		ctx.stroke(e.fine);
	}
	if (e.curves.length) {
		ctx.save();
		ctx.clip(paper);
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		for (const c of e.curves) {
			ctx.strokeStyle = c.color;
			ctx.lineWidth = Math.max(c.w, 1.5 / dev, minWidth);
			ctx.stroke(c.path);
		}
		ctx.restore();
	}
	if (!p.text.length || p.px * dev < 5) return;
	// Each number sits on a halo of paper colour, so the grid does not cut through it.
	ctx.lineJoin = "round";
	ctx.strokeStyle = L.paper;
	ctx.lineWidth = p.px * 0.32;
	let font = "";
	for (const letter of [false, true]) {
		ctx.fillStyle = letter ? color : L.text;
		for (const t of p.text) {
			if (!!t.letter !== letter) continue;
			const size = p.px * (t.scale ?? 1) * (letter ? 1.3 : 1);
			const f = `${letter ? "italic " : ""}500 ${size}px ${TEXT_FONT_FAMILY}`;
			if (f !== font) {
				ctx.font = f;
				font = f;
			}
			ctx.lineWidth = size * (letter ? 0.25 : 0.32);
			ctx.textAlign = t.align;
			ctx.textBaseline = t.base;
			ctx.strokeText(t.t, t.x, t.y);
			ctx.fillText(t.t, t.x, t.y);
		}
	}
	ctx.textAlign = "start";
	ctx.textBaseline = "alphabetic";
}

/** Draws one element in `color` (and `fill`, for shapes); `path` is its (cached) path, unused for text. */
function drawElement(
	ctx: CanvasRenderingContext2D,
	s: Stroke,
	path: Path2D | null,
	color: string,
	fill?: string,
	minWidth = 0,
): void {
	withLook(ctx, s, () => {
		if (s.kind === "text") {
			const fs = fontSizeOf(s);
			ctx.fillStyle = color;
			ctx.font = textFont(fs);
			const [x, y] = s.points[0];
			const lineHeight = fs * LINE_HEIGHT;
			// Where a text field puts the first line (R-081): the line is centred on its content
			// area, the font's own ascent and descent. The baseline is placed from those, not with
			// textBaseline "top", which browsers (Safari on an iPad) put at different heights.
			const m = ctx.measureText("Mg");
			const ascent = m.fontBoundingBoxAscent;
			const descent = m.fontBoundingBoxDescent;
			let first: number;
			if (typeof ascent === "number" && typeof descent === "number") {
				ctx.textBaseline = "alphabetic";
				first = (lineHeight - (ascent + descent)) / 2 + ascent;
			} else {
				ctx.textBaseline = "top";
				first = (lineHeight - fs) / 2;
			}
			// A text area is wrapped to its width (R-044), a text at a point keeps its own lines.
			textLines(s).forEach((line, i) => {
				ctx.fillText(line, x, y + i * lineHeight + first);
			});
		} else if (path && isFilled(s)) {
			ctx.fillStyle = color;
			ctx.fill(path);
		} else if (path) {
			const extra = extraPaths(s);
			if (extra?.plane && extra.paper) {
				drawPlane(ctx, s, extra, path, color, fill, minWidth);
				return;
			}
			if (fill) {
				ctx.fillStyle = fill;
				// A solid is filled inside its silhouette only, not inside its inner edges.
				ctx.fill(extra?.fill ?? path);
			}
			ctx.strokeStyle = color;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			ctx.lineWidth = Math.max(s.size, minWidth);
			ctx.setLineDash(dashPattern(s));
			ctx.stroke(path);
			if (extra?.hidden) {
				// The edges behind a solid: dotted, whatever the line style.
				ctx.setLineDash([0.1, s.size * 2.2]);
				ctx.stroke(extra.hidden);
			}
			ctx.setLineDash([]);
			if (extra?.fine) {
				// The marks of the units: much thinner than the axes themselves.
				ctx.lineWidth = Math.max(s.size * FINE_RATIO, minWidth * 0.5);
				ctx.stroke(extra.fine);
			}
			if (extra?.labels.length) {
				ctx.fillStyle = color;
				ctx.font = textFont(LABEL_PX);
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				for (const l of extra.labels) ctx.fillText(l.text, l.x, l.y);
				ctx.textAlign = "start";
			}
		}
	});
}

interface Cached {
	/** Computed on first use, only for strokes that are actually in view. */
	path?: Path2D | null;
	/**
	 * Seen from far away a filled stroke keeps no path object (each costs a few KB of native memory
	 * whatever its size, R-100) but its thinned outline as plain numbers, x and y one after the other.
	 */
	poly?: Float32Array;
	/** The level of detail `poly` was thinned for (see `lodTier`); a `path` is always complete. */
	tier?: number;
	/** The estimated bytes of `path` or `poly`, counted by the budget (freehand strokes only). */
	cost: number;
	/** The frame that last painted it. */
	used: number;
	bounds: Rect;
}

/**
 * Paints the elements that touch `view` onto a context whose transform is already set (used for
 * exports and previews): the same drawing as the screen, in the stored (light) colours.
 */
export function paintElements(
	ctx: CanvasRenderingContext2D,
	strokes: Stroke[],
	view: Rect,
	images: ImageCache | null,
	placeholders = false,
	look: {
		/** Paints a stored colour (dark mode swaps black and white). */
		ink?: (color: string) => string;
		/** The thinnest line, in board units, so a small map still shows every line. */
		minWidth?: number;
	} = {},
): void {
	const ink = look.ink ?? ((c: string) => c);
	for (const s of strokes) {
		if (!intersects(strokeBounds(s), view)) continue;
		if (s.kind === "image") {
			const r = imageRect(s);
			const img = s.src ? images?.get(s.src) : null;
			if (!img && placeholders) {
				// A preview shows where a photo is without fetching it.
				withLook(ctx, s, () => {
					ctx.fillStyle = "#eceff1";
					ctx.fillRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
				});
				continue;
			}
			if (!img) continue; // a picture that did not load is left out of the export
			withLook(ctx, s, () =>
				ctx.drawImage(
					img as unknown as CanvasImageSource,
					r.minX,
					r.minY,
					r.maxX - r.minX,
					r.maxY - r.minY,
				),
			);
			continue;
		}
		drawElement(
			ctx,
			s,
			elementPath(s),
			ink(s.color),
			fillOf(s, ink),
			look.minWidth,
		);
	}
}

/**
 * Renders strokes on two stacked canvases: committed strokes below, unfinished ones above.
 * Finished strokes are immutable, so their outline and bounds are computed once and reused
 * while panning and zooming; strokes outside the view are skipped.
 */
export class CanvasRenderer implements Renderer {
	private committed: CanvasRenderingContext2D | null;
	private live: CanvasRenderingContext2D | null;
	private local: Stroke | null = null;
	private remote: Stroke[] = [];
	private strokes: Stroke[] = [];
	private cache = new WeakMap<Stroke, Cached>();
	/** The paths of freehand strokes are kept within a budget of native memory (R-100). */
	private budget: PathBudget<Cached>;
	/** The number of the committed layer's latest paint, to tell what it drew from what it did not. */
	private frame = 0;
	private selection: Frame | null = null;
	private marquee: Rect | null = null;
	private lasso: [number, number][] | null = null;
	/** The overdraw the board layer was sized with at the last resize, in CSS px. */
	private margin = { mx: 0, my: 0 };
	private highlight: Stroke[] = [];
	private lasers: LaserLine[] = [];
	/** Elements being dragged: drawn on the live layer, left out of the committed one (performance). */
	private drag: {
		ids: Set<string>;
		elements: Stroke[];
		offset?: [number, number];
	} | null = null;
	/** Repaints asked for since the last frame; they are merged into one per frame. */
	private pending = { committed: false, live: false };
	private raf = 0;
	/** The ends of a selected line, drawn as dots to drag (R-041). */
	private endpoints: [number, number][] | null = null;
	/** The handle of a selected adjustable shape, drawn as a diamond (R-041). */
	private adjust: [number, number] | null = null;
	/** The corners of a selected figure, drawn as dots to drag (R-047). */
	private vertices: [number, number][] | null = null;
	/** Maps a stored ink colour to the colour painted (dark mode swaps black and white). */
	ink: (color: string) => string = (c) => c;
	/** Which grid to draw under the elements (R-027, R-032) and in which colour. */
	background: Background = "plain";
	gridColor = "#dcdee8";
	/** The colour of the cluster lines of the grid, stronger than the cells'. */
	gridClusterColor = "#b9bdd0";

	constructor(
		private committedCanvas: HTMLCanvasElement,
		private liveCanvas: HTMLCanvasElement,
		private viewport: Viewport,
		/** Source of the pictures for image elements; without it they show as placeholders. */
		private images: ImageCache | null = null,
		pathBudget: number = defaultPathBudget(),
	) {
		this.budget = new PathBudget<Cached>(pathBudget, (c) => {
			c.path = undefined;
			c.poly = undefined;
			c.tier = undefined;
			c.cost = 0;
		});
		this.committed = committedCanvas.getContext("2d");
		// Not desynchronized (the low-latency hint): the unfinished stroke is cleared and drawn whole
		// at every move, and a canvas shown without waiting for the compositor can be shown between
		// the two, so the stroke blinks. The stroke still appears at once, on the next frame.
		this.live = liveCanvas.getContext("2d");
		const at = { x: viewport.x, y: viewport.y, k: viewport.scale };
		this.shown = { committed: at, live: { ...at } };
	}

	/** Matches the canvas buffers to the window size and device pixel ratio. */
	resize(): void {
		const dpr = window.devicePixelRatio || 1;
		const { mx, my } = layerMargin(
			innerWidth,
			innerHeight,
			dpr,
			currentLayerCap(),
			currentLayerMaxSide(),
		);
		this.margin = { mx, my };
		this.committedCanvas.width = (innerWidth + 2 * mx) * dpr;
		this.committedCanvas.height = (innerHeight + 2 * my) * dpr;
		const css = this.committedCanvas.style;
		css.left = `${-mx}px`;
		css.top = `${-my}px`;
		css.width = `${innerWidth + 2 * mx}px`;
		css.height = `${innerHeight + 2 * my}px`;
		this.liveCanvas.width = innerWidth * dpr;
		this.liveCanvas.height = innerHeight * dpr;
		this.paint();
	}

	/** Sets our own unfinished stroke (null when finished). */
	drawLive(stroke: Stroke | null): void {
		this.local = stroke;
		// Once per frame: a pen can report several moves in one frame, and each paint builds the
		// outline of the whole stroke again.
		this.schedule(false, true);
	}

	/** Shows the selection frame, corner handles and rotation handle (null hides them). */
	setSelection(frame: Frame | null): void {
		this.selection = frame;
		this.schedule(false, true);
	}

	/** Shows a dot on every corner of a selected figure (null hides them). */
	setVertices(at: [number, number][] | null): void {
		this.vertices = at;
		this.schedule(false, true);
	}

	/** Shows the handle of a selected adjustable shape (null hides it). */
	setAdjust(at: [number, number] | null): void {
		this.adjust = at;
		this.schedule(false, true);
	}

	/** Shows dots at the ends of a selected line (null hides them). */
	setEndpoints(ends: [number, number][] | null): void {
		this.endpoints = ends;
		this.schedule(false, true);
	}

	/** Makes the selected elements glow like neon (an empty list clears it). */
	setHighlight(els: Stroke[]): void {
		this.highlight = els;
		this.schedule(false, true);
	}

	/** Shows the trails of the laser pointer, as they are now (an empty list clears them). */
	setLasers(lines: LaserLine[]): void {
		this.lasers = lines;
		this.schedule(false, true);
	}

	/** Shows the rubber band of a selection being dragged (null hides it). */
	setMarquee(rect: Rect | null): void {
		this.marquee = rect;
		this.schedule(false, true);
	}

	/** Shows the free-hand loop of a lasso selection being drawn (null hides it). */
	setLasso(path: [number, number][] | null): void {
		this.lasso = path;
		this.schedule(false, true);
	}

	/** Sets other people's unfinished strokes. */
	setRemoteLive(strokes: Stroke[]): void {
		this.remote = strokes;
		this.schedule(false, true);
	}

	/** The board's font has loaded: text sizes were measured without it, so measure them again. */
	fontsChanged(): void {
		this.cache = new WeakMap();
		this.budget.clear();
		this.schedule(true, true);
	}

	/** Repaints with what is already known (after the background or its colour changed). */
	refresh(): void {
		this.schedule(true, true);
	}

	/** Repaints everything from `strokes` with the current view (once per frame at most). */
	redraw(strokes: Stroke[]): void {
		this.strokes = strokes;
		this.schedule(true, true);
	}

	/**
	 * Draws elements being dragged on the live layer and leaves them out of the committed one,
	 * which is painted once when the drag begins instead of at every move. With an `offset` the
	 * elements are the originals, moved by it: their cached outlines are reused.
	 */
	setDrag(
		drag: {
			ids: string[];
			elements: Stroke[];
			offset?: [number, number];
		} | null,
	): void {
		const was = this.drag;
		this.drag = drag && {
			ids: new Set(drag.ids),
			elements: drag.elements,
			offset: drag.offset,
		};
		const same =
			was &&
			this.drag &&
			was.ids.size === this.drag.ids.size &&
			[...this.drag.ids].every((id) => was.ids.has(id));
		this.schedule(!same, true);
	}

	/** Asks for a repaint of the layers; all the asks of one frame are served together. */
	private schedule(committed: boolean, live: boolean): void {
		this.pending.committed ||= committed;
		this.pending.live ||= live;
		if (this.raf) return;
		if (typeof requestAnimationFrame !== "function") {
			this.flush();
			return;
		}
		this.raf = requestAnimationFrame(() => {
			this.raf = 0;
			this.flush();
		});
	}

	private flush(): void {
		const { committed, live } = this.pending;
		this.pending = { committed: false, live: false };
		if (committed) {
			this.paintCommitted();
			this.settled("committed");
		}
		if (live) {
			this.paintLive();
			this.settled("live");
		}
	}

	private paint(): void {
		this.paintCommitted();
		this.settled("committed");
		this.paintLive();
		this.settled("live");
	}

	/** The view each layer was last painted for: the layers are moved from there while it moves. */
	private shown = {
		committed: { x: 0, y: 0, k: 1 },
		live: { x: 0, y: 0, k: 1 },
	};
	private movingSince = 0;
	private settleTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Shows the view moved or zoomed without painting: the bitmaps of both layers are moved and
	 * scaled with CSS (the graphics card does it), which costs nothing however many elements
	 * there are. A sharp picture follows once the view stands still (or every MOVE_MAX_MS of a
	 * long move). Painting every element at every frame of a zoom made it crawl.
	 */
	moveView(): void {
		const v = this.viewport;
		if (!this.movingSince) this.movingSince = Date.now();
		for (const [name, canvas] of [
			["committed", this.committedCanvas],
			["live", this.liveCanvas],
		] as const) {
			const from = this.shown[name];
			// The screen's corner: the board layer starts beyond it (overdraw).
			const { mx, my } = name === "committed" ? this.margin : { mx: 0, my: 0 };
			canvas.style.transformOrigin = `${mx}px ${my}px`;
			canvas.style.transform = `translate(${(from.x - v.x) * v.scale}px, ${(from.y - v.y) * v.scale}px) scale(${v.scale / from.k})`;
		}
		// Stretched or squeezed too far, the bitmap costs the graphics card ever more memory (a page
		// killed on a tablet): paint it sharp now instead of when the hand stops (R-077).
		const stretch = v.scale / this.shown.committed.k;
		if (stretch > MAX_STRETCH || stretch < 1 / MAX_STRETCH)
			this.schedule(true, true);
		else if (this.usedMargin()) {
			this.lastEdgeRepaint = Date.now();
			this.schedule(true, false);
		}
		if (this.settleTimer) clearTimeout(this.settleTimer);
		const wait = Math.max(
			0,
			Math.min(MOVE_SETTLE_MS, this.movingSince + MOVE_MAX_MS - Date.now()),
		);
		this.settleTimer = setTimeout(() => {
			this.settleTimer = null;
			this.schedule(true, true);
		}, wait);
	}

	private lastEdgeRepaint = 0;

	/** True when the pan since the board layer was painted used up EDGE_SHARE of its margin (throttled). */
	private usedMargin(): boolean {
		if (Date.now() - this.lastEdgeRepaint < EDGE_REPAINT_MS) return false;
		const v = this.viewport;
		const from = this.shown.committed;
		const { mx, my } = this.margin;
		return (
			(mx > 0 && Math.abs(from.x - v.x) * v.scale > mx * EDGE_SHARE) ||
			(my > 0 && Math.abs(from.y - v.y) * v.scale > my * EDGE_SHARE)
		);
	}

	/** A layer was painted for the current view: its bitmap goes back to its place. */
	private settled(layer: "committed" | "live"): void {
		const v = this.viewport;
		this.shown[layer] = { x: v.x, y: v.y, k: v.scale };
		const canvas =
			layer === "committed" ? this.committedCanvas : this.liveCanvas;
		if (canvas.style.transform) canvas.style.transform = "";
		const other = this.shown[layer === "committed" ? "live" : "committed"];
		if (other.x === v.x && other.y === v.y && other.k === v.scale) {
			this.movingSince = 0;
			if (this.settleTimer) clearTimeout(this.settleTimer);
			this.settleTimer = null;
		}
	}

	/** Clears the canvas and applies the view transform. */
	private begin(ctx: CanvasRenderingContext2D, mx = 0, my = 0): void {
		const dpr = window.devicePixelRatio || 1;
		const { scale } = this.viewport;
		// The layer's corner is (mx, my) CSS px before the screen's: the view starts there.
		const x = this.viewport.x - mx / scale;
		const y = this.viewport.y - my / scale;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		ctx.setTransform(
			dpr * scale,
			0,
			0,
			dpr * scale,
			-x * scale * dpr,
			-y * scale * dpr,
		);
	}

	private paintCommitted(): void {
		const ctx = this.committed;
		if (!ctx) return;
		const { mx, my } = this.margin;
		this.begin(ctx, mx, my);
		const w = innerWidth + 2 * mx;
		const h = innerHeight + 2 * my;
		const { x, y, scale } = this.viewport;
		const from = { x: x - mx / scale, y: y - my / scale, scale } as Viewport;
		drawBackground(
			ctx,
			this.background,
			from,
			w,
			h,
			window.devicePixelRatio || 1,
			this.gridColor,
			this.gridClusterColor,
		);
		const view = {
			minX: from.x,
			minY: from.y,
			maxX: from.x + w / scale,
			maxY: from.y + h / scale,
		};
		this.frame++;
		for (const s of this.strokes) {
			if (this.drag?.ids.has(s.id)) continue; // drawn on the live layer while dragged
			this.drawStroke(ctx, s, view);
		}
		this.budget.sweep(this.frame);
	}

	/** Draws one element if it is in view, shifted by (dx, dy) when it is being moved. */
	private drawStroke(
		ctx: CanvasRenderingContext2D,
		s: Stroke,
		view: Rect,
		dx = 0,
		dy = 0,
	): void {
		let c = this.cache.get(s);
		if (!c) {
			c = { bounds: strokeBounds(s), cost: 0, used: 0 };
			this.cache.set(s, c);
		}
		const b = c.bounds;
		const seen =
			dx || dy
				? {
						minX: b.minX + dx,
						minY: b.minY + dy,
						maxX: b.maxX + dx,
						maxY: b.maxY + dy,
					}
				: b;
		if (!intersects(seen, view)) return;
		if (s.kind === "image") {
			this.drawImage(ctx, s);
			return;
		}
		if (this.ensurePath(s, c) === "poly") {
			this.drawPoly(ctx, s, c.poly, this.ink(s.color));
			return;
		}
		drawElement(
			ctx,
			s,
			c.path ?? null,
			this.ink(s.color),
			fillOf(s, (c) => this.ink(c)),
		);
	}

	/**
	 * Makes sure the element has what its view needs to be drawn, and says which it is. A freehand
	 * stroke seen from far away gets a thinned outline (R-100): from a quarter of the scale and
	 * farther a filled one as a polygon of plain numbers, nearer as a path object. A path serves
	 * every view, a polygon thinned for a farther view is built again when the view comes closer.
	 * What is cached counts in the budget, which drops the longest unused.
	 */
	private ensurePath(s: Stroke, c: Cached): "path" | "poly" {
		if (!isFreehand(s)) {
			if (c.path === undefined) c.path = elementPath(s);
			return "path";
		}
		const tier = lodTier(this.viewport.scale);
		// A path is exact, it serves every view; a polygon only the views as far as it was thinned for.
		if (c.path !== undefined || (c.poly && (c.tier ?? 0) <= tier)) {
			this.budget.touch(c, this.frame);
			return c.path !== undefined ? "path" : "poly";
		}
		const was = c.cost;
		let kind: "path" | "poly" = "path";
		if (isFilled(s) && tier >= POLY_TIER) {
			kind = "poly";
			c.path = undefined;
			c.poly = outlinePolygon(s, tier);
			c.cost = POLY_OVERHEAD_BYTES + c.poly.byteLength;
		} else {
			c.poly = undefined;
			c.path = elementPath(s);
			c.cost = c.path ? pointCount(s) * PATH_BYTES_PER_SAMPLE : 0;
		}
		c.tier = tier;
		if (was) this.budget.replace(c, was, this.frame);
		else this.budget.add(c, this.frame);
		return kind;
	}

	/** Fills a thinned outline kept as numbers: no path object outlives the frame. */
	private drawPoly(
		ctx: CanvasRenderingContext2D,
		s: Stroke,
		p: Float32Array | undefined,
		color: string,
	): void {
		if (!p || p.length < 6) return;
		withLook(ctx, s, () => {
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.moveTo(p[0], p[1]);
			for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
			ctx.closePath();
			ctx.fill();
		});
	}

	/** Draws a photo, or a grey placeholder while it loads (or if it failed). */
	private drawImage(ctx: CanvasRenderingContext2D, s: Stroke): void {
		const r = imageRect(s);
		const img = s.src ? this.images?.get(s.src) : null;
		withLook(ctx, s, () => {
			if (img) {
				ctx.drawImage(
					img as unknown as CanvasImageSource,
					r.minX,
					r.minY,
					r.maxX - r.minX,
					r.maxY - r.minY,
				);
				return;
			}
			ctx.fillStyle = "#eceff1";
			ctx.fillRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
			ctx.strokeStyle = "#b0bec5";
			ctx.lineWidth = 1 / this.viewport.scale;
			ctx.strokeRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
		});
	}

	/**
	 * The handles that edit the selection: squares a little off the object (no outline
	 * box), at the corners and the middles of the sides, and one above for turning. A constant size
	 * on screen whatever the zoom.
	 */
	private drawFrame(ctx: CanvasRenderingContext2D, f: Frame): void {
		const px = 1 / this.viewport.scale;
		ctx.save();
		ctx.translate(f.cx, f.cy);
		ctx.rotate(f.rot);
		ctx.lineWidth = 2 * px;
		ctx.strokeStyle = "#fff";
		const stem = ROT_OFFSET_PX * px;
		const half = (HANDLE_PX / 2) * px;
		// The handles that scale: white rounded squares with an ink-coloured edge, at the corners
		// and the middles of the sides.
		ctx.fillStyle = "#fff";
		ctx.strokeStyle = HANDLE_INK;
		ctx.lineWidth = 2 * px;
		for (const [x, y] of [
			[-f.w / 2, -f.h / 2],
			[f.w / 2, -f.h / 2],
			[f.w / 2, f.h / 2],
			[-f.w / 2, f.h / 2],
			[0, -f.h / 2],
			[f.w / 2, 0],
			[0, f.h / 2],
			[-f.w / 2, 0],
		]) {
			ctx.beginPath();
			ctx.roundRect(x - half, y - half, 2 * half, 2 * half, 3 * px);
			ctx.fill();
			ctx.stroke();
		}
		// The handle that turns is a dot filled with the ink colour, apart from the others.
		ctx.fillStyle = HANDLE_INK;
		ctx.strokeStyle = "#fff";
		ctx.lineWidth = 2 * px;
		ctx.beginPath();
		ctx.arc(0, -f.h / 2 - stem, half, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.restore();
	}

	/** A neon glow along the element itself: its shape drawn with a bright, blurred shadow. */
	private drawGlow(ctx: CanvasRenderingContext2D, s: Stroke): void {
		const dpr = window.devicePixelRatio || 1;
		const path = elementPath(s);
		const color = s.kind === "image" ? "#fff" : this.ink(s.color);
		ctx.save();
		ctx.shadowColor = GLOW_COLOR;
		// The blur is in device pixels whatever the zoom; one small pass (R-058).
		ctx.shadowBlur = GLOW_BLUR * dpr;
		for (let i = 0; i < GLOW_PASSES; i++) {
			if (s.kind === "image") {
				const r = imageRect(s);
				withLook(ctx, s, () =>
					ctx.strokeRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY),
				);
			} else if (s.kind === "plane") {
				// A sheet like a picture: only its edge glows, not the grid and the axes (R-084).
				const paper = extraPaths(s)?.paper;
				if (paper)
					withLook(ctx, s, () => {
						ctx.strokeStyle = "#fff";
						ctx.lineWidth = 2 / this.viewport.scale;
						ctx.stroke(paper);
					});
			} else {
				drawElement(
					ctx,
					s,
					path,
					color,
					fillOf(s, (c) => this.ink(c)),
				);
			}
		}
		ctx.restore();
	}

	/** A yellow diamond on the vertex a shape's parameter moves: drag it to change the shape. */
	private drawAdjust(
		ctx: CanvasRenderingContext2D,
		[x, y]: [number, number],
	): void {
		const px = 1 / this.viewport.scale;
		const r = (HANDLE_PX / 2 + 1) * px;
		ctx.save();
		ctx.lineWidth = 2 * px;
		ctx.strokeStyle = "#fff";
		ctx.fillStyle = "#ffb300";
		ctx.beginPath();
		ctx.moveTo(x, y - r);
		ctx.lineTo(x + r, y);
		ctx.lineTo(x, y + r);
		ctx.lineTo(x - r, y);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.restore();
	}

	/** Dots at the two ends of a line, a constant size on screen: grab one to lengthen or shorten it. */
	private drawEndpoints(
		ctx: CanvasRenderingContext2D,
		ends: [number, number][],
	): void {
		const px = 1 / this.viewport.scale;
		ctx.save();
		ctx.lineWidth = 2 * px;
		ctx.strokeStyle = "#fff";
		ctx.fillStyle = HANDLE_INK;
		for (const [x, y] of ends) {
			ctx.beginPath();
			ctx.arc(x, y, (HANDLE_PX / 2) * px, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		}
		ctx.restore();
	}

	private drawMarquee(ctx: CanvasRenderingContext2D, r: Rect): void {
		ctx.fillStyle = "rgba(25, 118, 210, 0.12)";
		ctx.fillRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
		ctx.strokeStyle = "#1976d2";
		ctx.lineWidth = 1 / this.viewport.scale;
		ctx.strokeRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
	}

	private drawLasso(
		ctx: CanvasRenderingContext2D,
		path: [number, number][],
	): void {
		ctx.beginPath();
		for (const [i, [x, y]] of path.entries()) {
			if (i) ctx.lineTo(x, y);
			else ctx.moveTo(x, y);
		}
		ctx.closePath(); // the closing line is the one the selection will follow
		ctx.fillStyle = "rgba(25, 118, 210, 0.12)";
		ctx.fill();
		ctx.strokeStyle = "#1976d2";
		ctx.lineWidth = 1 / this.viewport.scale;
		ctx.stroke();
	}

	private paintLive(): void {
		const ctx = this.live;
		if (!ctx) return;
		this.begin(ctx);
		// Unfinished elements keep changing, so their paths are not cached.
		for (const s of [...this.remote, ...(this.local ? [this.local] : [])]) {
			drawElement(
				ctx,
				s,
				elementPath(s),
				this.ink(s.color),
				fillOf(s, (c) => this.ink(c)),
			);
		}
		if (this.drag) {
			const view = this.viewport.worldRect(innerWidth, innerHeight);
			const [dx, dy] = this.drag.offset ?? [0, 0];
			ctx.save();
			ctx.translate(dx, dy);
			for (const s of this.drag.elements) this.drawStroke(ctx, s, view, dx, dy);
			ctx.restore();
		}
		// A glow is a blurred shadow, which is costly while dragging: not then. The bottleneck of a
		// big selection is the network, not the drawing, so every selected element glows.
		if (!this.drag) for (const s of this.highlight) this.drawGlow(ctx, s);
		if (this.endpoints) this.drawEndpoints(ctx, this.endpoints);
		if (this.vertices) this.drawEndpoints(ctx, this.vertices);
		if (this.adjust) this.drawAdjust(ctx, this.adjust);
		if (this.selection) this.drawFrame(ctx, this.selection);
		if (this.marquee) this.drawMarquee(ctx, this.marquee);
		if (this.lasso) this.drawLasso(ctx, this.lasso);
		this.drawLasers(ctx);
	}

	/**
	 * The trails of the red laser pointer (R-076): a comet. The tail narrows and fades away from
	 * the head, with a soft red halo under a brighter core; the head is a glowing dot with a
	 * white-hot centre.
	 */
	private drawLasers(ctx: CanvasRenderingContext2D): void {
		if (this.lasers.length === 0) return;
		const px = 1 / this.viewport.scale;
		const w = LASER_WIDTH_PX * px;
		ctx.save();
		ctx.strokeStyle = LASER_COLOR;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		for (const line of this.lasers) {
			const pts = line.points;
			for (let i = 1; i < pts.length; i++) {
				const a = pts[i].alpha;
				ctx.beginPath();
				ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
				ctx.lineTo(pts[i].x, pts[i].y);
				// The halo: wide and faint; the core: narrower, and thinner towards the tail.
				ctx.globalAlpha = a * 0.22;
				ctx.lineWidth = w * (1.2 + 2.6 * a);
				ctx.stroke();
				ctx.globalAlpha = Math.min(1, a * 1.2);
				ctx.lineWidth = w * (0.35 + 0.65 * a);
				ctx.stroke();
			}
			const head = pts[pts.length - 1];
			const r = w * 3.2;
			const glow = ctx.createRadialGradient(
				head.x,
				head.y,
				0,
				head.x,
				head.y,
				r,
			);
			glow.addColorStop(0, "rgba(255, 245, 240, 1)");
			glow.addColorStop(0.25, LASER_COLOR);
			glow.addColorStop(1, "rgba(255, 0, 0, 0)");
			ctx.globalAlpha = head.alpha;
			ctx.fillStyle = glow;
			ctx.beginPath();
			ctx.arc(head.x, head.y, r, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.restore();
	}
}
