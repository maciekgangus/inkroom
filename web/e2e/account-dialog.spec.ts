import { expect, test } from "@playwright/test";
import { E2E_LOGIN } from "./helpers";

test("the account window is a centred card that fits the screen, and its delete button has a visible label (R-085)", async ({
	page,
}) => {
	await page.context().request.post("/api/login", { data: E2E_LOGIN });
	await page.goto("/");
	await page.waitForSelector(".boards, header");
	await page.getByRole("button", { name: /^e2e/i }).click();
	const dialog = page.getByRole("dialog", { name: "Konto" });
	await expect(dialog).toBeVisible();

	const view = page.viewportSize() as { width: number; height: number };
	const box = (await dialog.boundingBox()) as {
		x: number;
		y: number;
		width: number;
		height: number;
	};
	// A card of at most 420px, inside the screen, centred.
	expect(box.width).toBeLessThanOrEqual(420.5);
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(view.width + 0.5);
	expect(Math.abs(box.x + box.width / 2 - view.width / 2)).toBeLessThanOrEqual(
		1,
	);
	expect(box.y + box.height).toBeLessThanOrEqual(view.height + 0.5);

	// The delete button names itself and its text is not the colour of what is behind it.
	const del = dialog.getByRole("button", { name: /Usuń konto/ });
	await expect(del).toBeVisible();
	const [text, back] = await del.evaluate((el) => {
		const s = getComputedStyle(el);
		return [s.color, s.backgroundColor];
	});
	expect(text).not.toBe(back);

	// The danger zone opens on request and Escape closes the window.
	await del.click();
	await expect(dialog.locator('input[name="confirm"]')).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "Usuń na zawsze" }),
	).toBeDisabled();
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
});
