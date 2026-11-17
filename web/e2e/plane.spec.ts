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
