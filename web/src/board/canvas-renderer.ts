import { getStroke } from "perfect-freehand";
import type { Stroke } from "./board";
import type { Renderer } from "./controller";

function fill(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
	const outline = getStroke(stroke.points, {
		size: stroke.size,
		thinning: 0.6,
		smoothing: 0.5,
		streamline: 0.4,
		simulatePressure: false,
	});
	if (outline.length < 2) return;
	ctx.beginPath();
	ctx.moveTo(outline[0][0], outline[0][1]);
	for (let i = 1; i < outline.length; i++)
		ctx.lineTo(outline[i][0], outline[i][1]);
	ctx.closePath();
	ctx.fillStyle = stroke.color;
	ctx.fill();
}

/** Renders strokes on two stacked canvases: committed strokes below, the live stroke above. */
export class CanvasRenderer implements Renderer {
	private committed: CanvasRenderingContext2D | null;
	private live: CanvasRenderingContext2D | null;
	private local: Stroke | null = null;
	private remote: Stroke[] = [];

	constructor(
		private committedCanvas: HTMLCanvasElement,
		private liveCanvas: HTMLCanvasElement,
	) {
		this.committed = committedCanvas.getContext("2d");
		this.live = liveCanvas.getContext("2d");
	}

	/** Matches the canvas buffers to the window size and device pixel ratio. */
	resize(): void {
		const dpr = window.devicePixelRatio || 1;
		for (const [canvas, ctx] of [
			[this.committedCanvas, this.committed],
			[this.liveCanvas, this.live],
		] as const) {
			canvas.width = innerWidth * dpr;
			canvas.height = innerHeight * dpr;
			ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
		}
		this.paintLive();
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

	private paintLive(): void {
		if (!this.live) return;
		this.live.clearRect(0, 0, innerWidth, innerHeight);
		for (const s of this.remote) fill(this.live, s);
		if (this.local) fill(this.live, this.local);
	}

	redraw(strokes: Stroke[]): void {
		if (!this.committed) return;
		this.committed.clearRect(0, 0, innerWidth, innerHeight);
		for (const s of strokes) fill(this.committed, s);
	}
}
