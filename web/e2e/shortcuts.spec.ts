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

test("1 to 3 pick the quick colours, and 4 the colour kept in the fourth slot (R-079)", async ({
	page,
}) => {
	const swatch = (c: string) => page.locator(`[aria-label='color ${c}']`);
	const settings = page.locator("[aria-label='pen settings']");
	const narrow = (await settings.count()) > 0;
	// On a narrow screen the colours are in the list behind one button (R-082).
	const open = async () => {
		if (narrow) await settings.click();
	};
	const close = async () => {
		if (narrow) await page.keyboard.press("Escape");
	};
	await page.keyboard.press("Digit2");
	await open();
	await expect(swatch("#d32f2f")).toHaveAttribute("aria-pressed", "true");
	await close();
	await page.keyboard.press("Digit3");
	await open();
	await expect(swatch("#1976d2")).toHaveAttribute("aria-pressed", "true");
	await close();
	// pick a colour from beyond the quick ones: it is kept for the fourth key
	await open();
	if (!narrow) await page.locator("[aria-label='more colors']").click();
	await swatch("#7c3aed").click();
	await close();
	await page.keyboard.press("Digit1");
	await open();
	await expect(swatch("#111111")).toHaveAttribute("aria-pressed", "true");
	await close();
	await page.keyboard.press("Digit4");
	await open();
	if (narrow)
		await expect(swatch("#7c3aed")).toHaveAttribute("aria-pressed", "true");
	else
		await expect(page.locator("[aria-label='more colors']")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
});
