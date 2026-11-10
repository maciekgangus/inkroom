import { getStroke } from "perfect-freehand";
import { type Background, drawBackground } from "./background";
import type { Stroke } from "./board";
import { intersects, strokeBounds } from "./bounds";
import type { Renderer } from "./controller";
import type { ImageCache } from "./image-cache";
import { imageRect } from "./image-geometry";
import { type Frame, HANDLE_PX, ROT_OFFSET_PX } from "./selection-frame";
import { partsOf } from "./shape-parts";
import { isPolygonKind } from "./shapes";
import { strokeOptions } from "./stroke-style";
import { fontSizeOf, LINE_HEIGHT, textLines } from "./text";
import { textFont } from "./text-wrap";
import { centerOf } from "./transform";
import type { Rect, Viewport } from "./viewport";

/** The most selected elements that still get the neon glow; a bigger selection just has its frame. */
const GLOW_MAX = 25;

/** Freehand strokes are filled outlines; shapes are stroked paths; text is drawn directly. */
const isFilled = (s: Stroke) => !s.kind || s.kind === "stroke";

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
const extras = new WeakMap<
	Stroke,
	{ fill: Path2D | null; hidden: Path2D | null }
>();
function extraPaths(
	s: Stroke,
): { fill: Path2D | null; hidden: Path2D | null } | null {
	if (!isPolygonKind(s.kind)) return null;
	let e = extras.get(s);
	if (!e) {
		const parts = partsOf(s);
		let fill: Path2D | null = null;
		let hidden: Path2D | null = null;
		if (parts && parts.fill.length >= 3) {
			fill = new Path2D();
			addPolyline(fill, [...parts.fill, parts.fill[0]]);
		}
		if (parts && parts.hidden.length > 0) {
			hidden = new Path2D();
			for (const line of parts.hidden) addPolyline(hidden, line);
		}
		e = { fill, hidden };
		extras.set(s, e);
	}
	return e;
}

