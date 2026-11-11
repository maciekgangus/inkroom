/** A page that stays below this as a PNG keeps it (clean text stays sharp); bigger ones are JPEGs. */
const PNG_MAX = 1.5 * 1024 * 1024;
const JPEG_QUALITY = 0.85;
/** The server takes no image over 5 MiB (ADR 0007): a JPEG is made smaller until it fits. */
const SERVER_MAX = 4.8 * 1024 * 1024;

/** Which format a page is stored in, given how big it is as a PNG (ADR 0015). */
export function pickEncoding(pngBytes: number): "png" | "jpeg" {
	return pngBytes <= PNG_MAX ? "png" : "jpeg";
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
	new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(
			(b) =>
				b ? resolve(b) : reject(new Error("Nie udało się zapisać strony")),
			type,
			quality,
		),
	);

/** A rendered page as a picture to upload: a PNG when that is small, else a JPEG. */
export async function encodePage(canvas: HTMLCanvasElement): Promise<Blob> {
	const png = await toBlob(canvas, "image/png");
	if (pickEncoding(png.size) === "png") return png;
	let quality = JPEG_QUALITY;
	let jpeg = await toBlob(canvas, "image/jpeg", quality);
	while (jpeg.size > SERVER_MAX && quality > 0.4) {
		quality -= 0.15;
		jpeg = await toBlob(canvas, "image/jpeg", quality);
	}
	return jpeg;
}
