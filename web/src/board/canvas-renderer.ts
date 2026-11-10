import { getStroke } from "perfect-freehand";
import { type Background, drawBackground } from "./background";
import type { Stroke } from "./board";
import { intersects, strokeBounds } from "./bounds";
import type { Renderer } from "./controller";
import type { ImageCache } from "./image-cache";
import { imageRect } from "./image-geometry";
import {
	type Frame,
	HANDLE_PX,
	ROT_OFFSET_PX,
	showsBox,
} from "./selection-frame";
import { fontSizeOf, LINE_HEIGHT } from "./text";
import { centerOf } from "./transform";
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
			ctx.font = `${fs}px system-ui, sans-serif`;
			ctx.textBaseline = "top";
			const [x, y] = s.points[0];
			const lineHeight = fs * LINE_HEIGHT;
			const halfLeading = (lineHeight - fs) / 2; // where a text field puts the first line
			(s.text ?? "").split("\n").forEach((line, i) => {
				ctx.fillText(line, x, y + i * lineHeight + halfLeading);
			});
		} else if (path && isFilled(s)) {
			ctx.fillStyle = color;
			ctx.fill(path);
		} else if (path) {
			if (fill) {
				ctx.fillStyle = fill;
				ctx.fill(path);
			}
			ctx.strokeStyle = color;
			ctx.lineWidth = s.size;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			ctx.setLineDash(dashPattern(s));
			ctx.stroke(path);
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
		this.paintLive();
	}

	/** Makes the selected elements glow like neon (an empty list clears it). */
	setHighlight(els: Stroke[]): void {
		this.highlight = els;
		this.paintLive();
	}

	/** Shows the rubber band of a selection being dragged (null hides it). */
	setMarquee(rect: Rect | null): void {
		this.marquee = rect;
		this.paintLive();
	}

	/** Sets other people's unfinished strokes. */
	setRemoteLive(strokes: Stroke[]): void {
		this.remote = strokes;
		this.paintLive();
	}

	/** Repaints with what is already known (after the background or its colour changed). */
	refresh(): void {
		this.paint();
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
			drawElement(
				ctx,
				s,
				c.path,
				this.ink(s.color),
				s.fill ? this.ink(s.fill) : undefined,
			);
		}
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

	/** Frame, corner handles and rotation handle, a constant size on screen whatever the zoom. */
	private drawFrame(ctx: CanvasRenderingContext2D, f: Frame): void {
		const px = 1 / this.viewport.scale;
		ctx.save();
		ctx.translate(f.cx, f.cy);
		ctx.rotate(f.rot);
		ctx.strokeStyle = "#1976d2";
		ctx.lineWidth = 2 * px;
		// A lone stroke, line or text only glows: its handles show, the box does not (R-034).
		if (showsBox(this.highlight)) ctx.strokeRect(-f.w / 2, -f.h / 2, f.w, f.h);
		const stem = ROT_OFFSET_PX * px;
		ctx.beginPath();
		ctx.moveTo(0, -f.h / 2);
		ctx.lineTo(0, -f.h / 2 - stem);
		ctx.stroke();
		ctx.fillStyle = "#fff";
		ctx.beginPath();
		ctx.arc(0, -f.h / 2 - stem, (HANDLE_PX / 2) * px, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		const h = (HANDLE_PX - 2) * px;
		for (const [x, y] of [
			[-f.w / 2, -f.h / 2],
			[f.w / 2, -f.h / 2],
			[f.w / 2, f.h / 2],
			[-f.w / 2, f.h / 2],
		]) {
			ctx.fillRect(x - h / 2, y - h / 2, h, h);
			ctx.strokeRect(x - h / 2, y - h / 2, h, h);
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
		for (const s of this.highlight) this.drawGlow(ctx, s);
		if (this.selection) this.drawFrame(ctx, this.selection);
		if (this.marquee) this.drawMarquee(ctx, this.marquee);
	}
}