/** The path of a line, rectangle or circle; null for anything else. */
function shapePath(s: Stroke): Path2D | null {
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

/** Draws one element in `color` (and `fill`, for shapes); `path` is its (cached) path, unused for text. */
function drawElement(
	ctx: CanvasRenderingContext2D,
	s: Stroke,
	path: Path2D | null,
	color: string,
	fill?: string,
): void {
	withLook(ctx, s, () => {
		if (s.kind === "text") {
			const fs = fontSizeOf(s);
			ctx.fillStyle = color;
			ctx.font = textFont(fs);
			ctx.textBaseline = "top";
			const [x, y] = s.points[0];
			const lineHeight = fs * LINE_HEIGHT;
			const halfLeading = (lineHeight - fs) / 2; // where a text field puts the first line
			// A text area is wrapped to its width (R-044), a text at a point keeps its own lines.
			textLines(s).forEach((line, i) => {
				ctx.fillText(line, x, y + i * lineHeight + halfLeading);
			});
		} else if (path && isFilled(s)) {
			ctx.fillStyle = color;
			ctx.fill(path);
		} else if (path) {
			const extra = extraPaths(s);
			if (fill) {
				ctx.fillStyle = fill;
				// A solid is filled inside its silhouette only, not inside its inner edges.
				ctx.fill(extra?.fill ?? path);
			}
			ctx.strokeStyle = color;
			ctx.lineWidth = s.size;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			ctx.setLineDash(dashPattern(s));
			ctx.stroke(path);
			if (extra?.hidden) {
				// The edges behind a solid: dotted, whatever the line style.
				ctx.setLineDash([0.1, s.size * 2.2]);
				ctx.stroke(extra.hidden);
			}
			ctx.setLineDash([]);
		}
	});
}

interface Cached {
	/** Computed on first use, only for strokes that are actually in view. */
	path?: Path2D | null;
	bounds: Rect;
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
	private selection: Frame | null = null;
	private marquee: Rect | null = null;
	private highlight: Stroke[] = [];
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
	/** Maps a stored ink colour to the colour painted (dark mode swaps black and white). */
	ink: (color: string) => string = (c) => c;
	/** Which grid to draw under the elements (R-027, R-032) and in which colour. */
	background: Background = "plain";
	gridColor = "#dcdee8";

	constructor(
		private committedCanvas: HTMLCanvasElement,
		private liveCanvas: HTMLCanvasElement,
		private viewport: Viewport,
		/** Source of the pictures for image elements; without it they show as placeholders. */
		private images: ImageCache | null = null,
	) {
		this.committed = committedCanvas.getContext("2d");
		this.live = liveCanvas.getContext("2d");
	}

	/** Matches the canvas buffers to the window size and device pixel ratio. */
	resize(): void {
		const dpr = window.devicePixelRatio || 1;
		this.committedCanvas.width = innerWidth * dpr;
		this.committedCanvas.height = innerHeight * dpr;
		this.liveCanvas.width = innerWidth * dpr;
		this.liveCanvas.height = innerHeight * dpr;
		this.paint();
	}

	/** Sets our own unfinished stroke (null when finished). */
	drawLive(stroke: Stroke | null): void {
		this.local = stroke;
		this.paintLive();
	}

	/** Shows the selection frame, corner handles and rotation handle (null hides them). */
	setSelection(frame: Frame | null): void {
		this.selection = frame;
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

	/** Shows the rubber band of a selection being dragged (null hides it). */
	setMarquee(rect: Rect | null): void {
		this.marquee = rect;
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
		if (committed) this.paintCommitted();
		if (live) this.paintLive();
	}

	private paint(): void {
		this.paintCommitted();
		this.paintLive();
	}

	/** Clears the canvas and applies the view transform. */
	private begin(ctx: CanvasRenderingContext2D): void {
		const dpr = window.devicePixelRatio || 1;
		const { x, y, scale } = this.viewport;
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
		this.begin(ctx);
		drawBackground(
			ctx,
			this.background,
			this.viewport,
			innerWidth,
			innerHeight,
			window.devicePixelRatio || 1,
			this.gridColor,
		);
		const view = this.viewport.worldRect(innerWidth, innerHeight);
		for (const s of this.strokes) {
			if (this.drag?.ids.has(s.id)) continue; // drawn on the live layer while dragged
			this.drawStroke(ctx, s, view);
		}
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
			c = { bounds: strokeBounds(s) };
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
		if (c.path === undefined) c.path = elementPath(s);
		drawElement(
			ctx,
			s,
			c.path,
			this.ink(s.color),
			s.fill ? this.ink(s.fill) : undefined,
		);
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
	 * The handles that edit the selection, all alike: pink dots a little off the object (no outline
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
		ctx.fillStyle = "#e91e63";
		const stem = ROT_OFFSET_PX * px;
		for (const [x, y] of [
			[0, -f.h / 2 - stem],
			[-f.w / 2, -f.h / 2],
			[f.w / 2, -f.h / 2],
			[f.w / 2, f.h / 2],
			[-f.w / 2, f.h / 2],
			// the middles of the sides stretch one dimension (R-041)
			[0, -f.h / 2],
			[f.w / 2, 0],
			[0, f.h / 2],
			[-f.w / 2, 0],
		]) {
			ctx.beginPath();
			ctx.arc(x, y, (HANDLE_PX / 2) * px, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		}
		ctx.restore();
	}

	/** A neon glow along the element itself: its shape drawn with a bright, blurred shadow. */
	private drawGlow(ctx: CanvasRenderingContext2D, s: Stroke): void {
		const dpr = window.devicePixelRatio || 1;
		const path = elementPath(s);
		const color = s.kind === "image" ? "#fff" : this.ink(s.color);
		ctx.save();
		ctx.shadowColor = "#00d4ff";
		// The blur is in device pixels whatever the zoom; two passes make it brighter.
		for (const blur of [10, 22]) {
			ctx.shadowBlur = blur * dpr;
			if (s.kind === "image") {
				const r = imageRect(s);
				withLook(ctx, s, () =>
					ctx.strokeRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY),
				);
			} else {
				drawElement(ctx, s, path, color, s.fill ? this.ink(s.fill) : undefined);
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
		ctx.fillStyle = "#e91e63";
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
				s.fill ? this.ink(s.fill) : undefined,
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
		// A glow is a blurred shadow, which is costly: not while dragging, not on a big selection.
		if (!this.drag && this.highlight.length <= GLOW_MAX)
			for (const s of this.highlight) this.drawGlow(ctx, s);
		if (this.endpoints) this.drawEndpoints(ctx, this.endpoints);
		if (this.adjust) this.drawAdjust(ctx, this.adjust);
		if (this.selection) this.drawFrame(ctx, this.selection);
		if (this.marquee) this.drawMarquee(ctx, this.marquee);
	}
}
