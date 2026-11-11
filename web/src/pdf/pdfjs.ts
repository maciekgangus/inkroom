import { encodePage } from "./encode";
import { RENDER_WIDTH } from "./limits";
import type { PdfDocument } from "./loader";

/**
 * Opens a PDF with pdf.js, loaded only now (about 1 MB, so it is not part of starting the app).
 * A page is drawn on a canvas as wide as RENDER_WIDTH, stored by `encodePage`, and the canvas is
 * let go of at once, so a weak tablet holds one page at a time (ADR 0015).
 */
export async function openPdf(data: ArrayBuffer): Promise<PdfDocument> {
	const [pdfjs, worker] = await Promise.all([
		import("pdfjs-dist"),
		import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
	]);
	pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
	const task = pdfjs.getDocument({ data: new Uint8Array(data) });
	const doc = await task.promise;
	return {
		numPages: doc.numPages,
		async renderPage(n) {
			const page = await doc.getPage(n);
			try {
				const base = page.getViewport({ scale: 1 });
				const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width });
				const canvas = document.createElement("canvas");
				canvas.width = Math.round(viewport.width);
				canvas.height = Math.round(viewport.height);
				const ctx = canvas.getContext("2d");
				if (!ctx) throw new Error("Nie można narysować strony PDF");
				ctx.fillStyle = "#fff"; // a page has no background of its own
				ctx.fillRect(0, 0, canvas.width, canvas.height);
				await page.render({ canvasContext: ctx, canvas, viewport }).promise;
				const [width, height] = [canvas.width, canvas.height];
				const blob = await encodePage(canvas);
				canvas.width = canvas.height = 0; // gives the memory back
				return { blob, width, height };
			} finally {
				page.cleanup();
			}
		},
		close: () => {
			void task.destroy();
		},
	};
}
