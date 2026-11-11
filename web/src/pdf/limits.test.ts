import { describe, expect, test } from "vitest";
import {
	checkPdfFile,
	describePdfError,
	MAX_BYTES,
	MAX_PAGES,
	pagesToLoad,
	RENDER_WIDTH,
	summarize,
} from "./limits";

const file = (name: string, type: string, size: number) => {
	const f = new File(["x"], name, { type });
	Object.defineProperty(f, "size", { value: size });
	return f;
};

describe("the limits of a PDF (ADR 0015)", () => {
	test("are 60 pages, 50 MB and pages 2000 px wide", () => {
		expect(MAX_PAGES).toBe(60);
		expect(MAX_BYTES).toBe(50 * 1024 * 1024);
		expect(RENDER_WIDTH).toBe(2000);
	});

	test("a PDF is told by its type or, when the device gives none, by its name", () => {
		expect(checkPdfFile(file("karta.pdf", "application/pdf", 1000))).toBeNull();
		expect(checkPdfFile(file("Karta.PDF", "", 1000))).toBeNull();
	});

	test("anything else is refused with a message", () => {
		expect(checkPdfFile(file("zdjecie.png", "image/png", 1000))).toMatch(/PDF/);
		expect(checkPdfFile(file("notatki.txt", "text/plain", 1000))).toMatch(
			/PDF/,
		);
	});

	test("an empty file and a file over 50 MB are refused", () => {
		expect(checkPdfFile(file("a.pdf", "application/pdf", 0))).toMatch(/pusty/);
		expect(
			checkPdfFile(file("a.pdf", "application/pdf", MAX_BYTES + 1)),
		).toMatch(/50 MB/);
		expect(
			checkPdfFile(file("a.pdf", "application/pdf", MAX_BYTES)),
		).toBeNull();
	});

	test("up to 60 pages are loaded, the rest is counted", () => {
		expect(pagesToLoad(3)).toEqual({ load: 3, skipped: 0 });
		expect(pagesToLoad(60)).toEqual({ load: 60, skipped: 0 });
		expect(pagesToLoad(75)).toEqual({ load: 60, skipped: 15 });
	});
});

describe("describePdfError", () => {
	test("says what is wrong with a protected and with a damaged file", () => {
		expect(describePdfError({ name: "PasswordException" })).toMatch(/hasł/);
		expect(describePdfError({ name: "InvalidPDFException" })).toMatch(
			/uszkodzon/,
		);
	});

	test("keeps a message that is already in plain words, and has a fallback", () => {
		expect(describePdfError(new Error("Brak połączenia z serwerem"))).toBe(
			"Brak połączenia z serwerem",
		);
		expect(describePdfError("???")).toMatch(/PDF/);
	});
});

describe("summarize (what is said when a PDF is loaded)", () => {
	test("counts the pages in Polish", () => {
		expect(summarize({ loaded: 1, skipped: 0, cancelled: false })).toBe(
			"Wczytano 1 stronę",
		);
		expect(summarize({ loaded: 3, skipped: 0, cancelled: false })).toBe(
			"Wczytano 3 strony",
		);
		expect(summarize({ loaded: 12, skipped: 0, cancelled: false })).toBe(
			"Wczytano 12 stron",
		);
		expect(summarize({ loaded: 22, skipped: 0, cancelled: false })).toBe(
			"Wczytano 22 strony",
		);
	});

	test("says how many pages were left out over the limit", () => {
		expect(summarize({ loaded: 60, skipped: 15, cancelled: false })).toBe(
			"Wczytano 60 stron. Pominięto 15 (limit to 60 stron)",
		);
	});

	test("says how far it got when it was cancelled", () => {
		expect(summarize({ loaded: 2, skipped: 0, cancelled: true })).toBe(
			"Przerwano: wczytano 2 strony",
		);
		expect(summarize({ loaded: 0, skipped: 0, cancelled: true })).toBe(
			"Przerwano",
		);
	});
});
