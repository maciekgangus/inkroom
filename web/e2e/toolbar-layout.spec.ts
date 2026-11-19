import { expect, test } from "@playwright/test";
import { openBoard } from "./helpers";

test.beforeEach(async ({ page }) => {
	await openBoard(page);
});

const box = async (page: import("@playwright/test").Page, sel: string) => {
	const b = await page.locator(sel).first().boundingBox();
	if (!b) throw new Error(`${sel} is not on the page`);
	return b;
};

test("upright, the tools stand in a column down the left edge (R-082)", async ({
	page,
}) => {
	const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
	test.skip(width > height, "a landscape project");
	const rail = await box(page, ".toolbar.rail");
	expect(rail.x).toBeLessThanOrEqual(16);
	expect(rail.y).toBeGreaterThan(40);
	expect(rail.y + rail.height).toBeLessThanOrEqual(height);
	expect(rail.width).toBeLessThan(90);
	// stacked: each tool under the one before it
	const pen = await box(page, ".toolbar [aria-label='pen']");
	const eraser = await box(page, ".toolbar [aria-label='eraser']");
	expect(eraser.y).toBeGreaterThan(pen.y + pen.height - 1);
	expect(Math.abs(eraser.x - pen.x)).toBeLessThan(2);
	// the name stays in the top bar, clear of the rail
	const title = await box(page, ".topbar .board-title");
	expect(title.x).toBeGreaterThan(rail.x + rail.width);
});

test("upright, the list of settings opens beside the rail and fits the screen", async ({
	page,
}) => {
	const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
	test.skip(width > height, "a landscape project");
	await page.locator("[aria-label='pen settings']").tap();
	const list = await box(page, ".settings-list");
	const rail = await box(page, ".toolbar.rail");
	expect(list.x).toBeGreaterThanOrEqual(rail.x + rail.width);
	expect(list.x + list.width).toBeLessThanOrEqual(width);
	expect(list.y).toBeGreaterThanOrEqual(0);
	expect(list.y + list.height).toBeLessThanOrEqual(height);
	// the three sections are there and a colour can be picked
	await expect(page.locator(".settings-title")).toHaveCount(3);
	await page.locator("[aria-label='color #d32f2f']").tap();
	// picking a colour shuts the list; opened again, it shows the colour as chosen
	await expect(page.locator(".settings-list")).toHaveCount(0);
	await page.locator("[aria-label='pen settings']").tap();
	await expect(page.locator("[aria-label='color #d32f2f']")).toHaveAttribute(
		"aria-pressed",
		"true",
	);
});

test("across, the narrow bar is one row with one settings button (R-082)", async ({
	page,
}) => {
	const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
	test.skip(width < height, "a portrait project");
	await expect(page.locator(".toolbar.rail")).toHaveCount(0);
	await expect(page.locator("[aria-label='pen settings']")).toBeVisible();
	await expect(page.locator("[aria-label='size 1']")).toHaveCount(0);
	const tb = await box(page, ".toolbar");
	const title = await box(page, ".topbar .board-title");
	expect(Math.abs(tb.y - title.y)).toBeLessThan(20); // the same row
	await page.locator("[aria-label='pen settings']").tap();
	const list = await box(page, ".settings-list");
	expect(list.x + list.width).toBeLessThanOrEqual(width);
	expect(list.y + list.height).toBeLessThanOrEqual(height);
});

test("a wide window keeps the full bar as it is (R-082)", async ({ page }) => {
	await page.setViewportSize({ width: 1700, height: 900 });
	// a PC: not an upright tablet, wide enough for everything in one row
	await expect(page.locator("[aria-label='pen settings']")).toHaveCount(0);
	await expect(page.locator("[aria-label='size 1']")).toBeVisible();
	await expect(page.locator(".toolbar.rail")).toHaveCount(0);
	const tb = await box(page, ".toolbar");
	const title = await box(page, ".topbar .board-title");
	expect(Math.abs(tb.y - title.y)).toBeLessThan(20);
});

test("on a wide window the palette shuts after a colour from the bar, from the fourth place and from itself", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1700, height: 900 });
	const palette = page.locator(".palette");
	await page.locator("[aria-label='more colors']").click();
	await expect(palette).toBeVisible();
	await page.locator("[aria-label='color #1976d2']").first().click(); // a quick colour of the bar
	await expect(palette).toHaveCount(0);
	await page.locator("[aria-label='more colors']").click();
	await palette.locator("[aria-label^='color #e91e63']").click(); // the grid
	await expect(palette).toHaveCount(0);
	await page.locator("[aria-label='color #d32f2f']").first().click();
	await page.locator("[aria-label='more colors']").click(); // the kept colour is picked
	await expect(palette).toHaveCount(0);
	await page.locator("[aria-label='more colors']").click(); // again: the palette opens
	await expect(palette).toBeVisible();
	await page
		.locator("[aria-label='color #d32f2f']")
		.first()
		.click({ force: true });
	await expect(palette).toHaveCount(0);
	await page.locator("[aria-label='more colors']").click();
	await page.keyboard.press("Escape");
	await expect(palette).toHaveCount(0);
});

test("the share button is on the top bar, an icon only (R-083)", async ({
	page,
}) => {
	const share = page.locator(".topbar [aria-label='share']");
	await expect(share).toBeVisible();
	expect(await share.textContent()).toBe("");
	await expect(share.locator("svg")).toHaveCount(1);
});
