import { expect, test } from "@playwright/test";
import { openBoard } from "./helpers";

test.beforeEach(async ({ page }) => {
	// The letters are measured as dark on white, so the light theme, whatever the system says.
	await page.emulateMedia({ colorScheme: "light" });
	await openBoard(page);
});

/** The top and bottom rows of dark pixels in a PNG of a clipped part of the page. */
async function inkRows(page: import("@playwright/test").Page, png: Buffer) {
	return page.evaluate(async (b64) => {
		const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
		const bmp = await createImageBitmap(
			new Blob([bytes], { type: "image/png" }),
		);
		const c = document.createElement("canvas");
		c.width = bmp.width;
		c.height = bmp.height;
		const ctx = c.getContext("2d") as CanvasRenderingContext2D;
		ctx.drawImage(bmp, 0, 0);
		const d = ctx.getImageData(0, 0, c.width, c.height).data;
		let top = -1;
		let bottom = -1;
		for (let y = 0; y < c.height; y++)
			for (let x = 0; x < c.width; x++) {
				const i = (y * c.width + x) * 4;
				if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90 && d[i + 3] > 200) {
					if (top < 0) top = y;
					bottom = y;
				}
			}
		return { top, bottom, scale: bmp.width };
	}, png.toString("base64"));
}

test("a text looks the same while it is typed and after it is set (R-081)", async ({
	page,
}) => {
	await page.locator("[aria-label='text']").click();
	await page.mouse.click(300, 400);
	const field = page.locator("textarea.text-editor");
	await expect(field).toBeVisible();
	await field.fill("HHHH");
	const clip = { x: 280, y: 380, width: 220, height: 120 };
	// The field's own border and caret are not ink; the letters are black on white.
	const typing = await inkRows(page, await page.screenshot({ clip }));
	await page.keyboard.press("Enter");
	await expect(field).toHaveCount(0);
	// The board paints the set text a moment later; wait for it rather than for a fixed time.
	let set = await inkRows(page, await page.screenshot({ clip }));
	for (let i = 0; i < 40 && set.top < 0; i++) {
		await page.waitForTimeout(100);
		set = await inkRows(page, await page.screenshot({ clip }));
	}
	expect(typing.top).toBeGreaterThanOrEqual(0);
	expect(set.top).toBeGreaterThanOrEqual(0);
	// Within a pixel of each other, in a screenshot taken at the device's pixel ratio.
	const ratio = typing.scale / clip.width;
	expect(Math.abs(set.top - typing.top)).toBeLessThanOrEqual(ratio);
	expect(Math.abs(set.bottom - typing.bottom)).toBeLessThanOrEqual(ratio);
});
