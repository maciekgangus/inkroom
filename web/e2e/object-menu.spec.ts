import { expect, test } from "@playwright/test";
import { openBoard, pen } from "./helpers";

test.beforeEach(async ({ page }) => {
	await openBoard(page);
});

const widthOfMenu = async (page: import("@playwright/test").Page) =>
	(await page.locator(".properties").boundingBox())?.width ?? 0;

test("the menu of a stroke is narrow and a graph's is wide; no row wraps; the options row is centred (R-060)", async ({
	page,
}) => {
	const { width: vw } = page.viewportSize() ?? { width: 0 };
	// a plane: wide for its formulas
	await page.locator("[aria-label='plane']").tap();
	await page.mouse.click(420, 420);
	await page.locator(".panel-tile").tap();
	await expect(page.locator(".properties")).toBeVisible();
	const plane = await widthOfMenu(page);
	expect(Math.abs(plane - Math.min(400, vw - 24))).toBeLessThanOrEqual(1);
	// its colour row is the same five and the plus
	await expect(
		page
			.locator(".properties .panel-body > .prop-group .palette-grid")
			.first()
			.locator(".swatch"),
	).toHaveCount(6);
	// a stroke: the narrow menu, with the widest row (three widths and four styles) in one line
	await page.locator(".properties [aria-label='close panel']").tap();
	await page.locator("[aria-label='pen']").tap();
	await pen(page, [250, 110], [450, 130]);
	await page.locator("[aria-label='select']").tap();
	await page.mouse.click(350, 120);
	await page.locator(".panel-tile").tap();
	await expect(page.locator(".properties")).toBeVisible();
	const stroke = await widthOfMenu(page);
	expect(Math.abs(stroke - Math.min(320, vw - 24))).toBeLessThanOrEqual(1);
	const tops = await page
		.locator(
			".properties [aria-label^='prop size '], .properties [aria-label^='prop dash ']",
		)
		.evaluateAll((els) =>
			els.map((e) => Math.round(e.getBoundingClientRect().top)),
		);
	expect(tops.length).toBeGreaterThanOrEqual(7);
	expect(new Set(tops).size).toBe(1); // one line
	// the row of the widths and the styles is in the middle: the room left = the room right
	const room = await page
		.locator(".properties .prop-group.options")
		.evaluate((g) => {
			const r = g.getBoundingClientRect();
			const kids = [...g.children].map((e) => e.getBoundingClientRect());
			return {
				left: Math.min(...kids.map((k) => k.left)) - r.left,
				right: r.right - Math.max(...kids.map((k) => k.right)),
			};
		});
	expect(Math.abs(room.left - room.right)).toBeLessThanOrEqual(1);
	// the colour row: five colours and the plus in one line, its ends on the edges of the row
	const row = await page
		.locator(".properties .panel-body > .prop-group .palette-grid")
		.first()
		.evaluate((g) => {
			const r = g.getBoundingClientRect();
			const kids = [...g.children].map((e) => e.getBoundingClientRect());
			return {
				n: kids.length,
				tops: new Set(kids.map((k) => Math.round(k.top))).size,
				left: kids[0].left - r.left,
				right: r.right - kids[kids.length - 1].right,
			};
		});
	expect(row.n).toBe(6);
	expect(row.tops).toBe(1);
	expect(Math.abs(row.left)).toBeLessThanOrEqual(1);
	expect(Math.abs(row.right)).toBeLessThanOrEqual(1);
	// the colour row says what it colours
	await expect(page.locator(".properties .prop-label").first()).toHaveText(
		"Kolor",
	);
});
