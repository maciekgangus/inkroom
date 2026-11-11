/** The limits of a PDF loaded onto a board (ADR 0015). */
export const MAX_PAGES = 60;
export const MAX_BYTES = 50 * 1024 * 1024;
/** Pixels across a page as it is drawn (its height follows the page's shape). */
export const RENDER_WIDTH = 2000;

/**
 * Why a picked file cannot be loaded as a PDF, in plain words, or null when it can. The type may
 * be empty (some devices give none), so the name counts too.
 */
export function checkPdfFile(file: File): string | null {
	const isPdf =
		file.type === "application/pdf" || /\.pdf$/i.test(file.name ?? "");
	if (!isPdf) return "To nie jest plik PDF";
	if (file.size === 0) return "Plik PDF jest pusty";
	if (file.size > MAX_BYTES) return "Plik jest za duży (limit 50 MB)";
	return null;
}

/** How many pages of a document are loaded and how many are left out. */
export function pagesToLoad(total: number): { load: number; skipped: number } {
	const load = Math.min(total, MAX_PAGES);
	return { load, skipped: total - load };
}

/** An error of the PDF library or of the upload, as a message for the person. */
export function describePdfError(e: unknown): string {
	const name = (e as { name?: string } | null)?.name;
	if (name === "PasswordException")
		return "Ten PDF jest zabezpieczony hasłem i nie można go wczytać";
	if (name === "InvalidPDFException")
		return "Plik PDF jest uszkodzony i nie można go wczytać";
	if (e instanceof Error && e.message) return e.message;
	return "Nie udało się wczytać pliku PDF";
}

/** "1 stronę", "3 strony", "12 stron": the page count in Polish after "wczytano". */
function pages(n: number): string {
	if (n === 1) return "1 stronę";
	const last = n % 10;
	const teens = n % 100 >= 12 && n % 100 <= 14;
	return `${n} ${last >= 2 && last <= 4 && !teens ? "strony" : "stron"}`;
}

/** What is said when a PDF has been loaded (or stopped). */
export function summarize(r: {
	loaded: number;
	skipped: number;
	cancelled: boolean;
}): string {
	if (r.cancelled)
		return r.loaded === 0
			? "Przerwano"
			: `Przerwano: wczytano ${pages(r.loaded)}`;
	if (r.skipped > 0)
		return `Wczytano ${pages(r.loaded)}. Pominięto ${r.skipped} (limit to ${MAX_PAGES} stron)`;
	return `Wczytano ${pages(r.loaded)}`;
}
