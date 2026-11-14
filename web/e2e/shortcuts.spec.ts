import { expect, test } from "@playwright/test";
import { openBoard } from "./helpers";

test.beforeEach(async ({ page }) => {
	await openBoard(page);
});

const pressed = (page: import("@playwright/test").Page, tool: string) =>
	page.locator(`[aria-label='${tool}']`).getAttribute("aria-pressed");

test("Q picks the select tool", async ({ page }) => {
	await page.keyboard.press("KeyF");
	expect(await pressed(page, "pen")).toBe("true");
	await page.keyboard.press("KeyQ");
	expect(await pressed(page, "select")).toBe("true");
});

test("own shortcut: set in the window from the board menu, used on the board, kept after a reload", async ({
	page,
}) => {
	await page.locator("[aria-label='board menu']").click();
	await page.getByText("Skróty klawiszowe").click();
	const dialog = page.getByRole("dialog", { name: "Skróty klawiszowe" });
	await expect(dialog).toBeVisible();
	await dialog
		.locator(".shortcut-row", { hasText: "Pióro" })
		.locator("button")
		.click();
	await page.keyboard.press("KeyG");
	await expect(
		dialog.locator(".shortcut-row", { hasText: "Pióro" }).locator("button"),
	).toHaveText("G");
	await dialog.locator(".shortcut-close").click();
	await expect(dialog).toBeHidden();
	await page.keyboard.press("KeyQ");
	await page.keyboard.press("KeyG");
	expect(await pressed(page, "pen")).toBe("true");
	await page.keyboard.press("KeyQ");
	await page.keyboard.press("KeyF"); // the old key does nothing now
	expect(await pressed(page, "pen")).not.toBe("true");
	await page.reload();
	await page.waitForSelector(".participants");
	await page.keyboard.press("KeyG");
	expect(await pressed(page, "pen")).toBe("true");
});
