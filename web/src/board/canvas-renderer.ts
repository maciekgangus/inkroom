import { getStroke } from "perfect-freehand";
import type { Stroke } from "./board";
import { intersects, strokeBounds } from "./bounds";
import type { Renderer } from "./controller";
import type { Rect, Viewport } from "./viewport";

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

	constructor(
		private committedCanvas: HTMLCanvasElement,
		private liveCanvas: HTMLCanvasElement,
		private viewport: Viewport,
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
			if (c.path === undefined) c.path = outlinePath(s);
			if (!c.path) continue;
			ctx.fillStyle = s.color;
			ctx.fill(c.path);
		}
	}

	private paintLive(): void {
		const ctx = this.live;
		if (!ctx) return;
		this.begin(ctx);
		// Unfinished strokes keep changing, so their outlines are not cached.
		for (const s of [...this.remote, ...(this.local ? [this.local] : [])]) {
			const path = outlinePath(s);
			if (!path) continue;
			ctx.fillStyle = s.color;
			ctx.fill(path);
		}
	}
}
