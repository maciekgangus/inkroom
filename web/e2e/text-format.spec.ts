import { expect, type Page, test } from "@playwright/test";
import { inkIn, openBoard } from "./helpers";

// The toolbar over a text, the grip that widens the field and Markdown drawn on the board
// (R-101, R-102), on the iPad screens.

test.beforeEach(async ({ page }) => {
	await page.emulateMedia({ colorScheme: "light" });
	await openBoard(page);
});

/** Starts a text area by dragging with the Tekst tool; the field is then in front of the board. */
async function startArea(page: Page, x: number, y: number, w = 300, h = 80) {
	await page.locator("[aria-label='text']").click();
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + w, y + h, { steps: 4 });
	await page.mouse.up();
	const field = page.locator("textarea.text-editor");
	await expect(field).toBeVisible();
	return field;
}

test("the toolbar is on the screen, over the field, with font, size and colour", async ({
	page,
}) => {
	const field = await startArea(page, 160, 360);
	const bar = page.locator(".text-toolbar");
	await expect(bar).toBeVisible();
	const view = page.viewportSize() as { width: number; height: number };
	const b = (await bar.boundingBox()) as NonNullable<
		Awaited<ReturnType<typeof bar.boundingBox>>
	>;
	expect(b.x).toBeGreaterThanOrEqual(0);
	expect(b.y).toBeGreaterThanOrEqual(0);
	expect(b.x + b.width).toBeLessThanOrEqual(view.width + 0.5);
	const f = (await field.boundingBox()) as NonNullable<
		Awaited<ReturnType<typeof field.boundingBox>>
	>;
	expect(b.y + b.height).toBeLessThanOrEqual(f.y); // over the field, not on it
	for (const label of ["Czcionka", "Rozmiar czcionki", "Kolor tekstu"])
		await expect(page.getByLabel(label)).toBeVisible();
});

test("the toolbar never wraps a row: one row when it fits, two even rows when not", async ({
	page,
}) => {
	await startArea(page, 160, 360);
	const view = page.viewportSize() as { width: number; height: number };
	const rows = page.locator(".text-toolbar .tb-row");
	const n = await rows.count();
	expect(n === 1 || n === 2).toBe(true);
	for (let i = 0; i < n; i++) {
		const r = (await rows.nth(i).boundingBox()) as NonNullable<
			Awaited<ReturnType<ReturnType<typeof rows.nth>["boundingBox"]>>
		>;
		expect(r.height).toBeLessThanOrEqual(44); // one line of buttons, not wrapped
		expect(r.x).toBeGreaterThanOrEqual(0);
		expect(r.x + r.width).toBeLessThanOrEqual(view.width + 0.5);
	}
});

test("bold on a selection wraps it in markers and keeps the text being edited", async ({
	page,
}) => {
	const field = await startArea(page, 160, 360);
	await field.fill("ala ma kota");
	await field.evaluate((el: HTMLTextAreaElement) => {
		el.focus();
		el.setSelectionRange(4, 6);
	});
	await page.getByLabel("Pogrubienie (Ctrl+B)").click();
	await expect(field).toHaveValue("ala **ma** kota");
	await expect(field).toBeFocused();
	await page.keyboard.press("Control+z"); // the toolbar's change is an edit that undo takes back
	await expect(field).toHaveValue("ala ma kota");
});

test("the grip widens the field and the text keeps its size", async ({
	page,
}) => {
	const field = await startArea(page, 160, 360, 200, 80);
	const size = await field.evaluate((el) => getComputedStyle(el).fontSize);
	const before = (await field.boundingBox())?.width ?? 0;
	const grip = page.locator(".text-grip");
	const g = (await grip.boundingBox()) as NonNullable<
		Awaited<ReturnType<typeof grip.boundingBox>>
	>;
	await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
	await page.mouse.down();
	await page.mouse.move(g.x + g.width / 2 + 150, g.y + g.height / 2, {
		steps: 6,
	});
	await page.mouse.up();
	const after = (await field.boundingBox())?.width ?? 0;
	expect(after).toBeGreaterThan(before + 100);
	expect(await field.evaluate((el) => getComputedStyle(el).fontSize)).toBe(
		size,
	);
	await expect(field).toBeFocused();
});

test("the size, font and colour of the toolbar change the field", async ({
	page,
}) => {
	const field = await startArea(page, 160, 360);
	const before = Number.parseFloat(
		await field.evaluate((el) => getComputedStyle(el).fontSize),
	);
	await page.getByLabel("Zwiększ rozmiar").click();
	const after = Number.parseFloat(
		await field.evaluate((el) => getComputedStyle(el).fontSize),
	);
	expect(after).toBeGreaterThan(before);
	await page.getByLabel("Czcionka").click();
	await page.getByRole("option", { name: "JetBrains Mono" }).click();
	expect(
		await field.evaluate((el) => getComputedStyle(el).fontFamily),
	).toContain("JetBrains Mono");
	await expect(field).toBeFocused();
});

test("a heading is drawn bigger than the same text without the marker", async ({
	page,
}) => {
	const plain = await startArea(page, 160, 460, 300, 60);
	await plain.fill("HHHH");
	await page.keyboard.press("Control+Enter");
	await expect(plain).toHaveCount(0);
	const heading = await startArea(page, 160, 260, 300, 60);
	await heading.fill("# HHHH");
	await page.keyboard.press("Control+Enter");
	await expect(heading).toHaveCount(0);
	// the board paints a set text a moment later
	await expect
		.poll(async () => inkIn(page, 150, 250, 400, 120), { timeout: 8000 })
		.toBeGreaterThan(0);
	const big = await inkIn(page, 150, 250, 400, 120);
	const small = await inkIn(page, 150, 450, 400, 120);
	expect(small).toBeGreaterThan(0);
	expect(big).toBeGreaterThan(small * 1.5);
});
