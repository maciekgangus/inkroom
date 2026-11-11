import { describe, expect, test, vi } from "vitest";
import type { Rect } from "../board/viewport";
import { loadPdf, type PdfDeps } from "./loader";

const pdfFile = (size = 1000) => {
	const f = new File(["%PDF"], "karta.pdf", { type: "application/pdf" });
	Object.defineProperty(f, "size", { value: size });
	return f;
};

/** A document of `n` pages, each 2000 by 2828 as rendered; records what the loader does. */
function fake(n: number, opts: { failUploadAt?: number } = {}) {
	const calls = {
		rendered: [] as number[],
		uploaded: 0,
		placed: [] as { src: string; rect: Rect }[],
		progress: [] as [number, number][],
		done: 0,
		closed: 0,
		busy: 0,
		maxBusy: 0,
	};
	const deps: PdfDeps = {
		open: async () => ({
			numPages: n,
			renderPage: async (page: number) => {
				calls.busy++;
				calls.maxBusy = Math.max(calls.maxBusy, calls.busy);
				calls.rendered.push(page);
				await Promise.resolve();
				calls.busy--;
				return { blob: new Blob([`p${page}`]), width: 2000, height: 2828 };
			},
			close: () => {
				calls.closed++;
			},
		}),
		upload: async () => {
			calls.uploaded++;
			if (opts.failUploadAt === calls.uploaded)
				throw new Error("Brak połączenia z serwerem, spróbuj ponownie");
			return `img${calls.uploaded}`;
		},
		place: (src, rect) => {
			calls.placed.push({ src, rect });
		},
		finish: () => {
			calls.done++;
		},
		start: [100, 200],
		progress: (done, total) => {
			calls.progress.push([done, total]);
		},
	};
	return { deps, calls };
}

describe("loadPdf (R-056, ADR 0015)", () => {
	test("puts every page on the board, one under another, in order", async () => {
		const { deps, calls } = fake(3);
		const result = await loadPdf(pdfFile(), deps);
		expect(result).toEqual({ loaded: 3, skipped: 0, cancelled: false });
		expect(calls.rendered).toEqual([1, 2, 3]);
		expect(calls.placed.map((p) => p.src)).toEqual(["img1", "img2", "img3"]);
		const rects = calls.placed.map((p) => p.rect);
		for (const r of rects) {
			expect(r.maxX - r.minX).toBe(900);
			expect(r.minX).toBe(100);
		}
		expect(rects[0].minY).toBe(200);
		const h = (900 * 2828) / 2000;
		expect(rects[1].minY).toBeCloseTo(200 + h + 24);
		expect(rects[2].minY).toBeCloseTo(200 + 2 * (h + 24));
	});

	test("reports the progress after each page and finishes the batch once", async () => {
		const { deps, calls } = fake(3);
		await loadPdf(pdfFile(), deps);
		expect(calls.progress).toEqual([
			[0, 3],
			[1, 3],
			[2, 3],
			[3, 3],
		]);
		expect(calls.done).toBe(1);
		expect(calls.closed).toBe(1);
	});

	test("renders one page at a time, so the memory of a weak tablet is spared", async () => {
		const { deps, calls } = fake(5);
		await loadPdf(pdfFile(), deps);
		expect(calls.maxBusy).toBe(1);
	});

	test("takes the first 60 pages of a longer document and says how many were left out", async () => {
		const { deps, calls } = fake(75);
		const result = await loadPdf(pdfFile(), deps);
		expect(result).toEqual({ loaded: 60, skipped: 15, cancelled: false });
		expect(calls.rendered).toHaveLength(60);
		expect(calls.rendered[59]).toBe(60);
	});

	test("stops when cancelled and keeps the pages already there", async () => {
		const { deps, calls } = fake(10);
		const abort = new AbortController();
		const progress = deps.progress;
		deps.progress = (done, total) => {
			progress(done, total);
			if (done === 2) abort.abort();
		};
		const result = await loadPdf(pdfFile(), { ...deps, signal: abort.signal });
		expect(result).toEqual({ loaded: 2, skipped: 0, cancelled: true });
		expect(calls.rendered).toEqual([1, 2]);
		expect(calls.placed).toHaveLength(2);
		expect(calls.done).toBe(1); // what was loaded is still one undo step
		expect(calls.closed).toBe(1);
	});

	test("a failure while sending a page keeps the earlier ones and says why", async () => {
		const { deps, calls } = fake(4, { failUploadAt: 3 });
		await expect(loadPdf(pdfFile(), deps)).rejects.toThrow(/Brak połączenia/);
		expect(calls.placed).toHaveLength(2);
		expect(calls.done).toBe(1);
		expect(calls.closed).toBe(1);
	});

	test("a file that is not a PDF or is too big is refused before anything is read", async () => {
		const open = vi.fn();
		const { deps } = fake(1);
		await expect(
			loadPdf(new File(["x"], "a.png", { type: "image/png" }), {
				...deps,
				open,
			}),
		).rejects.toThrow(/PDF/);
		await expect(
			loadPdf(pdfFile(60 * 1024 * 1024), { ...deps, open }),
		).rejects.toThrow(/50 MB/);
		expect(open).not.toHaveBeenCalled();
	});

	test("a protected or a damaged file is explained in plain words", async () => {
		const { deps } = fake(1);
		const protectedFile = {
			...deps,
			open: async () => Promise.reject({ name: "PasswordException" }),
		};
		await expect(loadPdf(pdfFile(), protectedFile)).rejects.toThrow(/hasł/);
		const damaged = {
			...deps,
			open: async () => Promise.reject({ name: "InvalidPDFException" }),
		};
		await expect(loadPdf(pdfFile(), damaged)).rejects.toThrow(/uszkodzon/);
	});

	test("an empty document loads nothing", async () => {
		const { deps, calls } = fake(0);
		await expect(loadPdf(pdfFile(), deps)).rejects.toThrow(/stron/);
		expect(calls.placed).toHaveLength(0);
		expect(calls.closed).toBe(1);
	});
});
