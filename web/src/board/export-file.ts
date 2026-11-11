import type { Background } from "./background";
import type { Stroke } from "./board";
import {
	type ExportMode,
	exportRegion,
	exportSize,
	pdfFromJpeg,
	renderRegion,
} from "./export";
import type { ImageCache } from "./image-cache";
import type { Rect } from "./viewport";

const toBlob = (c: HTMLCanvasElement, type: string, quality?: number) =>
	new Promise<Blob>((resolve, reject) =>
		c.toBlob(
			(b) => (b ? resolve(b) : reject(new Error("export failed"))),
			type,
			quality,
		),
	);

/** A file name safe on every system, from the board's name. */
function fileName(title: string, ext: string): string {
	const base = title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
	return `${base || "tablica"}.${ext}`;
}

function save(blob: Blob, name: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Saves the board (or what the screen shows) as a PNG or a PDF file (R-014).
 * Resolves false when there is nothing to export.
 */
export async function exportBoard(
	action: "png-view" | "png-board" | "pdf-board",
	strokes: Stroke[],
	view: Rect,
	background: Background,
	images: ImageCache | null,
	title: string,
): Promise<boolean> {
	const mode: ExportMode = action === "png-view" ? "view" : "board";
	const region = exportRegion(strokes, view, mode);
	if (!region) return false;
	const canvas = renderRegion(strokes, region, background, images);
	if (action === "pdf-board") {
		const jpeg = new Uint8Array(
			await (await toBlob(canvas, "image/jpeg", 0.92)).arrayBuffer(),
		);
		const { scale } = exportSize(region);
		const pdf = pdfFromJpeg(
			jpeg,
			canvas.width,
			canvas.height,
			Math.round(canvas.width / scale),
			Math.round(canvas.height / scale),
		);
		save(
			new Blob([pdf as BlobPart], { type: "application/pdf" }),
			fileName(title, "pdf"),
		);
	} else {
		save(await toBlob(canvas, "image/png"), fileName(title, "png"));
	}
	return true;
}
