import type { Rect } from "../board/viewport";
import { GAP, pageRect } from "./layout";
import { checkPdfFile, describePdfError, pagesToLoad } from "./limits";

/** An open document: its page count and a way to get a page as a picture. */
export interface PdfDocument {
	numPages: number;
	renderPage(
		page: number,
	): Promise<{ blob: Blob; width: number; height: number }>;
	close(): void;
}

/** Everything the loader needs from outside, so it can be tested without a PDF or a board. */
export interface PdfDeps {
	open(data: ArrayBuffer): Promise<PdfDocument>;
	/** Sends a picture to the server; resolves with the id of the stored image. */
	upload(blob: Blob): Promise<string>;
	/** Puts an uploaded page on the board. */
	place(src: string, rect: Rect): void;
	/** Called once at the end, so the pages are one undo step. */
	finish(): void;
	/** Where the first page goes. */
	start: [number, number];
	/** Called with the pages done so far, from 0 to the total. */
	progress(done: number, total: number): void;
	signal?: AbortSignal;
}

export interface PdfResult {
	loaded: number;
	skipped: number;
	cancelled: boolean;
}

/**
 * Puts the pages of a PDF on the board one under another (R-056): renders a page, sends it,
 * places it, then the next, so only one page is in memory at a time. Stops when cancelled (the
 * pages already there stay) and on a failure (they stay too, and the error is thrown).
 */
export async function loadPdf(file: File, deps: PdfDeps): Promise<PdfResult> {
	const refused = checkPdfFile(file);
	if (refused) throw new Error(refused);

	let doc: PdfDocument;
	try {
		doc = await deps.open(await file.arrayBuffer());
	} catch (e) {
		throw new Error(describePdfError(e));
	}
	try {
		if (doc.numPages < 1) throw new Error("Ten PDF nie ma żadnych stron");
		const { load, skipped } = pagesToLoad(doc.numPages);
		let [x, y] = deps.start;
		let loaded = 0;
		deps.progress(0, load);
		try {
			for (let page = 1; page <= load; page++) {
				if (deps.signal?.aborted) return { loaded, skipped, cancelled: true };
				const rendered = await doc.renderPage(page);
				if (deps.signal?.aborted) return { loaded, skipped, cancelled: true };
				const src = await deps.upload(rendered.blob);
				const rect = pageRect([x, y], rendered.width, rendered.height);
				deps.place(src, rect);
				y = rect.maxY + GAP;
				loaded++;
				deps.progress(loaded, load);
			}
		} finally {
			deps.finish();
		}
		return { loaded, skipped, cancelled: deps.signal?.aborted ?? false };
	} finally {
		doc.close();
	}
}
