import { type Background, drawBackground } from "./background";
import type { Stroke } from "./board";
import { paintElements } from "./canvas-renderer";
import type { ImageCache } from "./image-cache";
import { contentBounds } from "./minimap";
import { type Rect, Viewport } from "./viewport";

/** Which part of the board an export covers: what the screen shows, or everything on it. */
export type ExportMode = "view" | "board";

/** Empty space round the content of a whole-board export, in board units. */
const PAD = 40;
/** The longest side a picture may have, in pixels (bigger canvases fail on tablets). */
const MAX_SIDE = 4096;
/** Pixels per board unit for a small region, so the picture stays sharp. */
const SHARP = 2;

/** The area to export, or null when there is nothing on the board to export. */
export function exportRegion(
	strokes: Stroke[],
	view: Rect,
	mode: ExportMode,
): Rect | null {
	if (mode === "view") return view;
	const all = contentBounds(strokes);
	if (!all) return null;
	return {
		minX: all.minX - PAD,
		minY: all.minY - PAD,
		maxX: all.maxX + PAD,
		maxY: all.maxY + PAD,
	};
}

/**
 * The picture size for a region: `sharp` pixels per board unit when small (twice, for a sharp
 * export; one for a preview), shrunk so the longest side is at most `maxSide`.
 */
export function exportSize(
	region: Rect,
	maxSide = MAX_SIDE,
	sharp = SHARP,
): {
	scale: number;
	width: number;
	height: number;
} {
	const w = Math.max(region.maxX - region.minX, 1);
	const h = Math.max(region.maxY - region.minY, 1);
	const scale = Math.min(sharp, maxSide / Math.max(w, h));
	return {
		scale,
		width: Math.max(1, Math.round(w * scale)),
		height: Math.max(1, Math.round(h * scale)),
	};
}

/** How big a picture to make, and what to do about photos (a preview needs no photos). */
export interface RenderOptions {
	maxSide?: number;
	sharp?: number;
	/** Draw a light rectangle where a photo is, instead of leaving it out. */
	placeholders?: boolean;
}

/**
 * Paints the region on a new canvas: a white page with the board's backdrop and every element in
 * its own (light mode) colours, whatever theme the screen is in.
 */
export function renderRegion(
	strokes: Stroke[],
	region: Rect,
	background: Background,
	images: ImageCache | null,
	options: RenderOptions = {},
): HTMLCanvasElement {
	const { scale, width, height } = exportSize(
		region,
		options.maxSide,
		options.sharp,
	);
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no 2d canvas");
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, width, height);
	const vp = new Viewport();
	vp.x = region.minX;
	vp.y = region.minY;
	vp.scale = scale;
	drawBackground(
		ctx,
		background,
		vp,
		width / scale,
		height / scale,
		1,
		"#dcdee8",
	);
	ctx.setTransform(
		scale,
		0,
		0,
		scale,
		-region.minX * scale,
		-region.minY * scale,
	);
	paintElements(ctx, strokes, region, images, options.placeholders);
	return canvas;
}

const encoder = new TextEncoder();

/**
 * A one page PDF holding a JPEG picture: the page is `pageW` by `pageH` points and the picture
 * (`w` by `h` pixels) fills it. Written by hand so no PDF library is needed.
 */
export function pdfFromJpeg(
	jpeg: Uint8Array,
	w: number,
	h: number,
	pageW: number,
	pageH: number,
): Uint8Array {
	const chunks: Uint8Array[] = [];
	const offsets: number[] = [];
	let length = 0;
	const push = (b: Uint8Array | string) => {
		const bytes = typeof b === "string" ? encoder.encode(b) : b;
		chunks.push(bytes);
		length += bytes.length;
	};
	const object = (body: string, stream?: Uint8Array) => {
		offsets.push(length);
		push(`${offsets.length} 0 obj\n${body}`);
		if (stream) {
			push("\nstream\n");
			push(stream);
			push("\nendstream");
		}
		push("\nendobj\n");
	};
	push("%PDF-1.4\n");
	object("<< /Type /Catalog /Pages 2 0 R >>");
	object("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
	object(
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>`,
	);
	const draw = encoder.encode(`q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`);
	object(`<< /Length ${draw.length} >>`, draw);
	object(
		`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
		jpeg,
	);
	const xref = length;
	push(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`);
	for (const o of offsets) push(`${String(o).padStart(10, "0")} 00000 n \n`);
	push(
		`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
	);
	const out = new Uint8Array(length);
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.length;
	}
	return out;
}
