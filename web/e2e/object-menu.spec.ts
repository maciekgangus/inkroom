import { expect, test } from "@playwright/test";
import { openBoard, pen } from "./helpers";

test.beforeEach(async ({ page }) => {
	await openBoard(page);
});

const widthOfMenu = async (page: import("@playwright/test").Page) =>
	(await page.locator(".properties").boundingBox())?.width ?? 0;

test("every object has the same wide menu, and its rows do not wrap (R-060)", async ({
	page,
}) => {
	const { width: vw } = page.viewportSize() ?? { width: 0 };
	const want = Math.min(400, vw - 24);
	// a plane
	await page.locator("[aria-label='plane']").tap();
	await page.mouse.click(420, 420);
	await page.locator(".panel-tile").tap();
	await expect(page.locator(".properties")).toBeVisible();
	const plane = await widthOfMenu(page);
	expect(Math.abs(plane - want)).toBeLessThanOrEqual(1);
	// a stroke: the widest row, the ready widths and four line styles, must stay in one line
	await page.locator(".properties [aria-label='close panel']").tap();
	await page.locator("[aria-label='pen']").tap();
	await pen(page, [250, 110], [450, 130]);
	await page.locator("[aria-label='select']").tap();
	await page.mouse.click(350, 120);
	await page.locator(".panel-tile").tap();
	await expect(page.locator(".properties")).toBeVisible();
	const stroke = await widthOfMenu(page);
	expect(Math.abs(stroke - plane)).toBeLessThanOrEqual(1);
	const tops = await page
		.locator(
			".properties [aria-label^='prop size '], .properties [aria-label^='prop dash ']",
		)
		.evaluateAll((els) =>
			els.map((e) => Math.round(e.getBoundingClientRect().top)),
		);
	expect(tops.length).toBeGreaterThanOrEqual(6);
	expect(new Set(tops).size).toBe(1); // one line
	// the colour row says what it colours
	await expect(page.locator(".properties .prop-label").first()).toHaveText(
		"Kolor",
	);
});
