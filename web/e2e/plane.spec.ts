import { expect, test } from "@playwright/test";
import { darkInk, ink, inkIn, openBoard, pen } from "./helpers";

test.beforeEach(async ({ page }) => {
	await openBoard(page);
});

test("a click with the coordinate plane tool puts a square with a grid and axes on the board (R-084)", async ({
	page,
}) => {
	expect(await ink(page)).toBe(0);
	await page.locator("[aria-label='plane']").tap();
	await page.mouse.click(420, 420);
	await expect.poll(() => ink(page)).toBeGreaterThan(0);
	// the square is 480 wide, centred on the click: ink in its middle and near its edge
	expect(await inkIn(page, 380, 380, 80, 80)).toBeGreaterThan(0);
	// and Zaznacz is on, with the plane selected (its settings are offered)
	await expect(page.locator("[aria-label='select']")).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await page.locator(".panel-tile").tap();
	await expect(page.locator("[aria-label='prop grid']")).toBeVisible();
});

test("the eraser leaves the plane and takes only what is drawn on it (R-084)", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "light" });
	await page.locator("[aria-label='plane']").tap();
	await page.mouse.click(420, 420);
	await expect.poll(() => ink(page)).toBeGreaterThan(0);
	// the fonts of its labels (the italic x and y) have loaded and the board has drawn them
	await page.evaluate(() => document.fonts.ready);
	await page.evaluate(
		() =>
			new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
	);
	const planeOnly = await darkInk(page);
	await page.locator("[aria-label='pen']").tap();
	await pen(page, [300, 500], [520, 500]);
	await expect.poll(() => darkInk(page)).toBeGreaterThan(planeOnly);
	const withStroke = await darkInk(page);
	await page.locator("[aria-label='eraser']").tap();
	await pen(page, [260, 500], [560, 500]);
	await expect.poll(() => darkInk(page)).toBeLessThan(withStroke);
	// the sheet and its axes are still there
	expect(await darkInk(page)).toBeGreaterThanOrEqual(planeOnly - 5);
});

/** How many pixels of the board layer are the blue of the second function colour (#1976d2). */
const bluePixels = (page: import("@playwright/test").Page) =>
	page.evaluate(() => {
		const c = document.querySelector<HTMLCanvasElement>("#board");
		const ctx = c?.getContext("2d");
		if (!c || !ctx) return 0;
		const d = ctx.getImageData(0, 0, c.width, c.height).data;
		let n = 0;
		for (let i = 0; i < d.length; i += 4)
			if (d[i] < 60 && d[i + 1] > 90 && d[i + 1] < 140 && d[i + 2] > 180) n++;
		return n;
	});

test("a function added in the panel is drawn on the plane and the eraser leaves it (R-092)", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "light" });
	await page.locator("[aria-label='plane']").tap();
	await page.mouse.click(420, 420);
	await expect.poll(() => ink(page)).toBeGreaterThan(0);
	await page.locator(".panel-tile").tap();
	expect(await bluePixels(page)).toBe(0);
	await page.locator("[aria-label='fn add']").tap();
	await page.locator("[aria-label='fn add linear']").tap(); // first colour is red, the next blue
	await page.locator("[aria-label='fn add']").tap();
	await page.locator("[aria-label='fn add quad']").tap();
	await expect.poll(() => bluePixels(page)).toBeGreaterThan(100);
	const before = await bluePixels(page);
	await page.locator("[aria-label='eraser']").tap();
	await pen(page, [160, 420], [700, 420]);
	await page.waitForTimeout(200);
	expect(await bluePixels(page)).toBeGreaterThanOrEqual(before * 0.95);
});
