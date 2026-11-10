import { getStroke } from "perfect-freehand";
import type { Stroke } from "./board";
import { intersects, strokeBounds } from "./bounds";
import type { Renderer } from "./controller";
import type { ImageCache } from "./image-cache";
import { imageRect } from "./image-geometry";
import { fontSizeOf, LINE_HEIGHT } from "./text";
import type { Rect, Viewport } from "./viewport";

/** Freehand strokes are filled outlines; shapes are stroked paths; text is drawn directly. */
const isFilled = (s: Stroke) => !s.kind || s.kind === "stroke";

function outlinePath(stroke: Stroke): Path2D | null {
	const outline = getStroke(stroke.points, {
		size: stroke.size,
		thinning: 0.6,
		smoothing: 0.5,
		streamline: 0.4,
		simulatePressure: false,
	});
	if (outline.length < 2) return null;
	const path = new Path2D();
	path.moveTo(outline[0][0], outline[0][1]);
	for (let i = 1; i < outline.length; i++)
		path.lineTo(outline[i][0], outline[i][1]);
	path.closePath();
	return path;
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

/** Draws one element; `path` is its (cached) path, unused for text. */
function drawElement(
	ctx: CanvasRenderingContext2D,
	s: Stroke,
	path: Path2D | null,
): void {
	if (s.kind === "text") {
		const fs = fontSizeOf(s);
		ctx.fillStyle = s.color;
		ctx.font = `${fs}px system-ui, sans-serif`;
		ctx.textBaseline = "top";
		const [x, y] = s.points[0];
		const lineHeight = fs * LINE_HEIGHT;
		const halfLeading = (lineHeight - fs) / 2; // where a text field puts the first line
		(s.text ?? "").split("\n").forEach((line, i) => {
			ctx.fillText(line, x, y + i * lineHeight + halfLeading);
		});
	} else if (path && isFilled(s)) {
		ctx.fillStyle = s.color;
		ctx.fill(path);
	} else if (path) {
		ctx.strokeStyle = s.color;
		ctx.lineWidth = s.size;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.stroke(path);
	}
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
	private selection: Rect | null = null;

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

	/** Shows the selection frame and corner handles of the selected image (null hides them). */
	setSelection(rect: Rect | null): void {
		this.selection = rect;
		this.paintLive();
	}

	/** Sets other people's unfinished strokes. */
	setRemoteLive(strokes: Stroke[]): void {
		this.remote = strokes;
		this.paintLive();
	}

	/** Repaints everything from `strokes` with the current view. */
	redraw(strokes: Stroke[]): void {
		this.strokes = strokes;
		this.paint();
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
		const view = this.viewport.worldRect(innerWidth, innerHeight);
		for (const s of this.strokes) {
			let c = this.cache.get(s);
			if (!c) {
				c = { bounds: strokeBounds(s) };
				this.cache.set(s, c);
			}
			if (!intersects(c.bounds, view)) continue;
			if (s.kind === "image") {
				this.drawImage(ctx, s);
				continue;
			}
			if (c.path === undefined) c.path = elementPath(s);
			drawElement(ctx, s, c.path);
		}
	}

	/** Draws a photo, or a grey placeholder while it loads (or if it failed). */
	private drawImage(ctx: CanvasRenderingContext2D, s: Stroke): void {
		const r = imageRect(s);
		const img = s.src ? this.images?.get(s.src) : null;
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
	}

	/** Frame and handles of the selected image, a constant size on screen whatever the zoom. */
	private drawSelection(ctx: CanvasRenderingContext2D, r: Rect): void {
		const px = 1 / this.viewport.scale;
		ctx.strokeStyle = "#1976d2";
		ctx.lineWidth = 2 * px;
		ctx.strokeRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
		const h = 10 * px;
		ctx.fillStyle = "#fff";
		for (const [x, y] of [
			[r.minX, r.minY],
			[r.maxX, r.minY],
			[r.minX, r.maxY],
			[r.maxX, r.maxY],
		]) {
			ctx.fillRect(x - h / 2, y - h / 2, h, h);
			ctx.strokeRect(x - h / 2, y - h / 2, h, h);
		}
	}

	private paintLive(): void {
		const ctx = this.live;
		if (!ctx) return;
		this.begin(ctx);
		// Unfinished elements keep changing, so their paths are not cached.
		for (const s of [...this.remote, ...(this.local ? [this.local] : [])]) {
			drawElement(ctx, s, elementPath(s));
		}
		if (this.selection) this.drawSelection(ctx, this.selection);
	}
}
