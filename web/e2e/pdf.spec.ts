import { expect, test } from "@playwright/test";
import { openBoard } from "./helpers";
import { makePdf } from "./pdf-file";

const input = 'input[aria-label="PDF file"]';

/** The images the server has saved for the board, in the order of their top edge. */
async function saved(page: import("@playwright/test").Page) {
	const id = new URL(page.url()).pathname.split("/").pop();
	const res = await page.context().request.get(`/api/boards/${id}/preview`);
	const { strokes } = await res.json();
	return (strokes as { kind?: string; points: number[][] }[])
		.filter((s) => s.kind === "image")
		.map((s) => ({
			x: s.points[0][0],
			y: s.points[0][1],
			w: s.points[1][0] - s.points[0][0],
			h: s.points[1][1] - s.points[0][1],
		}))
		.sort((a, b) => a.y - b.y);
}

test.beforeEach(async ({ page }) => {
	await openBoard(page);
});

test("the pages of a PDF land on the board one under another", async ({
	page,
}) => {
	await page.setInputFiles(input, {
		name: "karta.pdf",
		mimeType: "application/pdf",
		buffer: makePdf(3),
	});
	await expect(page.getByText("Wczytano 3 strony")).toBeVisible({
		timeout: 30_000,
	});
	await expect.poll(async () => (await saved(page)).length).toBe(3);
	const pages = await saved(page);
	for (const p of pages) expect(p.w).toBeCloseTo(900, 0);
	// Letter pages are 612 by 792: 900 wide means about 1165 high, and a gap of 24 between them.
	expect(pages[0].h).toBeCloseTo((900 * 792) / 612, 0);
	expect(pages[1].y - (pages[0].y + pages[0].h)).toBeCloseTo(24, 0);
	expect(pages[2].y - (pages[1].y + pages[1].h)).toBeCloseTo(24, 0);
	expect(pages[0].x).toBeCloseTo(pages[2].x, 0);
});

test("one undo takes the whole PDF off the board", async ({ page }) => {
	await page.setInputFiles(input, {
		name: "karta.pdf",
		mimeType: "application/pdf",
		buffer: makePdf(3),
	});
	await expect(page.getByText("Wczytano 3 strony")).toBeVisible({
		timeout: 30_000,
	});
	await page.locator("[aria-label='undo']").tap();
	await expect.poll(async () => (await saved(page)).length).toBe(0);
});

test("a file that is not a PDF is refused in plain words", async ({ page }) => {
	await page.setInputFiles(input, {
		name: "notatki.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("hello"),
	});
	await expect(page.getByRole("alert")).toContainText("To nie jest plik PDF");
	expect(await saved(page)).toHaveLength(0);
});

test("a damaged PDF is refused in plain words", async ({ page }) => {
	await page.setInputFiles(input, {
		name: "zepsuty.pdf",
		mimeType: "application/pdf",
		buffer: Buffer.from("%PDF-1.4 this is not a real file"),
	});
	await expect(page.getByRole("alert")).toContainText(/uszkodzon|PDF/);
	expect(await saved(page)).toHaveLength(0);
});

test("the menu has a Load PDF entry that opens the file chooser", async ({
	page,
}) => {
	await page.locator("[aria-label='board menu']").tap();
	const chooser = page.waitForEvent("filechooser");
	await page.getByRole("menuitem", { name: "Wczytaj PDF" }).tap();
	expect((await chooser).isMultiple()).toBe(false);
});

test("only the first 60 pages of a longer PDF are loaded, and it is said", async ({
	page,
}, info) => {
	test.skip(
		info.project.name !== "ipad-landscape",
		"slow: one project is enough",
	);
	test.setTimeout(180_000);
	await page.setInputFiles(input, {
		name: "dluga.pdf",
		mimeType: "application/pdf",
		buffer: makePdf(62),
	});
	await expect(page.getByText(/Pominięto 2/)).toBeVisible({ timeout: 150_000 });
	await expect
		.poll(async () => (await saved(page)).length, { timeout: 15_000 })
		.toBe(60);
});

test("Cancel stops the loading and keeps the pages that are there", async ({
	page,
}, info) => {
	test.skip(
		info.project.name !== "ipad-landscape",
		"timing: one project is enough",
	);
	test.setTimeout(120_000);
	await page.setInputFiles(input, {
		name: "dluga.pdf",
		mimeType: "application/pdf",
		buffer: makePdf(40),
	});
	await page.getByRole("button", { name: "Anuluj" }).click({ timeout: 30_000 });
	await expect(page.getByText(/Przerwano/)).toBeVisible({ timeout: 30_000 });
	await expect
		.poll(async () => (await saved(page)).length, { timeout: 10_000 })
		.toBeLessThan(40);
});
