import { expect, test } from "@playwright/test";
import { inkIn, openBoard, pen } from "./helpers";

test.beforeEach(async ({ context, page }) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await openBoard(page);
});

test.describe("Ctrl+C and Ctrl+V on the board (R-030, R-035)", () => {
	test("copies the selected stroke and pastes it where the pointer is", async ({
		page,
	}) => {
		await pen(page, [200, 500], [500, 500]);
		await page.keyboard.press("Escape"); // the select tool
		await page.mouse.click(350, 500); // selects the stroke
		await page.keyboard.press("Control+c");
		await page.mouse.move(350, 250);
		await page.keyboard.press("Control+v");
		await expect.poll(() => inkIn(page, 150, 200, 400, 100)).toBeGreaterThan(0);
	});

	test("puts the board JSON on the system clipboard", async ({ page }) => {
		await pen(page, [200, 500], [500, 500]);
		await page.keyboard.press("Escape");
		await page.mouse.click(350, 500);
		await page.keyboard.press("Control+c");
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toContain('"inkroom"');
	});
});
