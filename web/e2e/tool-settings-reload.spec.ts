import { expect, test } from "@playwright/test";
import { openBoard, pen } from "./helpers";

test.beforeEach(async ({ page }) => {
	await openBoard(page);
});

type Page = import("@playwright/test").Page;

/** The average colour of the painted pixels of the board inside a rectangle (screen CSS px). */
const meanColor = (page: Page, x: number, y: number, w: number, h: number) =>
	page.evaluate(
		([x, y, w, h]) => {
			const c = document.querySelector<HTMLCanvasElement>("canvas#board");
			const ctx = c?.getContext("2d");
			if (!c || !ctx) return null;
			const r = c.getBoundingClientRect();
			const k = c.width / r.width;
			const d = ctx.getImageData(
				(x - r.left) * k,
				(y - r.top) * k,
				w * k,
				h * k,
			).data;
			let n = 0;
			let red = 0;
			let blue = 0;
			for (let i = 0; i < d.length; i += 4) {
				if (d[i + 3] < 200) continue;
				n++;
				red += d[i];
				blue += d[i + 2];
			}
			return n ? { red: red / n, blue: blue / n } : null;
		},
		[x, y, w, h],
	);

const pressed = (page: Page, tool: string) =>
	page.locator(`[aria-label='${tool}']`).getAttribute("aria-pressed");

test("the pen, the line and the shapes keep their colours, and the page opens with the last tool (R-097)", async ({
	page,
}) => {
	await page.keyboard.press("KeyF"); // the pen is red
	await page.keyboard.press("Digit2");
	await page.keyboard.press("KeyL"); // the line is blue
	await page.keyboard.press("Digit3");

	await page.reload();
	await page.waitForSelector(".participants");

	// the page opens with the line, not with the pen
	expect(await pressed(page, "line")).toBe("true");
	expect(await pressed(page, "pen")).not.toBe("true");
	await pen(page, [300, 300], [500, 300]);
	await expect
		.poll(async () => (await meanColor(page, 290, 290, 220, 20)) !== null)
		.toBe(true);
	const line = await meanColor(page, 290, 290, 220, 20);
	expect(line?.blue).toBeGreaterThan((line?.red ?? 0) + 50);

	// and the pen still has its own colour
	await page.keyboard.press("KeyF");
	await pen(page, [300, 500], [500, 500]);
	await expect
		.poll(async () => (await meanColor(page, 290, 490, 220, 20)) !== null)
		.toBe(true);
	const stroke = await meanColor(page, 290, 490, 220, 20);
	expect(stroke?.red).toBeGreaterThan((stroke?.blue ?? 0) + 50);
});

test("the eraser is not the tool a page opens with", async ({ page }) => {
	await page.keyboard.press("KeyK"); // shapes
	await page.keyboard.press("KeyE"); // eraser
	await page.reload();
	await page.waitForSelector(".participants");
	expect(await pressed(page, "shape")).toBe("true");
	expect(await pressed(page, "eraser")).not.toBe("true");
});
