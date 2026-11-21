import { expect, test } from "@playwright/test";
import { openBoard } from "./helpers";

type Page = import("@playwright/test").Page;

test.beforeEach(async ({ page }) => {
	await openBoard(page);
});

/** A text on the board, selected, with its menu open. */
async function textWithMenu(page: Page) {
	await page.locator("[aria-label='text']").click();
	await page.mouse.click(300, 400);
	const field = page.locator("textarea.text-editor");
	await expect(field).toBeVisible();
	await field.fill("Hello");
	await page.keyboard.press("Enter");
	await expect(field).toHaveCount(0);
	await page.locator("[aria-label='select']").click();
	await page.mouse.click(320, 410);
	await page.locator(".panel-tile").click();
	await expect(page.locator(".properties")).toBeVisible();
}

const box = async (page: Page, sel: string) => {
	const b = await page.locator(sel).first().boundingBox();
	if (!b) throw new Error(`no box for ${sel}`);
	return b;
};

const FONT = ".properties [aria-label='prop font size']";

test("the menu stays put while a slider is dragged, however the object grows (R-060)", async ({
	page,
}) => {
	await textWithMenu(page);
	const menu0 = await box(page, ".properties");
	const slider0 = await box(page, FONT);
	const y = slider0.y + slider0.height / 2;
	await page.mouse.move(slider0.x + 14, y);
	await page.mouse.down();
	// across the whole range: the text grows a lot, so its box (and the menu's anchor) does
	for (const f of [0.3, 0.6, 0.9, 1, 0.5, 0.95]) {
		await page.mouse.move(slider0.x + 14 + (slider0.width - 28) * f, y, {
			steps: 4,
		});
		const m = await box(page, ".properties");
		const s = await box(page, FONT);
		expect(Math.abs(m.x - menu0.x)).toBeLessThanOrEqual(1);
		expect(Math.abs(m.y - menu0.y)).toBeLessThanOrEqual(1);
		expect(Math.abs(s.x - slider0.x)).toBeLessThanOrEqual(1);
		expect(Math.abs(s.y - slider0.y)).toBeLessThanOrEqual(1);
	}
	await page.mouse.up();
	// and after the release the slider is still where the hand left it (it can be grabbed again)
	const after = await box(page, FONT);
	expect(Math.abs(after.x - slider0.x)).toBeLessThanOrEqual(1);
	expect(Math.abs(after.y - slider0.y)).toBeLessThanOrEqual(1);
});

test("the same with a finger on a touch screen", async ({ page }) => {
	await textWithMenu(page);
	const menu0 = await box(page, ".properties");
	const slider0 = await box(page, FONT);
	const y = slider0.y + slider0.height / 2;
	const cdp = await page.context().newCDPSession(page);
	const touch = (type: string, x?: number) =>
		cdp.send("Input.dispatchTouchEvent", {
			type,
			touchPoints: x === undefined ? [] : [{ x, y }],
		});
	await touch("touchStart", slider0.x + 14);
	for (const f of [0.3, 0.6, 0.9, 1, 0.5]) {
		await touch("touchMove", slider0.x + 14 + (slider0.width - 28) * f);
		const m = await box(page, ".properties");
		const s = await box(page, FONT);
		expect(Math.abs(m.x - menu0.x)).toBeLessThanOrEqual(1);
		expect(Math.abs(m.y - menu0.y)).toBeLessThanOrEqual(1);
		expect(Math.abs(s.x - slider0.x)).toBeLessThanOrEqual(1);
		expect(Math.abs(s.y - slider0.y)).toBeLessThanOrEqual(1);
	}
	await touch("touchEnd");
});

test("a keyboard step on the slider does not move the menu either", async ({
	page,
}) => {
	await textWithMenu(page);
	const slider0 = await box(page, FONT);
	await page.locator(FONT).focus();
	for (let i = 0; i < 30; i++) {
		await page.keyboard.press("ArrowRight");
		const s = await box(page, FONT);
		expect(Math.abs(s.x - slider0.x)).toBeLessThanOrEqual(1);
		expect(Math.abs(s.y - slider0.y)).toBeLessThanOrEqual(1);
	}
});
