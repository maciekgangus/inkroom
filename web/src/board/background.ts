import type { Viewport } from "./viewport";

/** The board's shared backdrop (ADR 0010). */
export const BACKGROUNDS = ["plain", "dots", "grid", "lines"] as const;
export type Background = (typeof BACKGROUNDS)[number];

export const isBackground = (v: unknown): v is Background =>
	BACKGROUNDS.includes(v as Background);

const SPACING = 24; // board units between dots
/** Board units between the lines of the grid: big cells, as in IDROO. */
export const GRID_SPACING = 40;
/** A cluster is a block of this many cells in a row and a column, set off by stronger lines. */
export const GRID_CLUSTER = 4;
/** How strongly the lines between the cells of a cluster show against the lines round it. */
const CELL_STRENGTH = 0.5;
const LINE_SPACING = 32;
/** The closest two grid lines may get on screen (CSS px) before the finer level is gone. */
export const GRID_MIN_SCREEN = 12;

/** One level of the grid: its spacing in board units and how strongly it is drawn (0 to 1). */
export interface GridLevel {
	spacing: number;
	alpha: number;
}

/**
 * The grid levels to draw at a zoom (R-032). The main level always stays 2 to 4 times the
 * minimum spacing apart on screen; zooming out drops every other line, zooming in adds finer
 * ones, and the next finer level (half the spacing) fades in as the main one grows. Spacings
 * are the base raster times a power of two, so each level is a subset of the finer ones and
 * objects that sit on a line keep sitting on one.
 */
export function gridLevels(kind: Background, scale: number): GridLevel[] {
	if (kind === "plain") return [];
	const base =
		kind === "lines" ? LINE_SPACING : kind === "grid" ? GRID_SPACING : SPACING;
	const k = Math.ceil(Math.log2((GRID_MIN_SCREEN * 2) / (base * scale)));
	const main = base * 2 ** k;
	const alpha = (main * scale) / 2 / GRID_MIN_SCREEN - 1;
	const levels: GridLevel[] = [{ spacing: main, alpha: 1 }];
	if (alpha > 0.01)
		levels.push({ spacing: main / 2, alpha: Math.min(1, alpha) });
	return levels;
}

/** The spacing of the cluster lines of the grid at a zoom (every few lines of the main level), else null. */
export function clusterSpacing(kind: Background, scale: number): number | null {
	if (kind !== "grid") return null;
	return gridLevels(kind, scale)[0].spacing * GRID_CLUSTER;
}

/** The multiples of `spacing` in [from, to], each computed from its index so nothing drifts. */
export function gridPositions(
	spacing: number,
	from: number,
	to: number,
): number[] {
	const out: number[] = [];
	for (
		let i = Math.ceil(from / spacing - 1e-9);
		i * spacing <= to + spacing * 1e-9;
		i++
	) {
		out.push(i * spacing + 0); // + 0 turns -0 into 0
	}
	return out;
}

/**
 * Draws the grid on the board canvas, in the same pass as the elements so it can never lag
 * or drift against them. Positions come straight from the view and are snapped to the device
 * pixel grid, so lines stay crisp. `dpr` is the device pixel ratio; `w` and `h` the size in
 * CSS px.
 */
export function drawBackground(
	ctx: CanvasRenderingContext2D,
	kind: Background,
	viewport: Viewport,
	w: number,
	h: number,
	dpr: number,
	color: string,
): void {
	const levels = gridLevels(kind, viewport.scale);
	if (levels.length === 0) return;
	const { x, y, scale } = viewport;
	const sx = (wx: number) => Math.round((wx - x) * scale * dpr) + 0.5;
	const sy = (wy: number) => Math.round((wy - y) * scale * dpr) + 0.5;
	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.strokeStyle = color;
	ctx.fillStyle = color;
	ctx.lineWidth = Math.max(1, Math.round(dpr));
	// Finest level first, so the main level is painted on top at full strength.
	for (const { spacing, alpha } of [...levels].reverse()) {
		const xs = gridPositions(spacing, x, x + w / scale);
		const ys = gridPositions(spacing, y, y + h / scale);
		// On the grid the cells are lighter than the clusters drawn over them below.
		ctx.globalAlpha = kind === "grid" ? alpha * CELL_STRENGTH : alpha;
		ctx.beginPath();
		if (kind === "dots") {
			const r = 1.5 * dpr;
			for (const gx of xs) {
				for (const gy of ys) {
					ctx.moveTo(sx(gx) + r, sy(gy));
					ctx.arc(sx(gx), sy(gy), r, 0, Math.PI * 2);
				}
			}
			ctx.fill();
			continue;
		}
		if (kind === "grid") {
			for (const gx of xs) {
				ctx.moveTo(sx(gx), 0);
				ctx.lineTo(sx(gx), h * dpr);
			}
		}
		for (const gy of ys) {
			ctx.moveTo(0, sy(gy));
			ctx.lineTo(w * dpr, sy(gy));
		}
		ctx.stroke();
	}
	const cluster = clusterSpacing(kind, scale);
	if (cluster) {
		ctx.globalAlpha = 1;
		ctx.beginPath();
		for (const gx of gridPositions(cluster, x, x + w / scale)) {
			ctx.moveTo(sx(gx), 0);
			ctx.lineTo(sx(gx), h * dpr);
		}
		for (const gy of gridPositions(cluster, y, y + h / scale)) {
			ctx.moveTo(0, sy(gy));
			ctx.lineTo(w * dpr, sy(gy));
		}
		ctx.stroke();
	}
	ctx.restore();
}
