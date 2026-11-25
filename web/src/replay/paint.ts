import { type Background, drawBackground } from "../board/background";
import type { Stroke } from "../board/board";
import { paintElements } from "../board/canvas-renderer";
import type { ImageCache } from "../board/image-cache";
import type { LaserLine } from "../board/laser";
import { Viewport } from "../board/viewport";
import { cursorColor } from "../cursor-colors";

// One frame of a rendered video (R-115): the board at a time, drawn on a canvas of the video's size,
// in the stored (light) colours, whatever the theme of the page that renders it.

export interface FrameState {
	strokes: Stroke[];
	/** Strokes still being drawn (the live layer). */
	live: Stroke[];
	background: Background;
	lasers: LaserLine[];
	cursors: { id: string; name: string; x: number; y: number }[];
	/** The part of the board shown: its top left corner and the scale. */
	view: { x: number; y: number; scale: number };
}

const GRID = "#dcdee8";
const GRID_CLUSTER = "#b9bdd0";
const LASER_COLOR = "#ff1744";
const LASER_WIDTH_PX = 4;
/** The arrow of a cursor, as on the live board (cursors.tsx); made on first use (not every page has Path2D). */
let arrow: Path2D | undefined;
const ARROW = () =>
	(arrow ??= new Path2D(
		"M1 1 L1 15 L5 11.5 L8 17 L10.5 15.8 L7.6 10.4 L13 10.2 Z",
	));

export function paintFrame(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	st: FrameState,
	images: ImageCache | null,
): void {
	const { x, y, scale } = st.view;
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalAlpha = 1;
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, width, height);
	const vp = new Viewport();
	vp.x = x;
	vp.y = y;
	vp.scale = scale;
	drawBackground(ctx, st.background, vp, width, height, 1, GRID, GRID_CLUSTER);
	ctx.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
	const region = {
		minX: x,
		minY: y,
		maxX: x + width / scale,
		maxY: y + height / scale,
	};
	paintElements(ctx, st.strokes, region, images);
	paintElements(ctx, st.live, region, images);
	paintLasers(ctx, st.lasers, scale);
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	paintCursors(ctx, st, scale);
}

/** The red pointer's trail: a faint halo under a bright core, thinner and fainter towards the tail. */
function paintLasers(
	ctx: CanvasRenderingContext2D,
	lines: LaserLine[],
	scale: number,
): void {
	if (lines.length === 0) return;
	const w = LASER_WIDTH_PX / scale;
	ctx.save();
	ctx.strokeStyle = LASER_COLOR;
	ctx.fillStyle = LASER_COLOR;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	for (const line of lines) {
		const pts = line.points;
		for (let i = 1; i < pts.length; i++) {
			const a = pts[i].alpha;
			ctx.beginPath();
			ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
			ctx.lineTo(pts[i].x, pts[i].y);
			ctx.globalAlpha = a * 0.22;
			ctx.lineWidth = w * (1.2 + 2.6 * a);
			ctx.stroke();
			ctx.globalAlpha = Math.min(1, a * 1.2);
			ctx.lineWidth = w * (0.35 + 0.65 * a);
			ctx.stroke();
		}
		const head = pts[pts.length - 1];
		if (head) {
			ctx.globalAlpha = Math.min(1, head.alpha);
			ctx.beginPath();
			ctx.arc(head.x, head.y, w * 1.6, 0, Math.PI * 2);
			ctx.fill();
		}
	}
	ctx.restore();
}

/** Other people's cursors, in screen pixels: an arrow and the name on a label of the person's colour. */
function paintCursors(
	ctx: CanvasRenderingContext2D,
	st: FrameState,
	scale: number,
): void {
	ctx.save();
	ctx.font = "11px Inter, system-ui, sans-serif";
	ctx.textBaseline = "middle";
	for (const c of st.cursors) {
		const sx = (c.x - st.view.x) * scale;
		const sy = (c.y - st.view.y) * scale;
		const color = cursorColor(c.id);
		ctx.save();
		ctx.translate(sx, sy);
		ctx.fillStyle = color;
		ctx.strokeStyle = "#fff";
		ctx.lineWidth = 1;
		ctx.fill(ARROW());
		ctx.stroke(ARROW());
		ctx.restore();
		if (c.name) {
			const tw = ctx.measureText(c.name).width;
			const lx = sx + 12;
			const ly = sy + 14;
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.roundRect(lx, ly, tw + 12, 18, 9);
			ctx.fill();
			ctx.fillStyle = "#fff";
			ctx.fillText(c.name, lx + 6, ly + 9.5);
		}
	}
	ctx.restore();
}
