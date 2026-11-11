import { expect, test } from "@playwright/test";
import { openBoard } from "./helpers";

test.beforeEach(async ({ page }) => {
	await openBoard(page);
});

test("the logo sits in the top left corner of the board", async ({ page }) => {
	const box = await page.locator("a.brand-corner").boundingBox();
	expect(box?.x).toBeLessThanOrEqual(16);
	expect(box?.y).toBeLessThanOrEqual(16);
	expect(box?.width).toBe(40);
	expect(box?.height).toBe(40);
});

test("the top bar never runs under the logo", async ({ page }) => {
	const logo = await page.locator("a.brand-corner").boundingBox();
	if (!logo) throw new Error("no logo");
	for (const sel of [
		".topbar .board-title",
		".topbar .toolbar",
		".topbar .participants",
		".topbar .board-menu",
	]) {
		const box = await page.locator(sel).first().boundingBox();
		if (!box) continue;
		const apart =
			box.x >= logo.x + logo.width + 4 ||
			box.y >= logo.y + logo.height + 4 ||
			box.x + box.width <= logo.x ||
			box.y + box.height <= logo.y;
		expect(apart, `${sel} overlaps the logo`).toBe(true);
	}
});

test("pressing the logo goes back to the main menu, the boards", async ({
	page,
}) => {
	await page.locator("a.brand-corner").tap();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByText("Moje tablice")).toBeVisible();
});
